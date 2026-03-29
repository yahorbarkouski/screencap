import SwiftUI

struct DayWrappedCardView: View {
	enum SurfaceStyle {
		case app
		case widget
	}

	let snapshot: DayWrappedSnapshot
	var style: SurfaceStyle = .app
	var onPreviousDay: (() -> Void)? = nil
	var onNextDay: (() -> Void)? = nil
	var canMoveToNextDay = true

	private var metrics: CardMetrics {
		CardMetrics.resolve(for: style)
	}

	private var orderedSlots: [WrappedSlot] {
		var result: [WrappedSlot] = []
		result.reserveCapacity(snapshot.slots.count)
		for slice in 0 ..< DayWrappedRendering.slicesPerHour {
			for hour in 0 ..< 24 {
				let index = hour * DayWrappedRendering.slicesPerHour + slice
				result.append(snapshot.slots[index])
			}
		}
		return result
	}

	private var timeMarkers: [Int] {
		DayWrappedRendering.timeMarkers(for: snapshot)
	}

	private var categories: [WrappedCategory] {
		DayWrappedRendering.legendCategories(
			for: snapshot,
			limit: style == .widget ? 4 : 5
		)
	}

	private var hasIphoneSourceAccent: Bool {
		snapshot.slots.contains { $0.source == .iphone || $0.source == .both }
	}

	private var gridColumns: [GridItem] {
		Array(
			repeating: GridItem(.flexible(minimum: 0, maximum: .infinity), spacing: metrics.gridGap),
			count: 24
		)
	}

	private var legendColumns: [GridItem] {
		[
			GridItem(.adaptive(minimum: style == .app ? 88 : 76), spacing: 10),
		]
	}

	var body: some View {
		VStack(alignment: .leading, spacing: metrics.sectionSpacing) {
			header
			grid
			if style == .app {
				appFooter
			} else {
				widgetFooter
			}
		}
		.padding(metrics.outerPadding)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(cardSurface)
	}

	private var header: some View {
		HStack(alignment: .top, spacing: 12) {
			VStack(alignment: .leading, spacing: style == .app ? 4 : 6) {
				Text(snapshot.title)
					.font(.system(size: metrics.kickerFontSize, weight: .medium, design: .monospaced))
					.kerning(metrics.kickerKerning)
					.foregroundStyle(.white.opacity(0.6))
					.lineLimit(1)

				Text(snapshot.subtitle)
					.font(.system(size: metrics.titleFontSize, weight: .semibold, design: .rounded))
					.foregroundStyle(.white)
					.lineLimit(1)
					.minimumScaleFactor(0.76)

				if style == .widget {
					Text(snapshot.sourceSummary)
						.font(.system(size: 12, weight: .medium, design: .rounded))
						.foregroundStyle(.white.opacity(0.5))
						.lineLimit(1)
				}
			}

			Spacer(minLength: 8)

			if style == .app {
				appHeaderControls
			} else {
				CompactBadge(
					text: snapshot.sourceSummary,
					icon: hasIphoneSourceAccent ? "iphone.gen3" : "desktopcomputer",
					tint: hasIphoneSourceAccent
						? Color(red: 0.49, green: 0.82, blue: 0.97)
						: Color.white.opacity(0.82)
				)
			}
		}
	}

	@ViewBuilder
	private var appHeaderControls: some View {
		HStack(spacing: 8) {
			if let onPreviousDay {
				Button(action: onPreviousDay) {
					Image(systemName: "chevron.left")
				}
				.buttonStyle(CardNavButtonStyle())
			}

			if let onNextDay {
				Button(action: onNextDay) {
					Image(systemName: "chevron.right")
				}
				.buttonStyle(CardNavButtonStyle())
				.disabled(!canMoveToNextDay)
			}
		}
	}

