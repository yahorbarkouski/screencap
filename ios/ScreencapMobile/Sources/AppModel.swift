import BackgroundTasks
import Dispatch
import FamilyControls
import Foundation
import UIKit
import WidgetKit

@MainActor
final class AppModel: ObservableObject {
	static let backgroundRefreshTaskIdentifier = "app.screencap.mobile.refresh"
	nonisolated private static let autoSyncInterval: TimeInterval = 10 * 60
	nonisolated private static let reportExportTimeoutNs: UInt64 = 45_000_000_000
	nonisolated private static let reportExportPollIntervalNs: UInt64 = 750_000_000

	@Published var identity: DeviceIdentity?
	@Published var snapshot: DayWrappedSnapshot?
	@Published var authorizationStatus: AuthorizationStatus
	@Published var selectedDay: Date
	@Published var reportRefreshToken: String
	@Published var isRefreshing = false
	@Published var isPairing = false
	@Published var isSyncingFromMac = false
	@Published var isRepairing = false
	@Published var errorMessage: String?
	@Published var infoMessage: String?

	private var autoSyncTimer: Timer?
	private var isHandlingSceneActivation = false

	#if DEBUG
	private var isDemoLayoutEnabled: Bool {
		ProcessInfo.processInfo.arguments.contains("--demo-layout")
	}
	#endif

	init() {
		AuthStore.migrateLegacyKeyMaterialIfNeeded()
		identity = AuthStore.loadIdentity()
		snapshot = AppGroupStore.loadSnapshot()
		authorizationStatus = AuthorizationCenter.shared.authorizationStatus
		selectedDay = Calendar.current.startOfDay(for: Date())
		reportRefreshToken = AppGroupStore.latestRequestedToken()
#if DEBUG
		applyDemoLayoutStateIfNeeded()
#endif
	}

