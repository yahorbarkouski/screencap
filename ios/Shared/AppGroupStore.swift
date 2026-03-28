import Foundation

enum AppGroupStore {
	static let groupIdentifier = "group.app.screencap.mobile"
	private static let snapshotFileName = "current-daywrapped-snapshot.json"
	private static let debugLogFileName = "mobile-debug.log"
	private static let reportTokenKey = "report.token"
	private static let reportDayKey = "report.dayStartMs"
	private static let uploadStatusKeyPrefix = "upload.status."
	private static let widgetModeKey = "widget.dayWrappedMode"
	private static let diagnosticsKey = "sync.diagnostics.v1"

	static var defaults: UserDefaults {
		UserDefaults(suiteName: groupIdentifier) ?? .standard
	}

	static func snapshotURL() -> URL {
		containerURL().appendingPathComponent(snapshotFileName)
	}

	static func mobileDayURL(dayStartMs: Int64) -> URL {
		containerURL().appendingPathComponent("mobile-day-\(dayStartMs).json")
	}

	static func saveSnapshot(_ snapshot: DayWrappedSnapshot) throws {
		try ensureContainerExists()
		let data = try JSONEncoder().encode(snapshot)
		try data.write(to: snapshotURL(), options: [.atomic])
		updateDiagnostics { diagnostics in
			diagnostics.snapshotSavedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
			diagnostics.snapshotDayStartMs = snapshot.dayStartMs
		}
	}

	static func loadSnapshot() -> DayWrappedSnapshot? {
		try? JSONDecoder().decode(DayWrappedSnapshot.self, from: Data(contentsOf: snapshotURL()))
	}

	static func clearSnapshot() {
		try? FileManager.default.removeItem(at: snapshotURL())
		updateDiagnostics { diagnostics in
			diagnostics.snapshotSavedAtMs = nil
			diagnostics.snapshotDayStartMs = nil
		}
	}

	static func saveMobileDay(_ day: MobileActivityDay) throws {
		try ensureContainerExists()
		let data = try JSONEncoder().encode(day)
		try data.write(to: mobileDayURL(dayStartMs: day.dayStartMs), options: [.atomic])
		updateDiagnostics { diagnostics in
			diagnostics.reportFinishedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
			diagnostics.producedDayStartMs = day.dayStartMs
			diagnostics.producedBucketCount = day.buckets.count
			diagnostics.lastReportError = nil
		}
	}

	static func loadMobileDay(dayStartMs: Int64) -> MobileActivityDay? {
		try? JSONDecoder().decode(
			MobileActivityDay.self,
			from: Data(contentsOf: mobileDayURL(dayStartMs: dayStartMs))
		)
	}

	static func noteRefreshRequested(dayStartMs: Int64) -> String {
		let token = UUID().uuidString
		defaults.set(token, forKey: reportTokenKey)
		defaults.set(dayStartMs, forKey: reportDayKey)
		let now = Int64(Date().timeIntervalSince1970 * 1000)
		updateDiagnostics { diagnostics in
			diagnostics.requestedToken = token
			diagnostics.requestedDayStartMs = dayStartMs
			diagnostics.requestedAtMs = now
			diagnostics.reportHostPresentedAtMs = nil
			diagnostics.reportStartedAtMs = nil
			diagnostics.reportFinishedAtMs = nil
			diagnostics.producedDayStartMs = nil
			diagnostics.producedBucketCount = nil
			diagnostics.lastReportError = nil
		}
		return token
	}

	static func latestRequestedToken() -> String {
		defaults.string(forKey: reportTokenKey) ?? ""
	}

	static func latestRequestedDayStartMs() -> Int64 {
		if let value = defaults.object(forKey: reportDayKey) as? Int64 {
			return value
		}
		if let value = defaults.object(forKey: reportDayKey) as? Int {
			return Int64(value)
		}
		if let value = defaults.object(forKey: reportDayKey) as? NSNumber {
			return value.int64Value
		}
		return 0
	}

	static func saveUploadStatus(dayStartMs: Int64, message: String) {
		defaults.set(message, forKey: uploadStatusKeyPrefix + String(dayStartMs))
	}

	static func loadUploadStatus(dayStartMs: Int64) -> String? {
		defaults.string(forKey: uploadStatusKeyPrefix + String(dayStartMs))
	}

	static func saveWidgetMode(_ mode: WrappedMode) {
		defaults.set(mode.rawValue, forKey: widgetModeKey)
	}

	static func loadWidgetMode() -> WrappedMode {
		if
			let rawValue = defaults.string(forKey: widgetModeKey),
			let mode = WrappedMode(rawValue: rawValue)
		{
			return mode
		}
		return .categories
	}

