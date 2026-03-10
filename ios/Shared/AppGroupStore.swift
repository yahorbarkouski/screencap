import Foundation

enum AppGroupStore {
	static let groupIdentifier = "group.app.screencap.mobile"
	private static let snapshotFileName = "current-daywrapped-snapshot.json"
	private static let reportTokenKey = "report.token"
	private static let reportDayKey = "report.dayStartMs"
	private static let uploadStatusKeyPrefix = "upload.status."
	private static let widgetModeKey = "widget.dayWrappedMode"

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
	}

	static func loadSnapshot() -> DayWrappedSnapshot? {
		try? JSONDecoder().decode(DayWrappedSnapshot.self, from: Data(contentsOf: snapshotURL()))
	}

	static func clearSnapshot() {
		try? FileManager.default.removeItem(at: snapshotURL())
	}

	static func saveMobileDay(_ day: MobileActivityDay) throws {
		try ensureContainerExists()
		let data = try JSONEncoder().encode(day)
		try data.write(to: mobileDayURL(dayStartMs: day.dayStartMs), options: [.atomic])
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
}
