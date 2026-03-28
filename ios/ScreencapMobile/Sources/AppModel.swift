import BackgroundTasks
import FamilyControls
import Foundation
import UIKit
import WidgetKit

@MainActor
final class AppModel: ObservableObject {
	static let backgroundRefreshTaskIdentifier = "app.screencap.mobile.refresh"
	nonisolated private static let autoSyncInterval: TimeInterval = 10 * 60

	@Published var identity: DeviceIdentity?
	@Published var snapshot: DayWrappedSnapshot?
	@Published var authorizationStatus: AuthorizationStatus
	@Published var selectedDay: Date
	@Published var reportRefreshToken: String
	@Published var isRefreshing = false
	@Published var isPairing = false
	@Published var isSyncingFromMac = false
	@Published var errorMessage: String?
	@Published var uploadStatus: String?
	@Published var infoMessage: String?

	private var autoSyncTimer: Timer?

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
		startAutoSyncTimer()
		Self.scheduleBackgroundRefresh()
		AppGroupStore.appendLog(
			scope: "app",
			message: "scene became active selectedDayStartMs=\(selectedDayStartMs()) auth=\(authorizationStatusLabel())"
		)

		if identity != nil {
			if authorizationStatus == .approved {
				await refreshSelectedDay()
			} else {
				await performMacSync(
					dayStartMs: selectedDayStartMs(),
					kind: "manual",
					recordErrors: false,
					updateVisibleSnapshot: true
				)
			}
		}
	}

	func sceneMovedToBackground() {
		stopAutoSyncTimer()
		Self.scheduleBackgroundRefresh()
		AppGroupStore.appendLog(scope: "app", message: "scene moved to background")
	}

	func requestAuthorization() async {
		errorMessage = nil
		do {
			try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
			authorizationStatus = AuthorizationCenter.shared.authorizationStatus
			AppGroupStore.appendLog(
				scope: "auth",
				message: "authorization status after request=\(authorizationStatusLabel())"
			)
			if authorizationStatus == .approved {
				await refreshSelectedDay()
			}
		} catch {
			errorMessage = error.localizedDescription
			AppGroupStore.appendLog(
				scope: "auth",
				message: "authorization request failed error=\(error.localizedDescription)"
			)
		}
	}

	func pair(using rawValue: String) async {
		errorMessage = nil
		infoMessage = nil
		isPairing = true
		defer { isPairing = false }

		do {
			identity = try await BackendClient.claimPairingSession(from: rawValue)
			startAutoSyncTimer()
			Self.scheduleBackgroundRefresh()
			await performMacSync(
				dayStartMs: selectedDayStartMs(),
				kind: "manual",
				recordErrors: false,
				updateVisibleSnapshot: true
			)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func refreshSelectedDay() async {
		let dayStartMs = selectedDayStartMs()
		errorMessage = nil
		infoMessage = nil
		AppGroupStore.appendLog(
			scope: "refresh",
			message: "refresh selected day requested dayStartMs=\(dayStartMs) auth=\(authorizationStatusLabel())"
		)

		guard authorizationStatus == .approved else {
			await performMacSync(
				dayStartMs: dayStartMs,
				kind: "manual",
				recordErrors: true,
				updateVisibleSnapshot: true
			)
			return
		}

		let refreshStartedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
		reportRefreshToken = AppGroupStore.noteRefreshRequested(dayStartMs: dayStartMs)
		isRefreshing = true
		await waitForSnapshot(dayStartMs: dayStartMs, refreshStartedAtMs: refreshStartedAtMs)
	}

	func syncFromMac() async {
		infoMessage = nil
		await performMacSync(
			dayStartMs: selectedDayStartMs(),
			kind: "manual",
			recordErrors: true,
			updateVisibleSnapshot: true
		)
		if errorMessage == nil {
			infoMessage = "Synced latest Day Wrapped from Mac."
		}
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
		stopAutoSyncTimer()
		AuthStore.clear()
		AppGroupStore.clearSnapshot()
		identity = nil
		snapshot = nil
		uploadStatus = nil
		infoMessage = nil
		errorMessage = nil
		WidgetCenter.shared.reloadAllTimelines()
		AppGroupStore.appendLog(scope: "app", message: "forgot paired device")
	}

	func copyLogs() {
		let selectedDayStartMs = selectedDayStartMs()
		let diagnostics = AppGroupStore.loadDiagnostics()
		let report = [
			"Screencap iPhone diagnostics",
			"selectedDayStartMs=\(selectedDayStartMs)",
			"authorizationStatus=\(authorizationStatusLabel())",
			"identity.userId=\(identity?.userId ?? "none")",
			"identity.username=\(identity?.username ?? "none")",
			"identity.backendBaseURL=\(identity?.backendBaseURL ?? "none")",
			"snapshotFile=\(AppGroupStore.fileSummary(url: AppGroupStore.snapshotURL()))",
			"selectedMobileDayFile=\(AppGroupStore.fileSummary(url: AppGroupStore.mobileDayURL(dayStartMs: selectedDayStartMs)))",
			"diagnostics.requestedToken=\(diagnostics.requestedToken)",
			"diagnostics.requestedDayStartMs=\(diagnostics.requestedDayStartMs)",
			"diagnostics.requestedAtMs=\(diagnostics.requestedAtMs.map(String.init) ?? "nil")",
			"diagnostics.reportHostPresentedAtMs=\(diagnostics.reportHostPresentedAtMs.map(String.init) ?? "nil")",
			"diagnostics.reportStartedAtMs=\(diagnostics.reportStartedAtMs.map(String.init) ?? "nil")",
			"diagnostics.reportFinishedAtMs=\(diagnostics.reportFinishedAtMs.map(String.init) ?? "nil")",
			"diagnostics.producedDayStartMs=\(diagnostics.producedDayStartMs.map(String.init) ?? "nil")",
			"diagnostics.producedBucketCount=\(diagnostics.producedBucketCount.map(String.init) ?? "nil")",
			"diagnostics.lastReportError=\(diagnostics.lastReportError ?? "nil")",
			"diagnostics.snapshotSavedAtMs=\(diagnostics.snapshotSavedAtMs.map(String.init) ?? "nil")",
			"diagnostics.snapshotDayStartMs=\(diagnostics.snapshotDayStartMs.map(String.init) ?? "nil")",
			"diagnostics.lastManualMacSyncAtMs=\(diagnostics.lastManualMacSyncAtMs.map(String.init) ?? "nil")",
			"diagnostics.lastAutoMacSyncAtMs=\(diagnostics.lastAutoMacSyncAtMs.map(String.init) ?? "nil")",
			"diagnostics.lastMacSyncError=\(diagnostics.lastMacSyncError ?? "nil")",
			"diagnostics.lastUploadAttemptAtMs=\(diagnostics.lastUploadAttemptAtMs.map(String.init) ?? "nil")",
			"diagnostics.lastUploadSuccessAtMs=\(diagnostics.lastUploadSuccessAtMs.map(String.init) ?? "nil")",
			"diagnostics.lastUploadError=\(diagnostics.lastUploadError ?? "nil")",
			"",
			"Recent logs:",
			AppGroupStore.loadRecentLogs(),
		].joined(separator: "\n")
		UIPasteboard.general.string = report
		infoMessage = "Copied iPhone diagnostics to clipboard."
		AppGroupStore.appendLog(
			scope: "debug",
			message: "copied diagnostics for dayStartMs=\(selectedDayStartMs)"
		)
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

	nonisolated static func registerBackgroundRefreshTask() {
		BGTaskScheduler.shared.register(
			forTaskWithIdentifier: backgroundRefreshTaskIdentifier,
			using: nil
		) { task in
			guard let task = task as? BGAppRefreshTask else {
				task.setTaskCompleted(success: false)
				return
			}
			handleBackgroundRefresh(task)
		}
	}

	nonisolated static func scheduleBackgroundRefresh() {
		let request = BGAppRefreshTaskRequest(identifier: backgroundRefreshTaskIdentifier)
		request.earliestBeginDate = Date(timeIntervalSinceNow: autoSyncInterval)
		do {
			try BGTaskScheduler.shared.submit(request)
			AppGroupStore.appendLog(
				scope: "bg-refresh",
				message: "scheduled background refresh earliestInSeconds=\(Int(autoSyncInterval))"
			)
		} catch {
			AppGroupStore.appendLog(
				scope: "bg-refresh",
				message: "failed to schedule background refresh error=\(error.localizedDescription)"
			)
		}
	}

	nonisolated private static func handleBackgroundRefresh(_ task: BGAppRefreshTask) {
		scheduleBackgroundRefresh()
		task.expirationHandler = {
			AppGroupStore.appendLog(scope: "bg-refresh", message: "background refresh expired")
		}

		Task {
			let success = await performBackgroundRefresh()
			task.setTaskCompleted(success: success)
		}
	}

	nonisolated private static func performBackgroundRefresh() async -> Bool {
		guard AuthStore.loadIdentity() != nil else {
			AppGroupStore.appendLog(scope: "bg-refresh", message: "skipped background refresh because identity is missing")
			return true
		}

		let todayStartMs = Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
		AppGroupStore.appendLog(
			scope: "bg-refresh",
			message: "running background refresh dayStartMs=\(todayStartMs)"
		)

		if let day = AppGroupStore.loadMobileDay(dayStartMs: todayStartMs) {
			do {
				try await BackendClient.upload(day: day)
			} catch {
				AppGroupStore.appendLog(
					scope: "bg-refresh",
					message: "background upload failed error=\(error.localizedDescription)"
				)
			}
		}

		do {
			let snapshot = try await BackendClient.fetchSnapshot(dayStartMs: todayStartMs)
			try AppGroupStore.saveSnapshot(snapshot)
			AppGroupStore.noteMacSync(kind: "auto", succeeded: true)
			WidgetCenter.shared.reloadAllTimelines()
			AppGroupStore.appendLog(
				scope: "bg-refresh",
				message: "background snapshot refresh succeeded dayStartMs=\(snapshot.dayStartMs)"
			)
			return true
		} catch {
			AppGroupStore.noteMacSync(
				kind: "auto",
				succeeded: false,
				error: error.localizedDescription
			)
			AppGroupStore.appendLog(
				scope: "bg-refresh",
				message: "background snapshot refresh failed error=\(error.localizedDescription)"
			)
			return false
		}
	}

	private func selectedDayStartMs() -> Int64 {
		Int64(Calendar.current.startOfDay(for: selectedDay).timeIntervalSince1970 * 1000)
	}

	private func startAutoSyncTimer() {
		stopAutoSyncTimer()
		guard identity != nil else { return }
		let timer = Timer.scheduledTimer(withTimeInterval: Self.autoSyncInterval, repeats: true) {
			[weak self] _ in
			Task { @MainActor in
				await self?.runForegroundAutoSync()
			}
		}
		timer.tolerance = 60
		autoSyncTimer = timer
		AppGroupStore.appendLog(scope: "auto-sync", message: "started foreground auto-sync timer")
	}

	private func stopAutoSyncTimer() {
		autoSyncTimer?.invalidate()
		autoSyncTimer = nil
	}

	private func runForegroundAutoSync() async {
		let todayStartMs = Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
		await performMacSync(
			dayStartMs: todayStartMs,
			kind: "auto",
			recordErrors: false,
			updateVisibleSnapshot: selectedDayStartMs() == todayStartMs
		)
	}

	private func waitForSnapshot(dayStartMs: Int64, refreshStartedAtMs: Int64) async {
		defer { isRefreshing = false }

		for _ in 0 ..< 60 {
			try? await Task.sleep(nanoseconds: 500_000_000)

			if let day = AppGroupStore.loadMobileDay(dayStartMs: dayStartMs),
				day.syncedAt >= refreshStartedAtMs - 2_000
			{
				AppGroupStore.appendLog(
					scope: "refresh",
					message: "found fresh mobile day dayStartMs=\(day.dayStartMs) syncedAt=\(day.syncedAt)"
				)
				if identity != nil {
					do {
						try await BackendClient.upload(day: day)
					} catch {
						errorMessage = error.localizedDescription
						AppGroupStore.saveUploadStatus(dayStartMs: dayStartMs, message: "Upload failed")
					}
				}
				if await performMacSync(
					dayStartMs: dayStartMs,
					kind: "manual",
					recordErrors: true,
					updateVisibleSnapshot: true
				) != nil {
					uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: dayStartMs)
					return
				}
			}

			let diagnostics = AppGroupStore.loadDiagnostics()
			if let producedDayStartMs = diagnostics.producedDayStartMs,
				producedDayStartMs != dayStartMs
			{
				errorMessage = "Screen Time export produced \(formattedDay(producedDayStartMs)) instead of the requested day."
				AppGroupStore.appendLog(
					scope: "refresh",
					message: "report day mismatch requested=\(dayStartMs) produced=\(producedDayStartMs)"
				)
				break
			}

			if let reportError = diagnostics.lastReportError, !reportError.isEmpty {
				errorMessage = "Screen Time export failed: \(reportError)"
				break
			}
		}

		if await performMacSync(
			dayStartMs: dayStartMs,
			kind: "manual",
			recordErrors: false,
			updateVisibleSnapshot: true
		) != nil {
			uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: dayStartMs)
			infoMessage = "Using the latest snapshot from Mac while the iPhone export catches up."
		}

		if errorMessage == nil {
			errorMessage = buildRefreshFailureMessage(dayStartMs: dayStartMs)
		}
	}

	@discardableResult
	private func performMacSync(
		dayStartMs: Int64,
		kind: String,
		recordErrors: Bool,
		updateVisibleSnapshot: Bool
	) async -> DayWrappedSnapshot? {
		if kind == "manual" {
			isSyncingFromMac = true
		}
		defer {
			if kind == "manual" {
				isSyncingFromMac = false
			}
		}

		guard identity != nil else { return nil }
		do {
			let nextSnapshot = try await BackendClient.fetchSnapshot(dayStartMs: dayStartMs)
			try? AppGroupStore.saveSnapshot(nextSnapshot)
			AppGroupStore.noteMacSync(kind: kind, succeeded: true)
			if updateVisibleSnapshot || snapshot == nil || snapshot?.dayStartMs == nextSnapshot.dayStartMs {
				snapshot = nextSnapshot
			}
			if updateVisibleSnapshot {
				uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: dayStartMs)
			}
			if recordErrors {
				errorMessage = nil
			}
			WidgetCenter.shared.reloadAllTimelines()
			return nextSnapshot
		} catch {
			AppGroupStore.noteMacSync(
				kind: kind,
				succeeded: false,
				error: error.localizedDescription
			)
			if recordErrors {
				errorMessage = error.localizedDescription
			}
			return nil
		}
	}

	private func buildRefreshFailureMessage(dayStartMs: Int64) -> String {
		let diagnostics = AppGroupStore.loadDiagnostics()
		if let reportError = diagnostics.lastReportError, !reportError.isEmpty {
			return "Screen Time export failed: \(reportError)"
		}
		if diagnostics.reportHostPresentedAtMs == nil {
			return "Screen Time refresh UI never appeared. Reopen the app and try again."
		}
		if diagnostics.reportStartedAtMs == nil {
			return "Screen Time report extension did not start. Use Copy Logs and check the report markers."
		}
		if diagnostics.reportFinishedAtMs == nil {
			return "Screen Time report extension started but did not finish for \(formattedDay(dayStartMs))."
		}
		if diagnostics.producedDayStartMs == nil {
			return "Screen Time report finished without writing a day file for \(formattedDay(dayStartMs))."
		}
		return "Screen Time data did not arrive for \(formattedDay(dayStartMs)). Use Copy Logs to inspect the refresh lifecycle."
	}

	private func formattedDay(_ dayStartMs: Int64) -> String {
		Date(timeIntervalSince1970: TimeInterval(dayStartMs) / 1000)
			.formatted(date: .abbreviated, time: .omitted)
	}

	private func authorizationStatusLabel() -> String {
		switch authorizationStatus {
		case .approved:
			return "approved"
		case .denied:
			return "denied"
		case .notDetermined:
			return "notDetermined"
		@unknown default:
			return "unknown"
		}
	}
}
