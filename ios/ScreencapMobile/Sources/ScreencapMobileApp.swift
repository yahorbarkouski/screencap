import SwiftUI

@main
struct ScreencapMobileApp: App {
	@StateObject private var model = AppModel()

	init() {
		AppModel.registerBackgroundRefreshTask()
		AppModel.scheduleBackgroundRefresh()
	}

	var body: some Scene {
		WindowGroup {
			RootView()
				.environmentObject(model)
				.onOpenURL { url in
					model.handleOpenURL(url)
				}
		}
	}
}
