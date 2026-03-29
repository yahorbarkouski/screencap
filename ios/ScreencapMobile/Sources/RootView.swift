import SwiftUI
import UIKit

struct RootView: View {
	@EnvironmentObject private var model: AppModel
	@Environment(\.scenePhase) private var scenePhase
	@State private var pairingInput = ""
	@State private var scannerPresented = false
	@State private var didRunInitialActivation = false
	@State private var shouldHandleNextActivePhase = false

	private let actionColumns = [
		GridItem(.flexible(minimum: 0, maximum: .infinity), spacing: 12),
		GridItem(.flexible(minimum: 0, maximum: .infinity), spacing: 12),
	]

	var body: some View {
		ZStack {
			backgroundView

			if model.authorizationStatus == .approved {
				ReportRefreshHostView(dayStart: model.selectedDay, refreshToken: model.reportRefreshToken)
					.opacity(0.015)
					.allowsHitTesting(false)
					.accessibilityHidden(true)
			}

			ScrollView(showsIndicators: false) {
				VStack(alignment: .leading, spacing: 18) {
					if model.identity == nil {
						pairingView
					} else if model.authorizationStatus != .approved {
						authorizationView
					} else {
						wrappedView
					}
				}
				.frame(maxWidth: 460, alignment: .leading)
				.padding(.horizontal, 16)
				.padding(.top, 12)
				.padding(.bottom, 28)
			}
		}
		.sheet(isPresented: $scannerPresented) {
			QRCodeScannerView { value in
				pairingInput = value
				scannerPresented = false
				Task {
					await model.pair(using: value)
				}
			}
			.ignoresSafeArea()
		}
		.task {
			guard !didRunInitialActivation else { return }
			didRunInitialActivation = true
			if scenePhase == .active {
				await model.sceneBecameActive(trigger: "initial-task")
			} else {
				shouldHandleNextActivePhase = true
			}
		}
		.onChange(of: scenePhase) { _, nextPhase in
			if nextPhase == .active {
				guard didRunInitialActivation, shouldHandleNextActivePhase else { return }
				shouldHandleNextActivePhase = false
				Task {
					await model.sceneBecameActive(trigger: "scene-phase-active")
				}
			} else {
				shouldHandleNextActivePhase = true
				if nextPhase == .background {
					model.sceneMovedToBackground()
				}
			}
		}
	}

	private var backgroundView: some View {
		ZStack {
			LinearGradient(
				colors: [
					Color(red: 0.03, green: 0.04, blue: 0.07),
					Color(red: 0.01, green: 0.02, blue: 0.04),
				],
				startPoint: .topLeading,
				endPoint: .bottomTrailing
			)
			.ignoresSafeArea()

			Circle()
				.fill(Color(red: 0.12, green: 0.24, blue: 0.52).opacity(0.32))
				.frame(width: 260, height: 260)
				.blur(radius: 70)
				.offset(x: 150, y: -260)

			Circle()
				.fill(Color(red: 0.18, green: 0.48, blue: 0.46).opacity(0.18))
				.frame(width: 220, height: 220)
				.blur(radius: 90)
				.offset(x: -150, y: -80)
		}
	}

