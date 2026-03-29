import SwiftUI
import WidgetKit

struct ScreencapWidgetEntry: TimelineEntry {
	let date: Date
	let snapshot: DayWrappedSnapshot?
	let mode: WrappedMode
	let sourceFilter: WrappedSourceFilter
	let isPlaceholder: Bool
}

struct ScreencapWidgetProvider: TimelineProvider {
	private func resolvedSnapshot(preview: Bool) -> DayWrappedSnapshot? {
		if preview {
			return sampleSnapshot()
		}

		if let snapshot = AppGroupStore.loadWidgetSnapshot() {
			return snapshot
		}

		#if DEBUG
			return sampleSnapshot()
		#else
			return nil
		#endif
	}

	func placeholder(in _: Context) -> ScreencapWidgetEntry {
		ScreencapWidgetEntry(
			date: Date(),
			snapshot: sampleSnapshot(),
			mode: .categories,
			sourceFilter: .both,
			isPlaceholder: true
		)
	}

	func getSnapshot(in context: Context, completion: @escaping (ScreencapWidgetEntry) -> Void) {
		completion(
			ScreencapWidgetEntry(
				date: Date(),
				snapshot: resolvedSnapshot(preview: context.isPreview),
				mode: AppGroupStore.loadWidgetMode(),
				sourceFilter: AppGroupStore.loadWidgetSourceFilter(),
				isPlaceholder: context.isPreview
			)
		)
	}

	func getTimeline(in _: Context, completion: @escaping (Timeline<ScreencapWidgetEntry>) -> Void) {
		let entry = ScreencapWidgetEntry(
			date: Date(),
			snapshot: resolvedSnapshot(preview: false),
			mode: AppGroupStore.loadWidgetMode(),
			sourceFilter: AppGroupStore.loadWidgetSourceFilter(),
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
			DayWrappedWidgetView(
				snapshot: entry.snapshot,
				mode: entry.mode,
				sourceFilter: entry.sourceFilter
			)
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
