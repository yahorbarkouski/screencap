import SwiftUI

struct DayWrappedCardView: View {
	enum SurfaceStyle {
		case app
		case widget
	}

	let snapshot: DayWrappedSnapshot
	var style: SurfaceStyle = .app

	private var timeMarkers: [Int] {
		DayWrappedRendering.timeMarkers(for: snapshot)
	}

	private var categories: [WrappedCategory] {
		DayWrappedRendering.legendCategories(for: snapshot)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 18) {
			HStack(alignment: .top) {
				VStack(alignment: .leading, spacing: 6) {
					Text(snapshot.title)
						.font(.system(size: 14, weight: .medium, design: .rounded))
						.tracking(4)
						.foregroundStyle(.white.opacity(0.68))
					Text(snapshot.subtitle)
						.font(.system(size: style == .widget ? 24 : 28, weight: .semibold, design: .rounded))
						.foregroundStyle(.white)
					Text(snapshot.sourceSummary)
						.font(.system(size: 12, weight: .medium, design: .rounded))
						.foregroundStyle(.white.opacity(0.48))
				}
				Spacer()
				if style == .app {
					RoundedRectangle(cornerRadius: 12)
						.fill(Color.white.opacity(0.04))
						.frame(width: 30, height: 30)
						.overlay(
							Image(systemName: "iphone")
								.font(.system(size: 13, weight: .medium))
								.foregroundStyle(.white.opacity(0.7))
						)
				}
			}

			VStack(alignment: .leading, spacing: 6) {
				VStack(spacing: 4) {
					ForEach(0 ..< 6, id: \.self) { slice in
						HStack(spacing: 4) {
							ForEach(0 ..< 24, id: \.self) { hour in
								let index = hour * 6 + slice
								let slot = snapshot.slots[index]
								RoundedRectangle(cornerRadius: 4)
									.fill(slot.count > 0 ? DayWrappedRendering.slotColor(slot: slot, mode: snapshot.mode) : Color.white.opacity(0.04))
									.overlay(
										RoundedRectangle(cornerRadius: 4)
											.strokeBorder(
												slot.source == .iphone
													? Color(red: 0.49, green: 0.82, blue: 0.97).opacity(0.65)
													: slot.source == .both
														? Color(red: 0.98, green: 0.8, blue: 0.36).opacity(0.75)
														: .clear,
												lineWidth: 1
											)
									)
									.frame(width: style == .widget ? 10 : 12, height: style == .widget ? 10 : 12)
							}
						}
					}
				}

				HStack(spacing: 8) {
					ForEach(0 ..< 24, id: \.self) { hour in
						Text(timeMarkers.contains(hour) ? DayWrappedRendering.hourString(for: hour) : "  ")
							.font(.system(size: 9, weight: .medium, design: .monospaced))
							.foregroundStyle(timeMarkers.contains(hour) ? Color.white.opacity(0.58) : Color.clear)
							.frame(width: style == .widget ? 10 : 12)
					}
				}
			}

			VStack(alignment: .leading, spacing: 10) {
				HStack(spacing: 10) {
					Text("INTENSITY")
						.font(.system(size: 10, weight: .medium, design: .monospaced))
						.tracking(2)
						.foregroundStyle(.white.opacity(0.58))
					HStack(spacing: 6) {
						ForEach(1 ..< DayWrappedRendering.dotAlphaByLevel.count, id: \.self) { level in
							RoundedRectangle(cornerRadius: 4)
								.fill(WrappedCategory.work.color.opacity(DayWrappedRendering.dotAlphaByLevel[level]))
								.frame(width: 14, height: 14)
						}
					}
				}

				HStack(spacing: 12) {
					ForEach(categories, id: \.self) { category in
						HStack(spacing: 6) {
							RoundedRectangle(cornerRadius: 4)
								.fill(category.color.opacity(0.9))
								.frame(width: 14, height: 14)
							Text(category.rawValue)
								.font(.system(size: 13, weight: .medium, design: .rounded))
								.foregroundStyle(.white.opacity(0.72))
						}
					}
				}

				if snapshot.slots.contains(where: { $0.source == .iphone || $0.source == .both }) {
					HStack(spacing: 12) {
						Text("SOURCE")
							.font(.system(size: 10, weight: .medium, design: .monospaced))
							.tracking(2)
							.foregroundStyle(.white.opacity(0.58))
						HStack(spacing: 6) {
							RoundedRectangle(cornerRadius: 4)
								.fill(Color.white.opacity(0.08))
								.overlay(
									RoundedRectangle(cornerRadius: 4)
										.stroke(Color(red: 0.49, green: 0.82, blue: 0.97).opacity(0.65), lineWidth: 1)
								)
								.frame(width: 14, height: 14)
							Text("iPhone")
								.font(.system(size: 13, weight: .medium, design: .rounded))
								.foregroundStyle(.white.opacity(0.72))
						}
					}
				}
			}

			if style == .app {
				HStack(spacing: 14) {
					RoundedRectangle(cornerRadius: 18)
						.fill(Color.white.opacity(0.03))
						.overlay(
							Text("Connected")
								.font(.system(size: 18, weight: .medium, design: .rounded))
								.foregroundStyle(.white.opacity(0.92))
						)
						.frame(height: 62)

					RoundedRectangle(cornerRadius: 18)
						.fill(Color(red: 0.11, green: 0.23, blue: 0.47))
						.overlay(
							Text("Screen Time")
								.font(.system(size: 18, weight: .medium, design: .rounded))
								.foregroundStyle(.white.opacity(0.94))
						)
						.frame(height: 62)
				}
			}
		}
		.padding(style == .widget ? 18 : 22)
		.background(
			RoundedRectangle(cornerRadius: style == .widget ? 24 : 28)
				.fill(
					LinearGradient(
						colors: [
							Color(red: 0.04, green: 0.05, blue: 0.08),
							Color(red: 0.02, green: 0.03, blue: 0.05),
						],
						startPoint: .topLeading,
						endPoint: .bottomTrailing
					)
				)
		)
	}
}
