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