	private var pairingView: some View {
		VStack(alignment: .leading, spacing: 18) {
			Text("Connect your iPhone")
				.font(.system(size: 30, weight: .bold, design: .rounded))
				.foregroundStyle(.white)

			Text("Paste the pairing link from the macOS Screencap settings panel, or scan its QR code.")
				.font(.system(size: 15, weight: .medium, design: .rounded))
				.foregroundStyle(.white.opacity(0.72))

			VStack(spacing: 12) {
				TextField("Paste pairing link", text: $pairingInput)
					.textInputAutocapitalization(.never)
					.autocorrectionDisabled()
					.padding(.horizontal, 16)
					.frame(height: 54)
					.background(
						RoundedRectangle(cornerRadius: 18, style: .continuous)
							.fill(Color.white.opacity(0.06))
					)
					.foregroundStyle(.white)

				LazyVGrid(columns: actionColumns, spacing: 12) {
					Button {
						pairingInput = UIPasteboard.general.string ?? pairingInput
					} label: {
						Text("Paste")
							.frame(maxWidth: .infinity)
					}
					.buttonStyle(SecondaryCapsuleStyle())

					Button {
						scannerPresented = true
					} label: {
						Text("Scan QR")
							.frame(maxWidth: .infinity)
					}
					.buttonStyle(SecondaryCapsuleStyle())
				}

				Button {
					Task {
						await model.pair(using: pairingInput)
					}
				} label: {
					Group {
						if model.isPairing {
							ProgressView()
								.progressViewStyle(.circular)
								.tint(.white)
								.frame(maxWidth: .infinity)
						} else {
							Text("Connect iPhone")
								.frame(maxWidth: .infinity)
						}
					}
				}
				.buttonStyle(PrimaryCapsuleStyle())
				.disabled(pairingInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isPairing)
			}

			if let errorMessage = model.errorMessage {
				messageCard(errorMessage, tone: .error)
			}
		}
		.surfacePanel()
	}

