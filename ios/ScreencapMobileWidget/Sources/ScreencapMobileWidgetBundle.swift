import SwiftUI
import WidgetKit

struct ScreencapWidgetEntry: TimelineEntry {
	let date: Date
	let snapshot: DayWrappedSnapshot?
	let mode: WrappedMode
	let isPlaceholder: Bool
}

struct ScreencapWidgetProvider: TimelineProvider {
	func placeholder(in _: Context) -> ScreencapWidgetEntry {
		ScreencapWidgetEntry(
			date: Date(),
			snapshot: sampleSnapshot(),
			mode: .categories,
			isPlaceholder: true
		)
	}

	func getSnapshot(in context: Context, completion: @escaping (ScreencapWidgetEntry) -> Void) {
		let snapshot = context.isPreview ? sampleSnapshot() : AppGroupStore.loadWidgetSnapshot()
		completion(
			ScreencapWidgetEntry(
				date: Date(),
				snapshot: snapshot,
				mode: AppGroupStore.loadWidgetMode(),
				isPlaceholder: context.isPreview
			)
		)
	}

	func getTimeline(in _: Context, completion: @escaping (Timeline<ScreencapWidgetEntry>) -> Void) {
		let entry = ScreencapWidgetEntry(
			date: Date(),
			snapshot: AppGroupStore.loadWidgetSnapshot(),
			mode: AppGroupStore.loadWidgetMode(),
			isPlaceholder: false
		)
		completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60))))
	}

	private func sampleSnapshot() -> DayWrappedSnapshot {
		DayWrappedRendering.sampleSnapshot()
	}
}

struct ScreencapMobileWidget: Widget {
	var body: some WidgetConfiguration {
		StaticConfiguration(kind: "ScreencapMobileWidget", provider: ScreencapWidgetProvider()) { entry in
			DayWrappedWidgetView(snapshot: entry.snapshot, mode: entry.mode)
				.containerBackground(for: .widget) {
					LinearGradient(
						colors: [
							Color(red: 0.04, green: 0.05, blue: 0.08),
							Color(red: 0.02, green: 0.03, blue: 0.05),
						],
						startPoint: .topLeading,
						endPoint: .bottomTrailing
					)
				}
				.widgetURL(URL(string: "screencapmobile://wrapped/\((entry.snapshot?.dayStartMs) ?? Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000))"))
			}
			.contentMarginsDisabled()
			.configurationDisplayName("Day Wrapped")
			.description("Shows your combined Mac and iPhone Day Wrapped snapshot in a compact one-row home-screen widget.")
			.supportedFamilies([.systemMedium])
		}
	}

@main
struct ScreencapMobileWidgetBundle: WidgetBundle {
	var body: some Widget {
		ScreencapMobileWidget()
	}
}
