import BackgroundTasks
import FamilyControls
import Foundation
import UIKit
import WidgetKit

@MainActor
final class AppModel: ObservableObject {
	static let backgroundRefreshTaskIdentifier = "app.screencap.mobile.refresh"
	nonisolated private static let autoSyncInterval: TimeInterval = 10 * 60

	private struct RepairExchangeSummary {
		let localBucketCount: Int?
		let uploadedLocalDay: Bool
		let snapshotSourceSummary: String?
	}

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
	@Published var uploadStatus: String?
	@Published var infoMessage: String?

	private var autoSyncTimer: Timer?
	private var isHandlingSceneActivation = false
	private var activeRefreshSequence = 0
	private var activeRefreshDayStartMs: Int64?

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
		if let snapshot {
			uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: snapshot.dayStartMs)
		}
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
		if let snapshot {
			uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: snapshot.dayStartMs)
		}
		startAutoSyncTimer()
		Self.scheduleBackgroundRefresh()
		AppGroupStore.appendLog(
			scope: "app",
			message:
				"scene became active trigger=\(trigger) selectedDayStartMs=\(selectedDayStartMs()) auth=\(authorizationStatusLabel()) credentials=\(AuthStore.signedRequestCredentialsDescription())"
		)

		if identity != nil {
			if authorizationStatus == .approved {
				await refreshSelectedDay(trigger: "scene-active")
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
				await refreshSelectedDay(trigger: "authorization")
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

	func refreshSelectedDay(trigger: String = "manual") async {
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

		if isRefreshing, activeRefreshDayStartMs == dayStartMs {
			AppGroupStore.appendLog(
				scope: "refresh",
				message:
					"skipped duplicate in-flight refresh dayStartMs=\(dayStartMs) trigger=\(trigger) sequence=\(activeRefreshSequence)"
			)
			return
		}
		if isRefreshing, let activeRefreshDayStartMs {
			AppGroupStore.appendLog(
				scope: "refresh",
				message:
					"superseding in-flight refresh oldDayStartMs=\(activeRefreshDayStartMs) newDayStartMs=\(dayStartMs) trigger=\(trigger) previousSequence=\(activeRefreshSequence)"
			)
		}

		let refreshStartedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
		activeRefreshSequence += 1
		let refreshSequence = activeRefreshSequence
		activeRefreshDayStartMs = dayStartMs
		reportRefreshToken = AppGroupStore.noteRefreshRequested(dayStartMs: dayStartMs)
		isRefreshing = true
		await waitForSnapshot(
			dayStartMs: dayStartMs,
			refreshStartedAtMs: refreshStartedAtMs,
			refreshSequence: refreshSequence,
			trigger: trigger
		)
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
		let preflight = await performBridgeProbe(
			dayStartMs: dayStartMs,
			probeToken: preflightToken,
			recordErrors: true
		)
		if preflight == nil {
			AppGroupStore.appendLog(
				scope: "repair",
				message: "preflight bridge probe failed dayStartMs=\(dayStartMs)"
			)
		}

		if authorizationStatus == .approved {
			await refreshSelectedDay(trigger: "repair")
		} else {
			await performMacSync(
				dayStartMs: dayStartMs,
				kind: "manual",
				recordErrors: true,
				updateVisibleSnapshot: true
			)
		}
		let exchangeSummary = await repairExchange(dayStartMs: dayStartMs)

		let postflightToken = UUID().uuidString
		let postflight = await performBridgeProbe(
			dayStartMs: dayStartMs,
			probeToken: postflightToken,
			recordErrors: false
		)

		if
			errorMessage == nil,
			let localBucketCount = exchangeSummary.localBucketCount,
			localBucketCount > 0,
			let postflight,
			postflight.requestedDayBucketCount == nil || postflight.requestedDayBucketCount == 0
		{
			errorMessage =
				"Repair uploaded iPhone data locally, but the Mac bridge still shows no cached iPhone day for \(formattedDay(dayStartMs))."
		}

		if
			errorMessage == nil,
			let localBucketCount = exchangeSummary.localBucketCount,
			localBucketCount > 0,
			let postflight,
			(postflight.requestedDayBucketCount ?? 0) > 0,
			!postflight.snapshotSourceSummary.localizedCaseInsensitiveContains("iphone")
		{
			errorMessage =
				"The Mac bridge cached the iPhone day for \(formattedDay(dayStartMs)), but the combined snapshot still excludes iPhone activity."
		}

		if errorMessage == nil {
			if let postflight {
				let localSummary =
					exchangeSummary.localBucketCount.map { " localBuckets=\($0)," } ?? ""
				infoMessage =
					"Re-sync completed. Bridge echo ok,\(localSummary) cached days=\(postflight.cachedDaysForRequestedDay), bridge buckets=\(postflight.requestedDayBucketCount ?? 0), events=\(postflight.eventCountForRequestedDay), active slots=\(postflight.activeSlotCount), source=\(postflight.snapshotSourceSummary)."
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
		Task { await refreshSelectedDay(trigger: "previous-day") }
	}

	func nextDay() {
		let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: selectedDay) ?? selectedDay
		let today = Calendar.current.startOfDay(for: Date())
		selectedDay = min(tomorrow, today)
		Task { await refreshSelectedDay(trigger: "next-day") }
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
			await refreshSelectedDay(trigger: "deep-link")
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

	private func waitForSnapshot(
		dayStartMs: Int64,
		refreshStartedAtMs: Int64,
		refreshSequence: Int,
		trigger: String
	) async {
		defer {
			if activeRefreshSequence == refreshSequence {
				isRefreshing = false
				activeRefreshDayStartMs = nil
			}
		}

		for _ in 0 ..< 60 {
			guard ensureCurrentRefresh(sequence: refreshSequence, dayStartMs: dayStartMs, stage: "poll-start") else {
				return
			}
			try? await Task.sleep(nanoseconds: 500_000_000)
			guard ensureCurrentRefresh(sequence: refreshSequence, dayStartMs: dayStartMs, stage: "poll-resume") else {
				return
			}

			if let day = AppGroupStore.loadMobileDay(dayStartMs: dayStartMs),
				day.syncedAt >= refreshStartedAtMs - 2_000
			{
				AppGroupStore.appendLog(
					scope: "refresh",
					message:
						"found fresh mobile day dayStartMs=\(day.dayStartMs) syncedAt=\(day.syncedAt) sequence=\(refreshSequence) trigger=\(trigger)"
				)
				if identity != nil {
					do {
						try await BackendClient.upload(day: day)
					} catch {
						errorMessage = error.localizedDescription
						AppGroupStore.saveUploadStatus(dayStartMs: dayStartMs, message: "Upload failed")
					}
				}
				guard ensureCurrentRefresh(sequence: refreshSequence, dayStartMs: dayStartMs, stage: "post-upload") else {
					return
				}
				if await performMacSync(
					dayStartMs: dayStartMs,
					kind: "manual",
					recordErrors: true,
					updateVisibleSnapshot: true
				) != nil {
					guard ensureCurrentRefresh(sequence: refreshSequence, dayStartMs: dayStartMs, stage: "post-mac-sync") else {
						return
					}
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

		guard ensureCurrentRefresh(sequence: refreshSequence, dayStartMs: dayStartMs, stage: "timeout") else {
			return
		}
		let diagnostics = AppGroupStore.loadDiagnostics()
		AppGroupStore.appendLog(
			scope: "refresh",
			message:
				"local wait ended without fresh day dayStartMs=\(dayStartMs) trigger=\(trigger) sequence=\(refreshSequence) hostPresented=\(diagnostics.reportHostPresentedAtMs.map(String.init) ?? "nil") reportStarted=\(diagnostics.reportStartedAtMs.map(String.init) ?? "nil") reportFinished=\(diagnostics.reportFinishedAtMs.map(String.init) ?? "nil") producedDayStartMs=\(diagnostics.producedDayStartMs.map(String.init) ?? "nil")"
		)

		if await performMacSync(
			dayStartMs: dayStartMs,
			kind: "manual",
			recordErrors: false,
			updateVisibleSnapshot: true
		) != nil {
			guard ensureCurrentRefresh(sequence: refreshSequence, dayStartMs: dayStartMs, stage: "fallback-mac-sync") else {
				return
			}
			uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: dayStartMs)
			infoMessage = "Using the latest snapshot from Mac while the iPhone export catches up."
		}

		if errorMessage == nil {
			errorMessage = buildRefreshFailureMessage(dayStartMs: dayStartMs)
		}
	}

	private func ensureCurrentRefresh(
		sequence: Int,
		dayStartMs: Int64,
		stage: String
	) -> Bool {
		guard activeRefreshSequence == sequence, activeRefreshDayStartMs == dayStartMs else {
			AppGroupStore.appendLog(
				scope: "refresh",
				message:
					"abandoning stale refresh dayStartMs=\(dayStartMs) sequence=\(sequence) stage=\(stage) activeSequence=\(activeRefreshSequence) activeDayStartMs=\(activeRefreshDayStartMs.map(String.init) ?? "nil")"
			)
			return false
		}
		return true
	}

	private func clearLocalArtifacts(dayStartMs: Int64) {
		AppGroupStore.clearSnapshot()
		AppGroupStore.deleteMobileDay(dayStartMs: dayStartMs)
		AppGroupStore.clearUploadStatus(dayStartMs: dayStartMs)
		snapshot = nil
		uploadStatus = nil
		WidgetCenter.shared.reloadAllTimelines()
		AppGroupStore.appendLog(
			scope: "repair",
			message: "cleared local artifacts dayStartMs=\(dayStartMs)"
		)
	}

	private func repairExchange(dayStartMs: Int64) async -> RepairExchangeSummary {
		var localBucketCount: Int?
		var uploadedLocalDay = false
		var snapshotSourceSummary: String?

		if let day = AppGroupStore.loadMobileDay(dayStartMs: dayStartMs) {
			localBucketCount = day.buckets.count
			do {
				try await BackendClient.upload(day: day)
				uploadedLocalDay = true
				AppGroupStore.appendLog(
					scope: "repair",
					message:
						"re-uploaded local mobile day dayStartMs=\(day.dayStartMs) buckets=\(day.buckets.count)"
				)
			} catch {
				AppGroupStore.appendLog(
					scope: "repair",
					message:
						"repair upload failed dayStartMs=\(day.dayStartMs) error=\(error.localizedDescription)"
				)
				if errorMessage == nil {
					errorMessage = "Repair upload failed: \(error.localizedDescription)"
				}
			}
		} else {
			AppGroupStore.appendLog(
				scope: "repair",
				message: "no local mobile day found after refresh dayStartMs=\(dayStartMs)"
			)
		}

		if let snapshot = await performMacSync(
			dayStartMs: dayStartMs,
			kind: "manual",
			recordErrors: errorMessage == nil,
			updateVisibleSnapshot: true
		) {
			snapshotSourceSummary = snapshot.sourceSummary
			AppGroupStore.appendLog(
				scope: "repair",
				message:
					"fetched combined snapshot after repair dayStartMs=\(snapshot.dayStartMs) source=\(snapshot.sourceSummary)"
			)
		}

		return RepairExchangeSummary(
			localBucketCount: localBucketCount,
			uploadedLocalDay: uploadedLocalDay,
			snapshotSourceSummary: snapshotSourceSummary
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
			if updateVisibleSnapshot {
				uploadStatus = AppGroupStore.loadUploadStatus(dayStartMs: dayStartMs)
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
		uploadStatus = "Debug sample snapshot"
		errorMessage = nil
		infoMessage = nil
		try? AppGroupStore.saveSnapshot(demoSnapshot)
		AppGroupStore.saveUploadStatus(
			dayStartMs: demoSnapshot.dayStartMs,
			message: "Debug sample snapshot"
		)
		AppGroupStore.saveWidgetSelectedDayStartMs(demoSnapshot.dayStartMs)
		AppGroupStore.saveWidgetMode(.categories)
		AppGroupStore.saveWidgetSourceFilter(.both)
		WidgetCenter.shared.reloadAllTimelines()
	}
#endif
}