	private var authorizationView: some View {
		VStack(alignment: .leading, spacing: 18) {
			Text("Enable Screen Time export")
				.font(.system(size: 30, weight: .bold, design: .rounded))
				.foregroundStyle(.white)

			Text("Your iPhone is paired as @\(model.identity?.username ?? "user"). Authorize Screen Time access so Screencap can export hourly activity to your Mac account and keep the widget in sync.")
				.font(.system(size: 15, weight: .medium, design: .rounded))
				.foregroundStyle(.white.opacity(0.72))

			Button {
				Task {
					await model.requestAuthorization()
				}
			} label: {
				Text("Allow Screen Time")
					.frame(maxWidth: .infinity)
			}
			.buttonStyle(PrimaryCapsuleStyle())

			LazyVGrid(columns: actionColumns, spacing: 12) {
				Button {
					Task {
						await model.syncFromMac()
					}
				} label: {
					Text(model.isSyncingFromMac ? "Syncing..." : "Sync from Mac")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(SecondaryCapsuleStyle())
				.disabled(model.isSyncingFromMac || model.isRepairing)

				Button {
					Task {
						await model.resync()
					}
				} label: {
					Text(model.isRepairing ? "Re-syncing..." : "Re-sync")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(SecondaryCapsuleStyle())
				.disabled(model.isSyncingFromMac || model.isRepairing)

				Button {
					model.copyLogs()
				} label: {
					Text("Copy Logs")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(SecondaryCapsuleStyle())
				.disabled(model.isSyncingFromMac || model.isRepairing)

				Button(role: .destructive) {
					model.forgetDevice()
				} label: {
					Text("Forget Device")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(SecondaryCapsuleStyle())
			}

			if let infoMessage = model.infoMessage {
				messageCard(infoMessage, tone: .info)
			}

			if let errorMessage = model.errorMessage {
				messageCard(errorMessage, tone: .error)
			}
		}
		.surfacePanel()
	}

	private var wrappedView: some View {
		VStack(alignment: .leading, spacing: 14) {
			HStack(alignment: .top, spacing: 12) {
				VStack(alignment: .leading, spacing: 6) {
					Text("Screencap")
						.font(.system(size: 28, weight: .bold, design: .rounded))
						.foregroundStyle(.white)

					Text("Connected as @\(model.identity?.username ?? "user")")
						.font(.system(size: 14, weight: .medium, design: .rounded))
						.foregroundStyle(.white.opacity(0.62))
				}

				Spacer(minLength: 12)

				Menu {
					Button {
						Task {
							await model.resync()
						}
					} label: {
						Label("Re-sync", systemImage: "arrow.clockwise.circle")
					}

					Button {
						model.copyLogs()
					} label: {
						Label("Copy Logs", systemImage: "doc.on.doc")
					}

					Divider()

					Button(role: .destructive) {
						model.forgetDevice()
					} label: {
						Label("Forget Device", systemImage: "link.badge.minus")
					}
				} label: {
					headerMenuLabel
				}
				.disabled(model.isRefreshing || model.isSyncingFromMac || model.isRepairing)
			}

			if let snapshot = selectedSnapshot {
				DayWrappedCardView(
					snapshot: snapshot,
					style: .app,
					onPreviousDay: { model.previousDay() },
					onNextDay: { model.nextDay() },
					canMoveToNextDay: !Calendar.current.isDateInToday(model.selectedDay)
				)
			} else {
				emptyStateCard
			}

			HStack(spacing: 12) {
				Button {
					Task {
						await model.refreshSelectedDay()
					}
				} label: {
					Text(model.isRefreshing ? "Refreshing..." : "Refresh iPhone")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(PrimaryCapsuleStyle())
				.disabled(model.isRefreshing || model.isSyncingFromMac || model.isRepairing)

				Button {
					Task {
						await model.syncFromMac()
					}
				} label: {
					Text(model.isSyncingFromMac ? "Syncing..." : "Sync from Mac")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(PrimaryCapsuleStyle())
				.disabled(model.isRefreshing || model.isSyncingFromMac || model.isRepairing)
			}

			if let infoMessage = model.infoMessage {
				messageCard(infoMessage, tone: .info)
			}

			if let uploadStatus = model.uploadStatus {
				Text(uploadStatus)
					.font(.system(size: 12, weight: .medium, design: .rounded))
					.foregroundStyle(.white.opacity(0.46))
					.padding(.horizontal, 4)
			}

			if let errorMessage = model.errorMessage {
				messageCard(errorMessage, tone: .error)
			}
		}
	}

	private var emptyStateCard: some View {
		VStack(alignment: .leading, spacing: 16) {
			HStack(alignment: .top, spacing: 12) {
				VStack(alignment: .leading, spacing: 4) {
					Text("DAY WRAPPED")
						.font(.system(size: 10, weight: .medium, design: .monospaced))
						.kerning(3)
						.foregroundStyle(.white.opacity(0.6))
						.lineLimit(1)

					Text(selectedDayTitle)
						.font(.system(size: 23, weight: .semibold, design: .rounded))
						.foregroundStyle(.white)
						.lineLimit(1)
						.minimumScaleFactor(0.76)
				}

				Spacer(minLength: 8)

				HStack(spacing: 8) {
					Button {
						model.previousDay()
					} label: {
						Image(systemName: "chevron.left")
					}
					.buttonStyle(CardNavigationButtonStyle())

					Button {
						model.nextDay()
					} label: {
						Image(systemName: "chevron.right")
					}
					.buttonStyle(CardNavigationButtonStyle())
					.disabled(Calendar.current.isDateInToday(model.selectedDay))
				}
			}

			VStack(spacing: 12) {
				if model.isRefreshing {
					ProgressView()
						.progressViewStyle(.circular)
						.tint(.white)
				}

				Text(model.isRefreshing ? "Refreshing Screen Time export..." : "No Day Wrapped snapshot yet for this day")
					.font(.system(size: 17, weight: .semibold, design: .rounded))
					.foregroundStyle(.white)
					.multilineTextAlignment(.center)

				Text("Use Refresh iPhone or Sync from Mac to pull a fresh snapshot into the widget and app.")
					.font(.system(size: 14, weight: .medium, design: .rounded))
					.foregroundStyle(.white.opacity(0.64))
					.multilineTextAlignment(.center)
			}
			.frame(maxWidth: .infinity)
			.frame(minHeight: 180)
		}
		.surfacePanel(padding: 16, cornerRadius: 28)
	}

	private var selectedSnapshot: DayWrappedSnapshot? {
		guard let snapshot = model.snapshot else {
			return nil
		}
		let selectedDayStartMs = Int64(Calendar.current.startOfDay(for: model.selectedDay).timeIntervalSince1970 * 1000)
		return snapshot.dayStartMs == selectedDayStartMs ? snapshot : nil
	}

	private var selectedDayTitle: String {
		model.selectedDay.formatted(date: .abbreviated, time: .omitted)
	}

	private func messageCard(_ message: String, tone: MessageTone) -> some View {
		Text(message)
			.font(.system(size: 13, weight: .medium, design: .rounded))
			.foregroundStyle(tone.foreground)
			.frame(maxWidth: .infinity, alignment: .leading)
			.surfacePanel(
				padding: 14,
				cornerRadius: 20,
				fill: tone.fill,
				stroke: tone.stroke
			)
	}

	private var headerMenuLabel: some View {
		Image(systemName: "ellipsis")
			.font(.system(size: 18, weight: .semibold))
			.frame(width: 42, height: 42)
			.background(
				RoundedRectangle(cornerRadius: 15, style: .continuous)
					.fill(Color.white.opacity(0.055))
					.overlay(
						RoundedRectangle(cornerRadius: 15, style: .continuous)
							.stroke(Color.white.opacity(0.06), lineWidth: 1)
					)
			)
			.foregroundStyle(.white)
	}
}

private struct PrimaryCapsuleStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: 16, weight: .semibold, design: .rounded))
			.lineLimit(1)
			.minimumScaleFactor(0.78)
			.padding(.horizontal, 16)
			.frame(height: 50)
			.background(
				RoundedRectangle(cornerRadius: 18, style: .continuous)
					.fill(Color(red: 0.11, green: 0.23, blue: 0.47))
					.shadow(color: Color(red: 0.02, green: 0.05, blue: 0.16).opacity(0.35), radius: 12, x: 0, y: 8)
			)
			.foregroundStyle(.white)
			.scaleEffect(configuration.isPressed ? 0.96 : 1)
	}
}

private struct SecondaryCapsuleStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: 15, weight: .semibold, design: .rounded))
			.lineLimit(1)
			.minimumScaleFactor(0.78)
			.padding(.horizontal, 16)
			.frame(height: 48)
			.background(
				RoundedRectangle(cornerRadius: 17, style: .continuous)
					.fill(Color.white.opacity(0.055))
					.overlay(
						RoundedRectangle(cornerRadius: 17, style: .continuous)
							.stroke(Color.white.opacity(0.06), lineWidth: 1)
					)
			)
			.foregroundStyle(.white)
			.scaleEffect(configuration.isPressed ? 0.96 : 1)
	}
}

