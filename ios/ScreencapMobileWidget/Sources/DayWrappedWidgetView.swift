import AppIntents
import SwiftUI
import WidgetKit

struct DayWrappedWidgetView: View {
	@Environment(\.widgetFamily) private var widgetFamily

	let snapshot: DayWrappedSnapshot?
	let mode: WrappedMode

	private var metrics: WidgetMetrics {
		WidgetMetrics.resolve(for: widgetFamily)
	}

	private var resolvedSnapshot: DayWrappedSnapshot {
		let base = snapshot ?? emptySnapshot
		return DayWrappedSnapshot(
			dayStartMs: base.dayStartMs,
			title: base.title,
			subtitle: base.subtitle,
			updatedAtMs: base.updatedAtMs,
			sourceSummary: base.sourceSummary,
			pairedDeviceName: base.pairedDeviceName,
			mode: displayedMode,
			slots: base.slots
		)
	}

	private var displayedMode: WrappedMode {
		metrics.showsModeSwitcher ? mode : .categories
	}

	private var orderedSlots: [WrappedSlot] {
		var result: [WrappedSlot] = []
		result.reserveCapacity(resolvedSnapshot.slots.count)
		for slice in 0 ..< DayWrappedRendering.slicesPerHour {
			for hour in 0 ..< 24 {
				let index = hour * DayWrappedRendering.slicesPerHour + slice
				result.append(resolvedSnapshot.slots[index])
			}
		}
		return result
	}

	private var timeMarkers: [Int] {
		DayWrappedRendering.timeMarkers(for: resolvedSnapshot)
	}

	private var gridColumns: [GridItem] {
		Array(
			repeating: GridItem(.flexible(minimum: 0, maximum: .infinity), spacing: metrics.gridGap),
			count: 24
		)
	}

	private var hasIphoneSourceAccent: Bool {
		resolvedSnapshot.slots.contains { $0.source == .iphone || $0.source == .both }
	}

