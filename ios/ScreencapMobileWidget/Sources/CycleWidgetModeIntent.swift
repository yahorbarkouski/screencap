import AppIntents
import WidgetKit

struct CycleWidgetModeIntent: AppIntent {
	static var title: LocalizedStringResource = "Cycle Day Wrapped Mode"

	func perform() async throws -> some IntentResult {
		let nextMode = AppGroupStore.loadWidgetMode().nextWidgetMode
		AppGroupStore.saveWidgetMode(nextMode)
		WidgetCenter.shared.reloadTimelines(ofKind: "ScreencapMobileWidget")
		return .result()
	}
}

struct CycleWidgetSourceFilterIntent: AppIntent {
	static var title: LocalizedStringResource = "Cycle Day Wrapped Source Filter"

	func perform() async throws -> some IntentResult {
		let nextFilter = AppGroupStore.loadWidgetSourceFilter().nextWidgetSourceFilter
		AppGroupStore.saveWidgetSourceFilter(nextFilter)
		WidgetCenter.shared.reloadTimelines(ofKind: "ScreencapMobileWidget")
		return .result()
	}
}
