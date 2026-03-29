import Foundation
import UIKit

enum BackendClient {
	static let defaultBaseURLString = "https://screencap-frontend.vercel.app"

	static func claimPairingSession(from rawValue: String) async throws -> DeviceIdentity {
		guard
			let defaultBaseURL = URL(string: defaultBaseURLString),
			let link = PairingLink.parse(rawValue, defaultBaseURL: defaultBaseURL)
		else {
			throw NSError(domain: "BackendClient", code: 1, userInfo: [
				NSLocalizedDescriptionKey: "Invalid pairing link. Use the full link copied from the macOS Screencap settings panel.",
			])
		}

		let keys = PairingCrypto.generateKeys()
		let deviceName = await MainActor.run { UIDevice.current.name }
		let requestBody = PairingClaimRequest(
			code: link.code,
			deviceName: deviceName,
			platform: "ios",
			signPubKey: keys.signPublicKeySpkiDerB64,
			dhPubKey: keys.dhPublicKeySpkiDerB64
		)

		let bodyData = try JSONEncoder().encode(requestBody)
		var request = URLRequest(url: resolve(baseURL: link.baseURL, path: "/api/device-pairing-sessions/\(link.sessionId)/claim"))
		request.httpMethod = "POST"
		request.httpBody = bodyData
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")

		let (data, response) = try await URLSession.shared.data(for: request)
		try ensureSuccess(response: response, data: data, context: "Pairing claim")

		let payload = try JSONDecoder().decode(PairingClaimResponse.self, from: data)
		let identity = DeviceIdentity(
			userId: payload.userId,
			deviceId: payload.deviceId,
			username: payload.username,
			signPubKeySpkiDerB64: keys.signPublicKeySpkiDerB64,
			dhPubKeySpkiDerB64: keys.dhPublicKeySpkiDerB64,
			backendBaseURL: link.baseURL.absoluteString
		)
		try AuthStore.save(identity: identity, keys: keys.keyMaterial)
		AppGroupStore.appendLog(
			scope: "pairing",
			message: "claimed pairing session for @\(payload.username) baseURL=\(link.baseURL.absoluteString)"
		)
		return identity
	}

	static func upload(day: MobileActivityDay) async throws {
		AppGroupStore.noteUploadAttempt()
		AppGroupStore.appendLog(
			scope: "upload",
			message: "uploading mobile day dayStartMs=\(day.dayStartMs) buckets=\(day.buckets.count)"
		)
		let body = try JSONEncoder().encode(day)
		let path = "/api/me/mobile-activity-days/\(day.deviceId)/\(day.dayStartMs)"
		do {
			_ = try await signedDataRequest(path: path, method: "PUT", body: body)
			AppGroupStore.noteUploadSuccess()
			AppGroupStore.saveUploadStatus(
				dayStartMs: day.dayStartMs,
				message: "Uploaded \(DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short))"
			)
			AppGroupStore.appendLog(
				scope: "upload",
				message: "upload succeeded dayStartMs=\(day.dayStartMs)"
			)
		} catch {
			let message = error.localizedDescription
			AppGroupStore.noteUploadFailure(message)
			AppGroupStore.appendLog(
				scope: "upload",
				message: "upload failed dayStartMs=\(day.dayStartMs) error=\(message)"
			)
			throw error
		}
	}

	static func fetchSnapshot(dayStartMs: Int64) async throws -> DayWrappedSnapshot {
		AppGroupStore.appendLog(
			scope: "snapshot",
			message: "fetching snapshot dayStartMs=\(dayStartMs)"
		)
		do {
			let data = try await signedDataRequest(
				path: "/api/me/day-wrapped-snapshot?dayStartMs=\(dayStartMs)",
				method: "GET"
			)
			let snapshot: DayWrappedSnapshot
			do {
				snapshot = try JSONDecoder().decode(DayWrappedSnapshot.self, from: data)
			} catch {
				let rawBody = String(data: data, encoding: .utf8) ?? "<non-utf8>"
				AppGroupStore.appendLog(
					scope: "snapshot",
					message: "decode failed dayStartMs=\(dayStartMs) error=\(error.localizedDescription) body=\(rawBody)"
				)
				throw error
			}
			AppGroupStore.appendLog(
				scope: "snapshot",
				message: "fetched snapshot dayStartMs=\(snapshot.dayStartMs) source=\(snapshot.sourceSummary)"
			)
			return snapshot
		} catch {
			AppGroupStore.appendLog(
				scope: "snapshot",
				message: "fetch failed dayStartMs=\(dayStartMs) error=\(error.localizedDescription)"
			)
			throw error
		}
	}