	private var isShowingToday: Bool {
		Calendar.current.isDateInToday(
			Date(timeIntervalSince1970: TimeInterval(resolvedSnapshot.dayStartMs) / 1000)
		)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: metrics.sectionSpacing) {
			header
			grid
			if metrics.showsFooter {
				footer
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.padding(metrics.outerPadding)
	}

	private var header: some View {
		HStack(alignment: .top, spacing: 10) {
			VStack(alignment: .leading, spacing: metrics.headerTextSpacing) {
				Text(resolvedSnapshot.subtitle)
					.font(.system(size: metrics.titleFontSize, weight: .semibold, design: .rounded))
					.foregroundStyle(.white)
					.lineLimit(1)
					.minimumScaleFactor(0.72)

				if metrics.showsSourceSummary {
					Text(resolvedSnapshot.sourceSummary)
						.font(.system(size: 11, weight: .medium, design: .rounded))
						.foregroundStyle(.white.opacity(0.48))
						.lineLimit(1)
				}
			}

			Spacer(minLength: 8)

			HStack(spacing: 6) {
				Button(intent: PreviousWidgetDayIntent()) {
					Image(systemName: "chevron.left")
				}
				.buttonStyle(.plain)
				.widgetControlStyle(size: metrics.toggleHeight)

				Button(intent: NextWidgetDayIntent()) {
					Image(systemName: "chevron.right")
				}
				.buttonStyle(.plain)
				.widgetControlStyle(size: metrics.toggleHeight)
				.opacity(isShowingToday ? 0.45 : 1)
				.disabled(isShowingToday)

				if metrics.showsModeSwitcher {
					Button(intent: CycleWidgetModeIntent()) {
						HStack(spacing: 6) {
							Image(systemName: displayedMode == .categories ? "square.grid.3x3.fill" : "macwindow")
								.font(.system(size: metrics.toggleIconSize, weight: .semibold))
							if metrics.showsModeLabel {
								Text(modeLabel)
									.font(.system(size: metrics.toggleFontSize, weight: .semibold, design: .rounded))
									.lineLimit(1)
									.minimumScaleFactor(0.82)
							}
						}
						.foregroundStyle(.white.opacity(0.84))
						.padding(.horizontal, metrics.toggleHorizontalPadding)
						.frame(height: metrics.toggleHeight)
						.background(
							Capsule(style: .continuous)
								.fill(Color.white.opacity(0.08))
						)
					}
					.buttonStyle(.plain)
				}
			}
		}
	}

	private var grid: some View {
		VStack(alignment: .leading, spacing: metrics.gridSectionSpacing) {
			LazyVGrid(columns: gridColumns, spacing: metrics.gridGap) {
				ForEach(Array(orderedSlots.enumerated()), id: \.offset) { _, slot in
					RoundedRectangle(cornerRadius: metrics.cellCornerRadius, style: .continuous)
						.fill(slotFill(for: slot))
						.overlay {
							if let accent = sourceAccentColor(for: slot.source) {
								RoundedRectangle(cornerRadius: metrics.cellCornerRadius, style: .continuous)
									.stroke(accent, lineWidth: metrics.accentLineWidth)
							}
						}
						.aspectRatio(1, contentMode: .fit)
				}
			}

			LazyVGrid(columns: gridColumns, spacing: 0) {
				ForEach(0 ..< 24, id: \.self) { hour in
					Text(timeMarkers.contains(hour) ? DayWrappedRendering.hourString(for: hour) : "")
						.font(.system(size: metrics.timeFontSize, weight: .medium, design: .monospaced))
						.foregroundStyle(timeMarkers.contains(hour) ? .white.opacity(0.46) : .clear)
						.lineLimit(1)
						.minimumScaleFactor(0.7)
						.frame(maxWidth: .infinity)
				}
			}
		}
	}

	private var footer: some View {
		ViewThatFits(in: .horizontal) {
			HStack(spacing: 8) {
				if let pairedDeviceName = resolvedSnapshot.pairedDeviceName, !pairedDeviceName.isEmpty {
					WidgetBadge(
						text: pairedDeviceName,
						icon: "iphone.gen3",
						tint: WidgetPalette.iphoneAccent
					)
				}

				if hasIphoneSourceAccent {
					WidgetBadge(
						text: "Synced",
						icon: "arrow.triangle.2.circlepath",
						tint: WidgetPalette.bothAccent
					)
				}
			}

			VStack(alignment: .leading, spacing: 6) {
				if let pairedDeviceName = resolvedSnapshot.pairedDeviceName, !pairedDeviceName.isEmpty {
					WidgetBadge(
						text: pairedDeviceName,
						icon: "iphone.gen3",
						tint: WidgetPalette.iphoneAccent
					)
				}

				if hasIphoneSourceAccent {
					WidgetBadge(
						text: "Synced",
						icon: "arrow.triangle.2.circlepath",
						tint: WidgetPalette.bothAccent
					)
				}
			}
		}
	}

	private func slotFill(for slot: WrappedSlot) -> Color {
		slot.count > 0
			? DayWrappedRendering.slotColor(slot: slot, mode: displayedMode)
			: Color.white.opacity(0.05)
	}

	private func sourceAccentColor(for source: WrappedSourceAccent) -> Color? {
		switch source {
		case .iphone:
			return WidgetPalette.iphoneAccent.opacity(0.72)
		case .both:
			return WidgetPalette.bothAccent.opacity(0.82)
		case .none, .mac:
			return nil
		}
	}

	private var modeLabel: String {
		switch displayedMode {
		case .categories:
			return metrics.showsSourceSummary ? "Categories" : "Cats"
		case .apps:
			return "Apps"
		}
	}

	private var emptySnapshot: DayWrappedSnapshot {
		let dayStartMs = Int64(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000)
		let slots = (0 ..< DayWrappedRendering.slotsPerDay).map { index in
			WrappedSlot(
				id: index,
				startMs: dayStartMs + Int64(index * 10 * 60 * 1000),
				count: 0,
				category: .unknown,
				appName: nil,
				source: .none,
				macCount: 0,
				iphoneCount: 0
			)
		}

		return DayWrappedSnapshot(
			dayStartMs: dayStartMs,
			title: "DAY WRAPPED",
			subtitle: Date(timeIntervalSince1970: TimeInterval(dayStartMs) / 1000)
				.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()),
			updatedAtMs: dayStartMs,
			sourceSummary: "No activity",
			pairedDeviceName: nil,
			mode: .categories,
			slots: slots
		)
	}
}

