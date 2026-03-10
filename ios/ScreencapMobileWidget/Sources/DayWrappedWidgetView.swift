import AppIntents
import SwiftUI
import WidgetKit

struct DayWrappedWidgetView: View {
	let snapshot: DayWrappedSnapshot?
	let mode: WrappedMode

	private let horizontalPadding: CGFloat = 16
	private let verticalPadding: CGFloat = 14

	var body: some View {
		GeometryReader { geometry in
			let metrics = WidgetLayoutMetrics.resolve(for: geometry.size)

			VStack(alignment: .leading, spacing: 0) {
				header(metrics: metrics)
				Spacer(minLength: metrics.headerSpacing)
				grid(snapshot: snapshot ?? emptySnapshot, metrics: metrics)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
			.padding(.horizontal, horizontalPadding)
			.padding(.vertical, verticalPadding)
		}
	}

	private func header(metrics: WidgetLayoutMetrics) -> some View {
		HStack(alignment: .center, spacing: 12) {
			Text("DAY WRAPPED")
				.font(.system(size: metrics.titleFontSize, weight: .medium, design: .monospaced))
				.kerning(metrics.titleKerning)
				.foregroundStyle(.white.opacity(0.6))
				.lineLimit(1)

			Spacer(minLength: 0)

			Button(intent: CycleWidgetModeIntent()) {
				HStack(spacing: 6) {
					Image(systemName: mode == .categories ? "square.grid.3x3.fill" : "macwindow")
						.font(.system(size: metrics.toggleIconSize, weight: .medium))
					Text(modeLabel)
						.font(.system(size: metrics.toggleLabelSize, weight: .semibold, design: .rounded))
						.lineLimit(1)
				}
				.foregroundStyle(.white.opacity(0.82))
				.padding(.horizontal, metrics.toggleHorizontalPadding)
				.frame(height: metrics.toggleHeight)
				.background(
					RoundedRectangle(cornerRadius: metrics.toggleCornerRadius, style: .continuous)
						.fill(Color.white.opacity(0.07))
				)
			}
			.buttonStyle(.plain)
		}
	}

	private func grid(snapshot: DayWrappedSnapshot, metrics: WidgetLayoutMetrics) -> some View {
		VStack(alignment: .leading, spacing: metrics.gridGap) {
			ForEach(0 ..< DayWrappedRendering.slicesPerHour, id: \.self) { slice in
				HStack(spacing: metrics.gridGap) {
					ForEach(0 ..< 24, id: \.self) { hour in
						let index = hour * DayWrappedRendering.slicesPerHour + slice
						let slot = snapshot.slots[index]
						RoundedRectangle(cornerRadius: metrics.cellCornerRadius, style: .continuous)
							.fill(backgroundColor(for: slot))
							.overlay {
								if let accent = sourceAccentColor(for: slot.source) {
									RoundedRectangle(cornerRadius: metrics.cellCornerRadius, style: .continuous)
										.stroke(accent, lineWidth: metrics.accentLineWidth)
								}
							}
							.frame(width: metrics.cellSize, height: metrics.cellSize)
					}
				}
			}
		}
	}

	private func backgroundColor(for slot: WrappedSlot) -> Color {
		slot.count > 0
			? DayWrappedRendering.slotColor(slot: slot, mode: mode)
			: Color.white.opacity(0.045)
	}

	private func sourceAccentColor(for source: WrappedSourceAccent) -> Color? {
		switch source {
		case .iphone:
			return WidgetPalette.iphoneAccent.opacity(0.74)
		case .both:
			return WidgetPalette.bothAccent.opacity(0.82)
		case .none, .mac:
			return nil
		}
	}

	private var modeLabel: String {
		switch mode {
		case .categories:
			return "Categories"
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
			subtitle: "",
			updatedAtMs: dayStartMs,
			sourceSummary: "No activity",
			pairedDeviceName: nil,
			mode: .categories,
			slots: slots
		)
	}
}

private struct WidgetLayoutMetrics {
	let cellSize: CGFloat
	let gridGap: CGFloat
	let cellCornerRadius: CGFloat
	let accentLineWidth: CGFloat
	let titleFontSize: CGFloat
	let titleKerning: CGFloat
	let headerSpacing: CGFloat
	let toggleHeight: CGFloat
	let toggleIconSize: CGFloat
	let toggleLabelSize: CGFloat
	let toggleHorizontalPadding: CGFloat
	let toggleCornerRadius: CGFloat

	static func resolve(for size: CGSize) -> WidgetLayoutMetrics {
		let gridGap: CGFloat = size.width >= 340 ? 3 : 2
		let availableGridHeight = max(48, size.height - 56)
		let widthConstrained = floor((size.width - 32 - (23 * gridGap)) / 24)
		let heightConstrained = floor((availableGridHeight - (5 * gridGap)) / 6)
		let cellSize = min(10, max(8, min(widthConstrained, heightConstrained)))
		let compact = cellSize <= 8

		return WidgetLayoutMetrics(
			cellSize: cellSize,
			gridGap: gridGap,
			cellCornerRadius: max(2.4, floor(cellSize * 0.26)),
			accentLineWidth: compact ? 0.85 : 0.95,
			titleFontSize: compact ? 10 : 11,
			titleKerning: compact ? 2.8 : 3.2,
			headerSpacing: compact ? 10 : 12,
			toggleHeight: compact ? 24 : 26,
			toggleIconSize: compact ? 10 : 11,
			toggleLabelSize: compact ? 10 : 11,
			toggleHorizontalPadding: compact ? 9 : 10,
			toggleCornerRadius: compact ? 9 : 10
		)
	}
}

private enum WidgetPalette {
	static let iphoneAccent = Color(red: 125.0 / 255.0, green: 211.0 / 255.0, blue: 252.0 / 255.0)
	static let bothAccent = Color(red: 252.0 / 255.0, green: 211.0 / 255.0, blue: 77.0 / 255.0)
}
