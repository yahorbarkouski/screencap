import FamilyControls
import Foundation
import WidgetKit

@MainActor
final class AppModel: ObservableObject {
	@Published var identity: DeviceIdentity?
	@Published var snapshot: DayWrappedSnapshot?
	@Published var authorizationStatus: AuthorizationStatus
	@Published var selectedDay: Date
	@Published var reportRefreshToken: String
	@Published var isRefreshing = false
	@Published var isPairing = false
	@Published var errorMessage: String?
	@Published var uploadStatus: String?

	init() {
		identity = AuthStore.loadIdentity()
		snapshot = AppGroupStore.loadSnapshot()
		authorizationStatus = AuthorizationCenter.shared.authorizationStatus
		selectedDay = Calendar.current.startOfDay(for: Date())
		reportRefreshToken = AppGroupStore.latestRequestedToken()
		if let snapshot {
			uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: snapshot.dayStartMs)
		}
	}

	func sceneBecameActive() async {
		authorizationStatus = AuthorizationCenter.shared.authorizationStatus
		snapshot = AppGroupStore.loadSnapshot()
		if let snapshot {
			uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: snapshot.dayStartMs)
		}

		if identity != nil {
			if authorizationStatus == .approved {
				await refreshSelectedDay()
			} else {
				await fetchCombinedSnapshot(
					dayStartMs: Int64(Calendar.current.startOfDay(for: selectedDay).timeIntervalSince1970 * 1000),
					recordErrors: false
				)
			}
		}
	}

	func requestAuthorization() async {
		errorMessage = nil
		do {
			try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
			authorizationStatus = AuthorizationCenter.shared.authorizationStatus
			if authorizationStatus == .approved {
				await refreshSelectedDay()
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func pair(using rawValue: String) async {
		errorMessage = nil
		isPairing = true
		defer { isPairing = false }

		do {
			identity = try await BackendClient.claimPairingSession(from: rawValue)
			await fetchCombinedSnapshot(
				dayStartMs: Int64(Calendar.current.startOfDay(for: selectedDay).timeIntervalSince1970 * 1000),
				recordErrors: false
			)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func refreshSelectedDay() async {
		let dayStartMs = Int64(Calendar.current.startOfDay(for: selectedDay).timeIntervalSince1970 * 1000)
		guard authorizationStatus == .approved else {
			await fetchCombinedSnapshot(dayStartMs: dayStartMs, recordErrors: true)
			return
		}

		let refreshStartedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
		reportRefreshToken = AppGroupStore.noteRefreshRequested(dayStartMs: dayStartMs)
		isRefreshing = true
		errorMessage = nil
		await waitForSnapshot(dayStartMs: dayStartMs, refreshStartedAtMs: refreshStartedAtMs)
	}

	func previousDay() {
		selectedDay = Calendar.current.date(byAdding: .day, value: -1, to: selectedDay) ?? selectedDay
		Task { await refreshSelectedDay() }
	}

	func nextDay() {
		let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: selectedDay) ?? selectedDay
		let today = Calendar.current.startOfDay(for: Date())
		selectedDay = min(tomorrow, today)
		Task { await refreshSelectedDay() }
	}

	func forgetDevice() {
		AuthStore.clear()
		AppGroupStore.clearSnapshot()
		identity = nil
		snapshot = nil
		uploadStatus = nil
		errorMessage = nil
		WidgetCenter.shared.reloadAllTimelines()
	}

	func handleOpenURL(_ url: URL) {
		guard url.scheme == "screencapmobile" else {
			return
		}

		let components = url.pathComponents.filter { $0 != "/" }
		guard url.host == "wrapped" || components.first == "wrapped" else {
			return
		}

		let rawDayStart =
			url.host == "wrapped"
			? components.first
			: components.dropFirst().first
		guard
			let rawDayStart,
			let dayStartMs = Int64(rawDayStart)
		else {
			return
		}

		selectedDay = Date(timeIntervalSince1970: TimeInterval(dayStartMs) / 1000)
		Task {
			await refreshSelectedDay()
		}
	}

	private func waitForSnapshot(dayStartMs: Int64, refreshStartedAtMs: Int64) async {
		defer { isRefreshing = false }

		for _ in 0 ..< 16 {
			try? await Task.sleep(nanoseconds: 350_000_000)

			guard let day = AppGroupStore.loadMobileDay(dayStartMs: dayStartMs) else {
				continue
			}
			guard day.syncedAt >= refreshStartedAtMs - 2_000 else {
				continue
			}
			if identity != nil {
				do {
					try await BackendClient.upload(day: day)
				} catch {
					errorMessage = error.localizedDescription
					AppGroupStore.saveUploadStatus(dayStartMs: dayStartMs, message: "Upload failed")
				}
			}
			if await fetchCombinedSnapshot(dayStartMs: dayStartMs, recordErrors: true) != nil {
				uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: dayStartMs)
				return
			}
		}

		if await fetchCombinedSnapshot(dayStartMs: dayStartMs, recordErrors: false) != nil {
			uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: dayStartMs)
			return
		}

		errorMessage = errorMessage ?? "Screen Time data did not arrive yet. Open the view again in a moment."
	}

	@discardableResult
	private func fetchCombinedSnapshot(
		dayStartMs: Int64,
		recordErrors: Bool
	) async -> DayWrappedSnapshot? {
		guard identity != nil else { return nil }
		do {
			let nextSnapshot = try await BackendClient.fetchSnapshot(dayStartMs: dayStartMs)
			try? AppGroupStore.saveSnapshot(nextSnapshot)
			snapshot = nextSnapshot
			uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: dayStartMs)
			errorMessage = nil
			WidgetCenter.shared.reloadAllTimelines()
			return nextSnapshot
		} catch {
			if recordErrors {
				errorMessage = error.localizedDescription
			}
			return nil
		}
	}
}