private struct WidgetBadge: View {
	let text: String
	let icon: String
	let tint: Color

	var body: some View {
		HStack(spacing: 6) {
			Image(systemName: icon)
				.font(.system(size: 9, weight: .semibold))
			Text(text)
				.font(.system(size: 10, weight: .semibold, design: .rounded))
				.lineLimit(1)
				.minimumScaleFactor(0.72)
		}
		.foregroundStyle(tint)
		.padding(.horizontal, 9)
		.frame(height: 26)
		.background(
			Capsule(style: .continuous)
				.fill(Color.white.opacity(0.07))
		)
	}
}

private extension View {
	func widgetControlStyle(size: CGFloat) -> some View {
		font(.system(size: 12, weight: .semibold))
			.frame(width: size, height: size)
			.background(
				RoundedRectangle(cornerRadius: size * 0.4, style: .continuous)
					.fill(Color.white.opacity(0.08))
			)
			.foregroundStyle(.white.opacity(0.88))
	}
}

private struct WidgetMetrics {
	let outerPadding: CGFloat
	let sectionSpacing: CGFloat
	let headerTextSpacing: CGFloat
	let gridSectionSpacing: CGFloat
	let gridGap: CGFloat
	let cellCornerRadius: CGFloat
	let accentLineWidth: CGFloat
	let titleFontSize: CGFloat
	let timeFontSize: CGFloat
	let toggleHeight: CGFloat
	let toggleHorizontalPadding: CGFloat
	let toggleIconSize: CGFloat
	let toggleFontSize: CGFloat
	let showsModeSwitcher: Bool
	let showsModeLabel: Bool
	let showsSourceSummary: Bool
	let showsFooter: Bool

	static func resolve(for family: WidgetFamily) -> WidgetMetrics {
		switch family {
		case .systemMedium:
			return WidgetMetrics(
				outerPadding: 12,
				sectionSpacing: 7,
				headerTextSpacing: 1,
				gridSectionSpacing: 4,
				gridGap: 2,
				cellCornerRadius: 3,
				accentLineWidth: 0.8,
				titleFontSize: 15,
				timeFontSize: 7,
				toggleHeight: 22,
				toggleHorizontalPadding: 7,
				toggleIconSize: 9,
				toggleFontSize: 9,
				showsModeSwitcher: false,
				showsModeLabel: false,
				showsSourceSummary: false,
				showsFooter: false
			)
		default:
			return WidgetMetrics(
				outerPadding: 18,
				sectionSpacing: 14,
				headerTextSpacing: 4,
				gridSectionSpacing: 8,
				gridGap: 3,
				cellCornerRadius: 3.5,
				accentLineWidth: 0.9,
				titleFontSize: 21,
				timeFontSize: 7.5,
				toggleHeight: 30,
				toggleHorizontalPadding: 10,
				toggleIconSize: 10,
				toggleFontSize: 11,
				showsModeSwitcher: true,
				showsModeLabel: true,
				showsSourceSummary: true,
				showsFooter: true
			)
		}
	}
}

private enum WidgetPalette {
	static let iphoneAccent = Color(red: 125.0 / 255.0, green: 211.0 / 255.0, blue: 252.0 / 255.0)
	static let bothAccent = Color(red: 252.0 / 255.0, green: 211.0 / 255.0, blue: 77.0 / 255.0)
}