	private var grid: some View {
		VStack(alignment: .leading, spacing: metrics.gridSectionSpacing) {
			LazyVGrid(columns: gridColumns, spacing: metrics.gridGap) {
				ForEach(Array(orderedSlots.enumerated()), id: \.offset) { _, slot in
					RoundedRectangle(
						cornerRadius: metrics.cellCornerRadius,
						style: .continuous
					)
					.fill(slotFill(for: slot))
					.overlay {
						if let accent = sourceAccentColor(for: slot.source) {
							RoundedRectangle(
								cornerRadius: metrics.cellCornerRadius,
								style: .continuous
							)
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
						.foregroundStyle(timeMarkers.contains(hour) ? .white.opacity(0.42) : .clear)
						.lineLimit(1)
						.minimumScaleFactor(0.8)
						.frame(maxWidth: .infinity)
				}
			}
		}
	}

	private var appFooter: some View {
		VStack(alignment: .leading, spacing: 10) {
			HStack(spacing: 10) {
				Text("INTENSITY")
					.font(.system(size: 10, weight: .medium, design: .monospaced))
					.kerning(1.8)
					.foregroundStyle(.white.opacity(0.48))

				HStack(spacing: 5) {
					ForEach(1 ..< DayWrappedRendering.dotAlphaByLevel.count, id: \.self) { level in
						RoundedRectangle(cornerRadius: 3, style: .continuous)
							.fill(WrappedCategory.work.color.opacity(DayWrappedRendering.dotAlphaByLevel[level]))
							.frame(width: 10, height: 10)
					}
				}
			}

			LazyVGrid(columns: legendColumns, alignment: .leading, spacing: 6) {
				ForEach(categories, id: \.self) { category in
					LegendKey(
						text: category.rawValue,
						fill: category.color.opacity(0.92)
					)
				}

				if hasIphoneSourceAccent {
					LegendKey(
						text: "iPhone",
						fill: Color.white.opacity(0.05),
						stroke: Color(red: 0.49, green: 0.82, blue: 0.97).opacity(0.72)
					)
				}
			}
		}
	}

	private var widgetFooter: some View {
		ViewThatFits(in: .horizontal) {
			HStack(spacing: 8) {
				if let pairedDeviceName = snapshot.pairedDeviceName, !pairedDeviceName.isEmpty {
					CompactBadge(
						text: pairedDeviceName,
						icon: "iphone.gen3",
						tint: Color(red: 0.49, green: 0.82, blue: 0.97)
					)
				}

				if hasIphoneSourceAccent {
					CompactBadge(
						text: "Synced",
						icon: "arrow.triangle.2.circlepath",
						tint: Color(red: 0.98, green: 0.8, blue: 0.36)
					)
				}
			}

			VStack(alignment: .leading, spacing: 6) {
				if let pairedDeviceName = snapshot.pairedDeviceName, !pairedDeviceName.isEmpty {
					CompactBadge(
						text: pairedDeviceName,
						icon: "iphone.gen3",
						tint: Color(red: 0.49, green: 0.82, blue: 0.97)
					)
				}

				if hasIphoneSourceAccent {
					CompactBadge(
						text: "Synced",
						icon: "arrow.triangle.2.circlepath",
						tint: Color(red: 0.98, green: 0.8, blue: 0.36)
					)
				}
			}
		}
	}

	private func slotFill(for slot: WrappedSlot) -> Color {
		slot.count > 0
			? DayWrappedRendering.slotColor(slot: slot, mode: snapshot.mode)
			: Color.white.opacity(style == .widget ? 0.055 : 0.05)
	}

	private func sourceAccentColor(for source: WrappedSourceAccent) -> Color? {
		switch source {
		case .iphone:
			return Color(red: 0.49, green: 0.82, blue: 0.97).opacity(0.72)
		case .both:
			return Color(red: 0.98, green: 0.8, blue: 0.36).opacity(0.8)
		case .none, .mac:
			return nil
		}
	}

	private var cardSurface: some View {
		RoundedRectangle(cornerRadius: metrics.cornerRadius, style: .continuous)
			.fill(
				LinearGradient(
					colors: [
						Color(red: 0.05, green: 0.06, blue: 0.1),
						Color(red: 0.02, green: 0.03, blue: 0.05),
					],
					startPoint: .topLeading,
					endPoint: .bottomTrailing
				)
			)
			.overlay(
				RoundedRectangle(cornerRadius: metrics.cornerRadius, style: .continuous)
					.stroke(Color.white.opacity(0.06), lineWidth: 1)
			)
			.shadow(color: .black.opacity(0.18), radius: 16, x: 0, y: 10)
	}
}

private struct LegendKey: View {
	let text: String
	let fill: Color
	var stroke: Color? = nil

	var body: some View {
		HStack(spacing: 7) {
			RoundedRectangle(cornerRadius: 3, style: .continuous)
				.fill(fill)
				.overlay {
					if let stroke {
						RoundedRectangle(cornerRadius: 3, style: .continuous)
							.stroke(stroke, lineWidth: 1)
					}
				}
				.frame(width: 10, height: 10)

			Text(text)
				.font(.system(size: 12, weight: .medium, design: .rounded))
				.foregroundStyle(.white.opacity(0.68))
				.lineLimit(1)
				.minimumScaleFactor(0.82)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

private struct CompactBadge: View {
	let text: String
	let icon: String
	let tint: Color

	var body: some View {
		HStack(spacing: 6) {
			Image(systemName: icon)
				.font(.system(size: 10, weight: .semibold))
			Text(text)
				.font(.system(size: 11, weight: .semibold, design: .rounded))
				.lineLimit(1)
				.minimumScaleFactor(0.75)
		}
		.foregroundStyle(tint)
		.padding(.horizontal, 10)
		.frame(height: 30)
		.background(
			Capsule(style: .continuous)
				.fill(Color.white.opacity(0.07))
		)
	}
}

private struct CardNavButtonStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: 13, weight: .semibold))
			.frame(width: 32, height: 32)
			.background(
				RoundedRectangle(cornerRadius: 12, style: .continuous)
					.fill(Color.white.opacity(0.06))
					.overlay(
						RoundedRectangle(cornerRadius: 12, style: .continuous)
							.stroke(Color.white.opacity(0.06), lineWidth: 1)
					)
			)
			.foregroundStyle(.white.opacity(0.88))
			.scaleEffect(configuration.isPressed ? 0.96 : 1)
	}
}

private struct CardMetrics {
	let outerPadding: CGFloat
	let sectionSpacing: CGFloat
	let gridSectionSpacing: CGFloat
	let gridGap: CGFloat
	let cellCornerRadius: CGFloat
	let accentLineWidth: CGFloat
	let cornerRadius: CGFloat
	let kickerFontSize: CGFloat
	let kickerKerning: CGFloat
	let titleFontSize: CGFloat
	let timeFontSize: CGFloat

	static func resolve(for style: DayWrappedCardView.SurfaceStyle) -> CardMetrics {
		switch style {
		case .app:
			return CardMetrics(
				outerPadding: 16,
				sectionSpacing: 14,
				gridSectionSpacing: 9,
				gridGap: 3,
				cellCornerRadius: 4,
				accentLineWidth: 0.95,
				cornerRadius: 28,
				kickerFontSize: 10,
				kickerKerning: 3,
				titleFontSize: 23,
				timeFontSize: 8
			)
		case .widget:
			return CardMetrics(
				outerPadding: 16,
				sectionSpacing: 14,
				gridSectionSpacing: 8,
				gridGap: 3,
				cellCornerRadius: 3.5,
				accentLineWidth: 0.9,
				cornerRadius: 24,
				kickerFontSize: 10,
				kickerKerning: 3,
				titleFontSize: 22,
				timeFontSize: 8
			)
		}
	}
}