private struct CardNavigationButtonStyle: ButtonStyle {
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

private struct SurfacePanelModifier: ViewModifier {
	let padding: CGFloat
	let cornerRadius: CGFloat
	let fill: Color
	let stroke: Color

	func body(content: Content) -> some View {
		content
			.padding(padding)
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(
				RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
					.fill(fill)
					.overlay(
						RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
							.stroke(stroke, lineWidth: 1)
					)
					.shadow(color: .black.opacity(0.14), radius: 14, x: 0, y: 10)
			)
	}
}

private extension View {
	func surfacePanel(
		padding: CGFloat = 18,
		cornerRadius: CGFloat = 28,
		fill: Color = Color.white.opacity(0.04),
		stroke: Color = Color.white.opacity(0.06)
	) -> some View {
		modifier(
			SurfacePanelModifier(
				padding: padding,
				cornerRadius: cornerRadius,
				fill: fill,
				stroke: stroke
			)
		)
	}
}

private enum MessageTone {
	case info
	case subtle
	case error

	var foreground: Color {
		switch self {
		case .info:
			return .white.opacity(0.78)
		case .subtle:
			return .white.opacity(0.62)
		case .error:
			return Color(red: 1, green: 0.45, blue: 0.45)
		}
	}

	var fill: Color {
		switch self {
		case .info:
			return Color.white.opacity(0.045)
		case .subtle:
			return Color.white.opacity(0.035)
		case .error:
			return Color(red: 0.36, green: 0.07, blue: 0.11).opacity(0.32)
		}
	}

	var stroke: Color {
		switch self {
		case .info, .subtle:
			return Color.white.opacity(0.06)
		case .error:
			return Color(red: 1, green: 0.45, blue: 0.45).opacity(0.22)
		}
	}
}
