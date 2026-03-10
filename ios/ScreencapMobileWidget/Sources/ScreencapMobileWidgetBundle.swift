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
		let snapshot = context.isPreview ? sampleSnapshot() : AppGroupStore.loadSnapshot()
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
			snapshot: AppGroupStore.loadSnapshot(),
			mode: AppGroupStore.loadWidgetMode(),
			isPlaceholder: false
		)
		completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60))))
	}

	private func sampleSnapshot() -> DayWrappedSnapshot {
		let dayStart = Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
		let activeSlots: [Int: WrappedSlot] = [
			12 * 6 + 0: WrappedSlot(id: 72, startMs: dayStart + Int64(72 * 10 * 60 * 1000), count: 2, category: .study, appName: "Arc", source: .mac, macCount: 2, iphoneCount: 0),
			12 * 6 + 1: WrappedSlot(id: 73, startMs: dayStart + Int64(73 * 10 * 60 * 1000), count: 2, category: .study, appName: "Arc", source: .mac, macCount: 2, iphoneCount: 0),
			14 * 6 + 0: WrappedSlot(id: 84, startMs: dayStart + Int64(84 * 10 * 60 * 1000), count: 4, category: .work, appName: "VS Code", source: .both, macCount: 3, iphoneCount: 4),
			14 * 6 + 1: WrappedSlot(id: 85, startMs: dayStart + Int64(85 * 10 * 60 * 1000), count: 4, category: .work, appName: "VS Code", source: .both, macCount: 3, iphoneCount: 4),
			19 * 6 + 0: WrappedSlot(id: 114, startMs: dayStart + Int64(114 * 10 * 60 * 1000), count: 3, category: .leisure, appName: "YouTube", source: .iphone, macCount: 0, iphoneCount: 3),
			19 * 6 + 1: WrappedSlot(id: 115, startMs: dayStart + Int64(115 * 10 * 60 * 1000), count: 3, category: .leisure, appName: "YouTube", source: .iphone, macCount: 0, iphoneCount: 3),
		]

		let slots = (0 ..< DayWrappedRendering.slotsPerDay).map { index in
			activeSlots[index]
				?? WrappedSlot(
					id: index,
					startMs: dayStart + Int64(index * 10 * 60 * 1000),
					count: 0,
					category: .unknown,
					appName: nil,
					source: .none,
					macCount: 0,
					iphoneCount: 0
				)
		}

		return DayWrappedSnapshot(
			dayStartMs: dayStart,
			title: "DAY WRAPPED",
			subtitle: Date(timeIntervalSince1970: TimeInterval(dayStart) / 1000).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()),
			updatedAtMs: dayStart,
			sourceSummary: "Mac + iPhone",
			pairedDeviceName: "iPhone",
			mode: .categories,
			slots: slots
		)
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
		.description("Shows your combined Mac and iPhone Day Wrapped snapshot using the desktop popup visual system.")
		.supportedFamilies([.systemLarge])
	}
}

@main
struct ScreencapMobileWidgetBundle: WidgetBundle {
	var body: some Widget {
		ScreencapMobileWidget()
	}
}