	static func loadDiagnostics() -> SyncDiagnostics {
		guard let data = defaults.data(forKey: diagnosticsKey) else {
			return SyncDiagnostics()
		}
		return (try? JSONDecoder().decode(SyncDiagnostics.self, from: data))
			?? SyncDiagnostics()
	}

	static func markReportHostPresented() {
		updateDiagnostics { diagnostics in
			diagnostics.reportHostPresentedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
		}
	}

	static func markReportStarted() {
		updateDiagnostics { diagnostics in
			diagnostics.reportStartedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
			diagnostics.lastReportError = nil
		}
	}

	static func markReportFinished(dayStartMs: Int64, bucketCount: Int) {
		updateDiagnostics { diagnostics in
			diagnostics.reportFinishedAtMs = Int64(Date().timeIntervalSince1970 * 1000)
			diagnostics.producedDayStartMs = dayStartMs
			diagnostics.producedBucketCount = bucketCount
			diagnostics.lastReportError = nil
		}
	}

	static func markReportError(_ message: String) {
		updateDiagnostics { diagnostics in
			diagnostics.lastReportError = message
		}
	}

	static func noteUploadAttempt() {
		updateDiagnostics { diagnostics in
			diagnostics.lastUploadAttemptAtMs = Int64(Date().timeIntervalSince1970 * 1000)
			diagnostics.lastUploadError = nil
		}
	}

	static func noteUploadSuccess() {
		updateDiagnostics { diagnostics in
			let now = Int64(Date().timeIntervalSince1970 * 1000)
			diagnostics.lastUploadAttemptAtMs = now
			diagnostics.lastUploadSuccessAtMs = now
			diagnostics.lastUploadError = nil
		}
	}

	static func noteUploadFailure(_ message: String) {
		updateDiagnostics { diagnostics in
			diagnostics.lastUploadAttemptAtMs = Int64(Date().timeIntervalSince1970 * 1000)
			diagnostics.lastUploadError = message
		}
	}

	static func noteMacSync(kind: String, succeeded: Bool, error: String? = nil) {
		updateDiagnostics { diagnostics in
			let now = Int64(Date().timeIntervalSince1970 * 1000)
			if kind == "auto" {
				diagnostics.lastAutoMacSyncAtMs = now
			} else {
				diagnostics.lastManualMacSyncAtMs = now
			}
			diagnostics.lastMacSyncError = succeeded ? nil : error
		}
	}

	static func appendLog(scope: String, message: String) {
		do {
			try ensureContainerExists()
			let timestamp = ISO8601DateFormatter().string(from: Date())
			let line = "[\(timestamp)] [\(scope)] \(message)\n"
			let logURL = containerURL().appendingPathComponent(debugLogFileName)
			let previous = (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
			let combined = trimLog(previous + line)
			try combined.write(to: logURL, atomically: true, encoding: .utf8)
		} catch {}
	}

	static func loadRecentLogs() -> String {
		let logURL = containerURL().appendingPathComponent(debugLogFileName)
		return (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
	}

	static func fileSummary(url: URL) -> String {
		guard FileManager.default.fileExists(atPath: url.path) else {
			return "missing"
		}
		do {
			let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
			let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
			let modifiedAt = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
			return "exists size=\(size) modifiedAtMs=\(Int64(modifiedAt * 1000))"
		} catch {
			return "exists metadataError=\(error.localizedDescription)"
		}
	}

	private static func ensureContainerExists() throws {
		try FileManager.default.createDirectory(
			at: containerURL(),
			withIntermediateDirectories: true,
			attributes: nil
		)
	}

	private static func containerURL() -> URL {
		if let url = FileManager.default.containerURL(
			forSecurityApplicationGroupIdentifier: groupIdentifier
		) {
			return url
		}

		let fallback = FileManager.default.urls(
			for: .applicationSupportDirectory,
			in: .userDomainMask
		).first ?? FileManager.default.temporaryDirectory
		return fallback.appendingPathComponent("ScreencapMobileFallback", isDirectory: true)
	}

	private static func updateDiagnostics(
		_ mutate: (inout SyncDiagnostics) -> Void
	) {
		var diagnostics = loadDiagnostics()
		mutate(&diagnostics)
		if let data = try? JSONEncoder().encode(diagnostics) {
			defaults.set(data, forKey: diagnosticsKey)
		}
	}

	private static func trimLog(_ value: String) -> String {
		let lines = value.split(separator: "\n", omittingEmptySubsequences: false)
		let trimmedLines = lines.suffix(300)
		return trimmedLines.joined(separator: "\n")
	}
}