	static func fetchBridgeDiagnostics(
		dayStartMs: Int64,
		probeToken: String?
	) async throws -> BridgeDiagnosticsResponse {
		var path = "/api/me/bridge-diagnostics?dayStartMs=\(dayStartMs)"
		if let probeToken, !probeToken.isEmpty {
			path += "&probeToken=\(probeToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? probeToken)"
		}
		AppGroupStore.appendLog(
			scope: "bridge-probe",
			message: "fetching bridge diagnostics dayStartMs=\(dayStartMs) probeToken=\(probeToken ?? "nil")"
		)
		do {
			let data = try await signedDataRequest(path: path, method: "GET")
			let response: BridgeDiagnosticsResponse
			do {
				response = try JSONDecoder().decode(BridgeDiagnosticsResponse.self, from: data)
			} catch {
				let rawBody = String(data: data, encoding: .utf8) ?? "<non-utf8>"
				AppGroupStore.appendLog(
					scope: "bridge-probe",
					message: "decode failed dayStartMs=\(dayStartMs) error=\(error.localizedDescription) body=\(rawBody)"
				)
				throw error
			}
			AppGroupStore.appendLog(
				scope: "bridge-probe",
				message: "bridge diagnostics succeeded echoedProbeToken=\(response.echoedProbeToken ?? "nil") cachedDays=\(response.cachedDaysForRequestedDay) events=\(response.eventCountForRequestedDay) activeSlots=\(response.activeSlotCount)"
			)
			return response
		} catch {
			AppGroupStore.appendLog(
				scope: "bridge-probe",
				message: "bridge diagnostics failed dayStartMs=\(dayStartMs) error=\(error.localizedDescription)"
			)
			throw error
		}
	}

	static func signedDataRequest(
		path: String,
		method: String,
		body: Data? = nil
	) async throws -> Data {
		let identity: DeviceIdentity
		let keys: StoredKeyMaterial
		switch AuthStore.loadSignedRequestCredentials() {
		case let .available(nextIdentity, nextKeys):
			identity = nextIdentity
			keys = nextKeys
		case .missingIdentity:
			throw NSError(domain: "BackendClient", code: 2, userInfo: [
				NSLocalizedDescriptionKey: "Identity not available",
			])
		case .missingKeyMaterial:
			throw NSError(domain: "BackendClient", code: 4, userInfo: [
				NSLocalizedDescriptionKey:
					"Signing keys not available. Open the iPhone app once to refresh shared credentials.",
			])
		}

		let normalizedPath = path.hasPrefix("/") ? path : "/" + path
		let ts = String(Int64(Date().timeIntervalSince1970 * 1000))
		let payload = body ?? Data()
		let canonical = [
			method.uppercased(),
			normalizedPath,
			ts,
			PairingCrypto.sha256Hex(payload),
		].joined(separator: "\n")
		let signature = try PairingCrypto.signCanonicalString(
			canonical,
			signPrivateKeyRawB64: keys.signPrivateKeyRawB64
		)

		var request = URLRequest(
			url: resolve(
				baseURL: URL(string: identity.backendBaseURL) ?? URL(string: defaultBaseURLString)!,
				path: normalizedPath
			)
		)
		request.httpMethod = method
		request.httpBody = body
		request.setValue(identity.userId, forHTTPHeaderField: "x-user-id")
		request.setValue(identity.deviceId, forHTTPHeaderField: "x-device-id")
		request.setValue(ts, forHTTPHeaderField: "x-ts")
		request.setValue(signature, forHTTPHeaderField: "x-sig")
		if body != nil {
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		}

		let (data, response) = try await URLSession.shared.data(for: request)
		try ensureSuccess(response: response, data: data, context: normalizedPath)
		return data
	}

	private static func resolve(baseURL: URL, path: String) -> URL {
		URL(string: path, relativeTo: baseURL) ?? baseURL
	}

	private static func ensureSuccess(
		response: URLResponse,
		data: Data,
		context: String
	) throws {
		guard let httpResponse = response as? HTTPURLResponse else {
			throw NSError(domain: "BackendClient", code: 3, userInfo: [
				NSLocalizedDescriptionKey: "\(context) returned a non-HTTP response",
			])
		}
		guard (200 ..< 300).contains(httpResponse.statusCode) else {
			let message = String(data: data, encoding: .utf8) ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
			throw NSError(domain: "BackendClient", code: httpResponse.statusCode, userInfo: [
				NSLocalizedDescriptionKey: "\(context) failed: \(httpResponse.statusCode) \(message)",
			])
		}
	}
}
