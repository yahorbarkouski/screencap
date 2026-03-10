import SwiftUI

@main
struct ScreencapMobileApp: App {
	@StateObject private var model = AppModel()

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