	func sceneBecameActive(trigger: String = "scene-active") async {
#if DEBUG
		if isDemoLayoutEnabled {
			applyDemoLayoutStateIfNeeded()
			return
		}
#endif
		if isHandlingSceneActivation {
			AppGroupStore.appendLog(
				scope: "app",
				message:
					"coalesced scene activation trigger=\(trigger) selectedDayStartMs=\(selectedDayStartMs())"
			)
			return
		}
		isHandlingSceneActivation = true
		defer { isHandlingSceneActivation = false }

		AuthStore.migrateLegacyKeyMaterialIfNeeded()
		authorizationStatus = AuthorizationCenter.shared.authorizationStatus
		snapshot = AppGroupStore.loadSnapshot()
		startAutoSyncTimer()
		Self.scheduleBackgroundRefresh()
		AppGroupStore.appendLog(
			scope: "app",
			message:
				"scene became active trigger=\(trigger) selectedDayStartMs=\(selectedDayStartMs()) auth=\(authorizationStatusLabel()) credentials=\(AuthStore.signedRequestCredentialsDescription())"
		)

		if identity != nil {
			if authorizationStatus == .approved {
				await refreshSelectedDay(trigger: "scene-active", syncMacFirst: true)
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
				await refreshSelectedDay(trigger: "authorization", syncMacFirst: true)
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
			if authorizationStatus == .approved {
				let dayStartMs = selectedDayStartMs()
				let token = issueReportRefresh(
					dayStartMs: dayStartMs,
					reason: "pairing",
					showLoading: true
				)
				await waitForFreshImportedDay(
					dayStartMs: dayStartMs,
					token: token,
					reason: "pairing"
				)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func refreshSelectedDay(
		trigger: String = "manual",
		syncMacFirst: Bool = false
	) async {
		let dayStartMs = selectedDayStartMs()
		errorMessage = nil
		infoMessage = nil
		AppGroupStore.appendLog(
			scope: "refresh",
			message:
				"refresh selected day requested dayStartMs=\(dayStartMs) trigger=\(trigger) auth=\(authorizationStatusLabel())"
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

		if syncMacFirst {
			_ = await performMacSync(
				dayStartMs: dayStartMs,
				kind: "manual",
				recordErrors: false,
				updateVisibleSnapshot: true
			)
		}
		let token = issueReportRefresh(
			dayStartMs: dayStartMs,
			reason: trigger,
			showLoading: true
		)
		await waitForFreshImportedDay(
			dayStartMs: dayStartMs,
			token: token,
			reason: trigger
		)
	}

	func syncFromMac() async {
		infoMessage = nil
		let dayStartMs = selectedDayStartMs()
		let syncedSnapshot = await performMacSync(
			dayStartMs: selectedDayStartMs(),
			kind: "manual",
			recordErrors: true,
			updateVisibleSnapshot: true
		)
		if authorizationStatus == .approved, syncedSnapshot != nil {
			let token = issueReportRefresh(
				dayStartMs: dayStartMs,
				reason: "sync-from-mac",
				showLoading: true
			)
			await waitForFreshImportedDay(
				dayStartMs: dayStartMs,
				token: token,
				reason: "sync-from-mac"
			)
		}
		if errorMessage == nil, syncedSnapshot != nil {
			infoMessage = "Synced latest Day Wrapped from Mac."
		}
	}

	func resync() async {
		let dayStartMs = selectedDayStartMs()
		errorMessage = nil
		infoMessage = nil
		isRepairing = true
		AppGroupStore.noteRepairStarted()
		AppGroupStore.appendLog(
			scope: "repair",
			message: "starting safe re-sync dayStartMs=\(dayStartMs)"
		)
		defer {
			AppGroupStore.noteRepairCompleted(error: errorMessage)
			isRepairing = false
		}

		clearLocalArtifacts(dayStartMs: dayStartMs)
		let preflightToken = UUID().uuidString
		let _ = await performBridgeProbe(
			dayStartMs: dayStartMs,
			probeToken: preflightToken,
			recordErrors: false
		)

		let nextSnapshot = await performMacSync(
			dayStartMs: dayStartMs,
			kind: "manual",
			recordErrors: true,
			updateVisibleSnapshot: true
		)
		if authorizationStatus == .approved, nextSnapshot != nil {
			let token = issueReportRefresh(
				dayStartMs: dayStartMs,
				reason: "repair",
				showLoading: true
			)
			await waitForFreshImportedDay(
				dayStartMs: dayStartMs,
				token: token,
				reason: "repair"
			)
		}

		let postflightToken = UUID().uuidString
		let postflight = await performBridgeProbe(
			dayStartMs: dayStartMs,
			probeToken: postflightToken,
			recordErrors: false
		)

		if errorMessage == nil {
			if let postflight {
				infoMessage =
					"Re-sync completed. Bridge ok, cached days=\(postflight.cachedDaysForRequestedDay), bridge buckets=\(postflight.requestedDayBucketCount ?? 0), events=\(postflight.eventCountForRequestedDay), active slots=\(postflight.activeSlotCount), source=\(postflight.snapshotSourceSummary)."
			} else {
				infoMessage = "Re-sync completed."
			}
		} else if let postflight {
			infoMessage =
				"Bridge is reachable and reports cached days=\(postflight.cachedDaysForRequestedDay), bridge buckets=\(postflight.requestedDayBucketCount ?? 0), events=\(postflight.eventCountForRequestedDay), active slots=\(postflight.activeSlotCount), source=\(postflight.snapshotSourceSummary)."
		}
	}

	func previousDay() {
		selectedDay = Calendar.current.date(byAdding: .day, value: -1, to: selectedDay) ?? selectedDay
		Task { await refreshSelectedDay(trigger: "previous-day", syncMacFirst: true) }
	}

	func nextDay() {
		let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: selectedDay) ?? selectedDay
		let today = Calendar.current.startOfDay(for: Date())
		selectedDay = min(tomorrow, today)
		Task { await refreshSelectedDay(trigger: "next-day", syncMacFirst: true) }
	}

	func forgetDevice() {
		stopAutoSyncTimer()
		AuthStore.clear()
		AppGroupStore.clearSnapshot()
		identity = nil
		snapshot = nil
		infoMessage = nil
		errorMessage = nil
		WidgetCenter.shared.reloadAllTimelines()
		AppGroupStore.appendLog(scope: "app", message: "forgot paired device")
	}

	func reportHostPresented() {
		AppGroupStore.appendLog(
			scope: "refresh",
			message:
				"report host presented token=\(reportRefreshToken) dayStartMs=\(selectedDayStartMs())"
		)
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
			"identity.credentialsStatus=\(AuthStore.signedRequestCredentialsDescription())",
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
			"diagnostics.lastBridgeProbeAtMs=\(diagnostics.lastBridgeProbeAtMs.map(String.init) ?? "nil")",
			"diagnostics.lastBridgeProbeToken=\(diagnostics.lastBridgeProbeToken ?? "nil")",
			"diagnostics.lastBridgeProbeEchoToken=\(diagnostics.lastBridgeProbeEchoToken ?? "nil")",
			"diagnostics.lastBridgeProbeError=\(diagnostics.lastBridgeProbeError ?? "nil")",
			"diagnostics.lastBridgeCachedDaysForRequestedDay=\(diagnostics.lastBridgeCachedDaysForRequestedDay.map(String.init) ?? "nil")",
			"diagnostics.lastBridgeCachedDayStarts=\(diagnostics.lastBridgeCachedDayStarts?.map(String.init).joined(separator: ",") ?? "nil")",
			"diagnostics.lastBridgeRequestedDayBucketCount=\(diagnostics.lastBridgeRequestedDayBucketCount.map(String.init) ?? "nil")",
			"diagnostics.lastBridgeEventCountForRequestedDay=\(diagnostics.lastBridgeEventCountForRequestedDay.map(String.init) ?? "nil")",
			"diagnostics.lastBridgeActiveSlotCount=\(diagnostics.lastBridgeActiveSlotCount.map(String.init) ?? "nil")",
			"diagnostics.lastBridgeSourceSummary=\(diagnostics.lastBridgeSourceSummary ?? "nil")",
			"diagnostics.lastRepairStartedAtMs=\(diagnostics.lastRepairStartedAtMs.map(String.init) ?? "nil")",
			"diagnostics.lastRepairCompletedAtMs=\(diagnostics.lastRepairCompletedAtMs.map(String.init) ?? "nil")",
			"diagnostics.lastRepairError=\(diagnostics.lastRepairError ?? "nil")",
			"",
			"Latest bridge log tail:",
			diagnostics.lastBridgeLogTail ?? "",
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
			await refreshSelectedDay(trigger: "deep-link", syncMacFirst: true)
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
		switch AuthStore.loadSignedRequestCredentials() {
		case .missingIdentity:
			AppGroupStore.appendLog(scope: "bg-refresh", message: "skipped background refresh because identity is missing")
			return true
		case .missingKeyMaterial:
			let message =
				"skipped background refresh because signing keys are unavailable; open the iPhone app once to refresh shared credentials"
			AppGroupStore.noteMacSync(kind: "auto", succeeded: false, error: message)
			AppGroupStore.appendLog(scope: "bg-refresh", message: message)
			return false
		case .available:
			break
		}

		let todayStartMs = Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
		AppGroupStore.appendLog(
			scope: "bg-refresh",
			message:
				"running background refresh dayStartMs=\(todayStartMs) credentials=\(AuthStore.signedRequestCredentialsDescription())"
		)

		if let mobileDay = AppGroupStore.loadMobileDay(dayStartMs: todayStartMs) {
			do {
				try await BackendClient.upload(day: mobileDay)
				AppGroupStore.appendLog(
					scope: "bg-refresh",
					message: "uploaded pending mobile day dayStartMs=\(todayStartMs)"
				)
			} catch {
				AppGroupStore.appendLog(
					scope: "bg-refresh",
					message:
						"pending mobile day upload failed dayStartMs=\(todayStartMs) error=\(error.localizedDescription)"
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
		let nextSnapshot = await performMacSync(
			dayStartMs: todayStartMs,
			kind: "auto",
			recordErrors: false,
			updateVisibleSnapshot: selectedDayStartMs() == todayStartMs
		)
		if authorizationStatus == .approved, nextSnapshot != nil, selectedDayStartMs() == todayStartMs {
			_ = issueReportRefresh(
				dayStartMs: todayStartMs,
				reason: "auto-mac-sync",
				showLoading: false
			)
		}
	}

	private func issueReportRefresh(
		dayStartMs: Int64,
		reason: String,
		showLoading: Bool
	) -> String {
		let token = AppGroupStore.noteRefreshRequested(dayStartMs: dayStartMs)
		reportRefreshToken = token
		if showLoading {
			isRefreshing = true
		}
		AppGroupStore.appendLog(
			scope: "refresh",
			message: "issued in-app report refresh dayStartMs=\(dayStartMs) reason=\(reason) token=\(token)"
		)
		return token
	}

	private func waitForFreshImportedDay(
		dayStartMs: Int64,
		token: String,
		reason: String
	) async {
		let requestedAtMs =
			AppGroupStore.loadDiagnostics().requestedAtMs
			?? Int64(Date().timeIntervalSince1970 * 1000)
		let deadlineNs =
			DispatchTime.now().uptimeNanoseconds + Self.reportExportTimeoutNs

		while DispatchTime.now().uptimeNanoseconds < deadlineNs {
			if reportRefreshToken != token {
				isRefreshing = false
				AppGroupStore.appendLog(
					scope: "refresh",
					message:
						"refresh wait superseded dayStartMs=\(dayStartMs) reason=\(reason) token=\(token) currentToken=\(reportRefreshToken)"
				)
				return
			}

			let diagnostics = AppGroupStore.loadDiagnostics()
			if
				diagnostics.producedDayStartMs == dayStartMs,
				let finishedAtMs = diagnostics.reportFinishedAtMs,
				finishedAtMs >= requestedAtMs,
				let day = AppGroupStore.loadMobileDay(dayStartMs: dayStartMs)
			{
				AppGroupStore.appendLog(
					scope: "refresh",
					message:
						"detected fresh mobile day dayStartMs=\(dayStartMs) buckets=\(day.buckets.count) reason=\(reason)"
				)
				_ = await uploadLocalMobileDayIfAvailable(dayStartMs: dayStartMs)
				_ = await performMacSync(
					dayStartMs: dayStartMs,
					kind: "manual",
					recordErrors: true,
					updateVisibleSnapshot: true
				)
				isRefreshing = false
				return
			}

			try? await Task.sleep(nanoseconds: Self.reportExportPollIntervalNs)
		}

		let diagnostics = AppGroupStore.loadDiagnostics()
		AppGroupStore.appendLog(
			scope: "refresh",
			message:
				"local wait ended without fresh day dayStartMs=\(dayStartMs) trigger=\(reason) token=\(token) reportStarted=\(diagnostics.reportStartedAtMs.map(String.init) ?? "nil") reportFinished=\(diagnostics.reportFinishedAtMs.map(String.init) ?? "nil") producedDayStartMs=\(diagnostics.producedDayStartMs.map(String.init) ?? "nil")"
		)

		let probeToken = UUID().uuidString
		let bridge = await performBridgeProbe(
			dayStartMs: dayStartMs,
			probeToken: probeToken,
			recordErrors: false
		)
		if let bridge, bridge.cachedDaysForRequestedDay > 0 {
			AppGroupStore.appendLog(
				scope: "refresh",
				message:
					"bridge already has imported mobile day dayStartMs=\(dayStartMs) cachedDays=\(bridge.cachedDaysForRequestedDay)"
			)
			_ = await performMacSync(
				dayStartMs: dayStartMs,
				kind: "manual",
				recordErrors: true,
				updateVisibleSnapshot: true
			)
			isRefreshing = false
			return
		}

		if errorMessage == nil {
			errorMessage =
				"iPhone activity export did not finish in time. The report host rendered, but no fresh imported day reached the Mac."
		}
		isRefreshing = false
	}

	@discardableResult
	private func uploadLocalMobileDayIfAvailable(dayStartMs: Int64) async -> Bool {
		guard let day = AppGroupStore.loadMobileDay(dayStartMs: dayStartMs) else {
			return false
		}
		AppGroupStore.appendLog(
			scope: "upload",
			message:
				"upload fallback starting dayStartMs=\(dayStartMs) buckets=\(day.buckets.count)"
		)
		do {
			try await BackendClient.upload(day: day)
			AppGroupStore.appendLog(
				scope: "upload",
				message: "upload fallback finished dayStartMs=\(dayStartMs)"
			)
			return true
		} catch {
			AppGroupStore.appendLog(
				scope: "upload",
				message:
					"upload fallback failed dayStartMs=\(dayStartMs) error=\(error.localizedDescription)"
			)
			return false
		}
	}

	private func clearLocalArtifacts(dayStartMs: Int64) {
		AppGroupStore.clearSnapshot()
		AppGroupStore.deleteMobileDay(dayStartMs: dayStartMs)
		AppGroupStore.clearUploadStatus(dayStartMs: dayStartMs)
		snapshot = nil
		WidgetCenter.shared.reloadAllTimelines()
		AppGroupStore.appendLog(
			scope: "repair",
			message: "cleared local artifacts dayStartMs=\(dayStartMs)"
		)
	}

	@discardableResult
	private func performBridgeProbe(
		dayStartMs: Int64,
		probeToken: String,
		recordErrors: Bool
	) async -> BridgeDiagnosticsResponse? {
		guard identity != nil else { return nil }
		do {
			let response = try await BackendClient.fetchBridgeDiagnostics(
				dayStartMs: dayStartMs,
				probeToken: probeToken
			)
			if response.requestedDayStartMs != dayStartMs {
				let message =
					"Bridge probe day mismatch. Sent \(dayStartMs), got \(response.requestedDayStartMs)."
				AppGroupStore.noteBridgeDiagnosticsFailure(probeToken: probeToken, error: message)
				AppGroupStore.appendLog(scope: "bridge-probe", message: message)
				if recordErrors {
					errorMessage = message
				}
				return nil
			}
			if response.echoedProbeToken != probeToken {
				let message =
					"Bridge probe token mismatch. Sent \(probeToken), got \(response.echoedProbeToken ?? "nil")."
				AppGroupStore.noteBridgeDiagnosticsFailure(probeToken: probeToken, error: message)
				AppGroupStore.appendLog(scope: "bridge-probe", message: message)
				if recordErrors {
					errorMessage = message
				}
				return nil
			}
			AppGroupStore.noteBridgeDiagnosticsSuccess(
				probeToken: probeToken,
				response: response
			)
			AppGroupStore.appendLog(
				scope: "bridge-probe",
				message:
					"verified bridge diagnostics dayStartMs=\(response.requestedDayStartMs) cachedDays=\(response.cachedDaysForRequestedDay) bridgeBuckets=\(response.requestedDayBucketCount ?? 0) events=\(response.eventCountForRequestedDay) activeSlots=\(response.activeSlotCount) source=\(response.snapshotSourceSummary)"
			)
			return response
		} catch {
			AppGroupStore.noteBridgeDiagnosticsFailure(
				probeToken: probeToken,
				error: error.localizedDescription
			)
			if recordErrors {
				errorMessage = error.localizedDescription
			}
			return nil
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
		AppGroupStore.appendLog(
			scope: "mac-sync",
			message:
				"starting \(kind) Mac sync dayStartMs=\(dayStartMs) updateVisibleSnapshot=\(updateVisibleSnapshot)"
		)
		do {
			let nextSnapshot = try await BackendClient.fetchSnapshot(dayStartMs: dayStartMs)
			try? AppGroupStore.saveSnapshot(nextSnapshot)
			AppGroupStore.noteMacSync(kind: kind, succeeded: true)
			if updateVisibleSnapshot || snapshot == nil || snapshot?.dayStartMs == nextSnapshot.dayStartMs {
				snapshot = nextSnapshot
			}
			if recordErrors {
				errorMessage = nil
			}
			WidgetCenter.shared.reloadAllTimelines()
			AppGroupStore.appendLog(
				scope: "mac-sync",
				message:
					"finished \(kind) Mac sync dayStartMs=\(nextSnapshot.dayStartMs) source=\(nextSnapshot.sourceSummary)"
			)
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
			AppGroupStore.appendLog(
				scope: "mac-sync",
				message:
					"failed \(kind) Mac sync dayStartMs=\(dayStartMs) error=\(error.localizedDescription)"
			)
			return nil
		}
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

#if DEBUG
	private func applyDemoLayoutStateIfNeeded() {
		guard isDemoLayoutEnabled else { return }
		let demoSnapshot = DayWrappedRendering.sampleSnapshot()
		identity = DeviceIdentity(
			userId: "debug-user",
			deviceId: "debug-device",
			username: "mantegna",
			signPubKeySpkiDerB64: "",
			dhPubKeySpkiDerB64: "",
			backendBaseURL: "http://127.0.0.1"
		)
		snapshot = demoSnapshot
		authorizationStatus = .approved
		selectedDay = Date(timeIntervalSince1970: TimeInterval(demoSnapshot.dayStartMs) / 1000)
		errorMessage = nil
		infoMessage = nil
		try? AppGroupStore.saveSnapshot(demoSnapshot)
		AppGroupStore.saveWidgetSelectedDayStartMs(demoSnapshot.dayStartMs)
		AppGroupStore.saveWidgetMode(.categories)
		AppGroupStore.saveWidgetSourceFilter(.both)
		WidgetCenter.shared.reloadAllTimelines()
	}
#endif
}
