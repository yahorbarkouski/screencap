import Foundation
import SwiftUI

enum WrappedMode: String, Codable, CaseIterable, Sendable {
	case categories
	case apps

	var nextWidgetMode: WrappedMode {
		switch self {
		case .categories:
			return .apps
		case .apps:
			return .categories
		}
	}
}

enum WrappedSourceAccent: String, Codable, Hashable, Sendable {
	case none
	case mac
	case iphone
	case both
}

enum WrappedCategory: String, Codable, CaseIterable, Hashable, Sendable {
	case study = "Study"
	case work = "Work"
	case leisure = "Leisure"
	case chores = "Chores"
	case social = "Social"
	case unknown = "Unknown"

	var color: Color {
		switch self {
		case .study:
			return Color(red: 59.0 / 255.0, green: 130.0 / 255.0, blue: 246.0 / 255.0)
		case .work:
			return Color(red: 34.0 / 255.0, green: 197.0 / 255.0, blue: 94.0 / 255.0)
		case .leisure:
			return Color(red: 168.0 / 255.0, green: 85.0 / 255.0, blue: 247.0 / 255.0)
		case .chores:
			return Color(red: 250.0 / 255.0, green: 204.0 / 255.0, blue: 21.0 / 255.0)
		case .social:
			return Color(red: 236.0 / 255.0, green: 72.0 / 255.0, blue: 153.0 / 255.0)
		case .unknown:
			return Color(red: 107.0 / 255.0, green: 114.0 / 255.0, blue: 128.0 / 255.0)
		}
	}
}

struct DeviceIdentity: Codable, Hashable, Sendable {
	let userId: String
	let deviceId: String
	let username: String
	let signPubKeySpkiDerB64: String
	let dhPubKeySpkiDerB64: String
	let backendBaseURL: String
}

struct StoredKeyMaterial: Codable, Hashable, Sendable {
	let signPrivateKeyRawB64: String
	let dhPrivateKeyRawB64: String
}

struct PairingLink: Hashable, Sendable {
	let baseURL: URL
	let sessionId: String
	let code: String?

	static func parse(_ raw: String, defaultBaseURL: URL) -> PairingLink? {
		let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else {
			return nil
		}

		if let url = URL(string: trimmed), url.scheme != nil, url.host != nil {
			let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
			let sessionId =
				components?.queryItems?.first(where: { $0.name == "sessionId" })?.value
				?? components?.queryItems?.first(where: { $0.name == "session" })?.value
				?? url.pathComponents.last(where: { $0 != "/" }) ?? ""
			guard !sessionId.isEmpty else {
				return nil
			}
			let baseURL = URL(string: "\(url.scheme ?? "https")://\(url.host ?? "")\(url.port.map { ":\($0)" } ?? "")") ?? defaultBaseURL
			return PairingLink(
				baseURL: baseURL,
				sessionId: sessionId,
				code: components?.queryItems?.first(where: { $0.name == "code" })?.value
			)
		}

		return nil
	}
}

struct PairingClaimRequest: Codable, Sendable {
	let code: String?
	let deviceName: String
	let platform: String
	let signPubKey: String
	let dhPubKey: String
}

struct PairingClaimResponse: Codable, Sendable {
	let userId: String
	let deviceId: String
	let username: String
}

struct MobileActivityHourBucket: Codable, Hashable, Sendable {
	let hour: Int
	let durationSeconds: Int
	let category: WrappedCategory
	let appName: String?
}

struct MobileActivityDay: Codable, Hashable, Sendable {
	let deviceId: String
	let deviceName: String?
	let platform: String
	let dayStartMs: Int64
	let buckets: [MobileActivityHourBucket]
	let syncedAt: Int64
}

struct WrappedSlot: Codable, Hashable, Identifiable, Sendable {
	let id: Int
	let startMs: Int64
	let count: Int
	let category: WrappedCategory
	let appName: String?
	let source: WrappedSourceAccent
	let macCount: Int
	let iphoneCount: Int
}

struct DayWrappedSnapshot: Codable, Hashable, Sendable {
	let dayStartMs: Int64
	let title: String
	let subtitle: String
	let updatedAtMs: Int64
	let sourceSummary: String
	let pairedDeviceName: String?
	let mode: WrappedMode
	let slots: [WrappedSlot]
}

struct SyncDiagnostics: Codable, Hashable, Sendable {
	var requestedToken: String
	var requestedDayStartMs: Int64
	var requestedAtMs: Int64?
	var reportHostPresentedAtMs: Int64?
	var reportStartedAtMs: Int64?
	var reportFinishedAtMs: Int64?
	var producedDayStartMs: Int64?
	var producedBucketCount: Int?
	var lastReportError: String?
	var snapshotSavedAtMs: Int64?
	var snapshotDayStartMs: Int64?
	var lastManualMacSyncAtMs: Int64?
	var lastAutoMacSyncAtMs: Int64?
	var lastMacSyncError: String?
	var lastUploadAttemptAtMs: Int64?
	var lastUploadSuccessAtMs: Int64?
	var lastUploadError: String?

	init(
		requestedToken: String = "",
		requestedDayStartMs: Int64 = 0,
		requestedAtMs: Int64? = nil,
		reportHostPresentedAtMs: Int64? = nil,
		reportStartedAtMs: Int64? = nil,
		reportFinishedAtMs: Int64? = nil,
		producedDayStartMs: Int64? = nil,
		producedBucketCount: Int? = nil,
		lastReportError: String? = nil,
		snapshotSavedAtMs: Int64? = nil,
		snapshotDayStartMs: Int64? = nil,
		lastManualMacSyncAtMs: Int64? = nil,
		lastAutoMacSyncAtMs: Int64? = nil,
		lastMacSyncError: String? = nil,
		lastUploadAttemptAtMs: Int64? = nil,
		lastUploadSuccessAtMs: Int64? = nil,
		lastUploadError: String? = nil
	) {
		self.requestedToken = requestedToken
		self.requestedDayStartMs = requestedDayStartMs
		self.requestedAtMs = requestedAtMs
		self.reportHostPresentedAtMs = reportHostPresentedAtMs
		self.reportStartedAtMs = reportStartedAtMs
		self.reportFinishedAtMs = reportFinishedAtMs
		self.producedDayStartMs = producedDayStartMs
		self.producedBucketCount = producedBucketCount
		self.lastReportError = lastReportError
		self.snapshotSavedAtMs = snapshotSavedAtMs
		self.snapshotDayStartMs = snapshotDayStartMs
		self.lastManualMacSyncAtMs = lastManualMacSyncAtMs
		self.lastAutoMacSyncAtMs = lastAutoMacSyncAtMs
		self.lastMacSyncError = lastMacSyncError
		self.lastUploadAttemptAtMs = lastUploadAttemptAtMs
		self.lastUploadSuccessAtMs = lastUploadSuccessAtMs
		self.lastUploadError = lastUploadError
	}
}
