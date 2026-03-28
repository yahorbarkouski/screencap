import SwiftUI

struct RootView: View {
	@EnvironmentObject private var model: AppModel
	@Environment(\.scenePhase) private var scenePhase
	@State private var pairingInput = ""
	@State private var scannerPresented = false

	var body: some View {
		ZStack {
			LinearGradient(
				colors: [
					Color(red: 0.03, green: 0.04, blue: 0.06),
					Color(red: 0.01, green: 0.02, blue: 0.04),
				],
				startPoint: .topLeading,
				endPoint: .bottomTrailing
			)
			.ignoresSafeArea()

			ScrollView(showsIndicators: false) {
				VStack(alignment: .leading, spacing: 22) {
					if model.identity == nil {
						pairingView
					} else if model.authorizationStatus != .approved {
						authorizationView
					} else {
						wrappedView
					}
				}
				.padding(20)
			}

			if model.authorizationStatus == .approved {
				ReportRefreshHostView(dayStart: model.selectedDay, refreshToken: model.reportRefreshToken)
					.frame(width: 1, height: 1)
					.opacity(0.01)
					.allowsHitTesting(false)
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
			await model.sceneBecameActive()
		}
		.onChange(of: scenePhase) { _, nextPhase in
			if nextPhase == .active {
				Task {
					await model.sceneBecameActive()
				}
			} else if nextPhase == .background {
				model.sceneMovedToBackground()
			}
		}
	}

	private var pairingView: some View {
		VStack(alignment: .leading, spacing: 18) {
			Text("Connect to your Mac")
				.font(.system(size: 34, weight: .bold, design: .rounded))
				.foregroundStyle(.white)

			Text("Paste the pairing link copied from the macOS Screencap settings panel, or scan its QR code.")
				.font(.system(size: 16, weight: .medium, design: .rounded))
				.foregroundStyle(.white.opacity(0.7))

			VStack(spacing: 12) {
				TextField("Paste pairing link", text: $pairingInput)
					.textInputAutocapitalization(.never)
					.autocorrectionDisabled()
					.padding(16)
					.background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
					.foregroundStyle(.white)

				HStack(spacing: 12) {
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
				Text(errorMessage)
					.font(.system(size: 14, weight: .medium, design: .rounded))
					.foregroundStyle(Color(red: 1, green: 0.45, blue: 0.45))
			}
		}
	}

	private var authorizationView: some View {
		VStack(alignment: .leading, spacing: 18) {
			Text("Enable Screen Time export")
				.font(.system(size: 34, weight: .bold, design: .rounded))
				.foregroundStyle(.white)

			Text("Your iPhone is paired as @\(model.identity?.username ?? "user"). Authorize Screen Time access so Screencap can export hourly activity to your Mac account and keep the widget up to date.")
				.font(.system(size: 16, weight: .medium, design: .rounded))
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

			Button(role: .destructive) {
				model.forgetDevice()
			} label: {
				Text("Forget paired device")
			}
			.buttonStyle(SecondaryCapsuleStyle())

			if let errorMessage = model.errorMessage {
				Text(errorMessage)
					.font(.system(size: 14, weight: .medium, design: .rounded))
					.foregroundStyle(Color(red: 1, green: 0.45, blue: 0.45))
			}
		}
	}

	private var wrappedView: some View {
		VStack(alignment: .leading, spacing: 18) {
			HStack {
				VStack(alignment: .leading, spacing: 4) {
					Text("Screencap iPhone")
						.font(.system(size: 32, weight: .bold, design: .rounded))
						.foregroundStyle(.white)
					Text("Connected as @\(model.identity?.username ?? "user")")
						.font(.system(size: 15, weight: .medium, design: .rounded))
						.foregroundStyle(.white.opacity(0.62))
				}
				Spacer()
				Button("Forget") {
					model.forgetDevice()
				}
				.buttonStyle(SecondaryCapsuleStyle())
			}

			HStack(spacing: 12) {
				Button {
					model.previousDay()
				} label: {
					Image(systemName: "chevron.left")
				}
				.buttonStyle(SecondaryIconButtonStyle())

				Text(model.selectedDay.formatted(date: .abbreviated, time: .omitted))
					.font(.system(size: 16, weight: .semibold, design: .rounded))
					.foregroundStyle(.white)
					.frame(maxWidth: .infinity)

				Button {
					model.nextDay()
				} label: {
					Image(systemName: "chevron.right")
				}
				.buttonStyle(SecondaryIconButtonStyle())
				.disabled(Calendar.current.isDateInToday(model.selectedDay))
			}

			if let snapshot = model.snapshot, snapshot.dayStartMs == Int64(Calendar.current.startOfDay(for: model.selectedDay).timeIntervalSince1970 * 1000) {
				DayWrappedCardView(snapshot: snapshot, style: .app)
			} else {
				RoundedRectangle(cornerRadius: 28)
					.fill(Color.white.opacity(0.04))
					.frame(height: 420)
					.overlay(
						VStack(spacing: 14) {
							if model.isRefreshing {
								ProgressView()
									.progressViewStyle(.circular)
									.tint(.white)
							}
							Text(model.isRefreshing ? "Refreshing Screen Time export..." : "No snapshot yet for this day")
								.font(.system(size: 16, weight: .medium, design: .rounded))
								.foregroundStyle(.white.opacity(0.72))
						}
					)
			}

			HStack(spacing: 12) {
				Button {
					Task {
						await model.refreshSelectedDay()
					}
				} label: {
					Text(model.isRefreshing ? "Refreshing..." : "Refresh iPhone Data")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(PrimaryCapsuleStyle())
				.disabled(model.isRefreshing)

				Button {
					Task {
						await model.syncFromMac()
					}
				} label: {
					Text(model.isSyncingFromMac ? "Syncing..." : "Sync from Mac")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(PrimaryCapsuleStyle())
				.disabled(model.isRefreshing || model.isSyncingFromMac)
			}

			Button {
				model.copyLogs()
			} label: {
				Text("Copy Logs")
					.frame(maxWidth: .infinity)
			}
			.buttonStyle(SecondaryCapsuleStyle())

			if let infoMessage = model.infoMessage {
				Text(infoMessage)
					.font(.system(size: 13, weight: .medium, design: .rounded))
					.foregroundStyle(.white.opacity(0.72))
			}

			if let uploadStatus = model.uploadStatus {
				Text(uploadStatus)
					.font(.system(size: 13, weight: .medium, design: .rounded))
					.foregroundStyle(.white.opacity(0.56))
			}

			if let errorMessage = model.errorMessage {
				Text(errorMessage)
					.font(.system(size: 14, weight: .medium, design: .rounded))
					.foregroundStyle(Color(red: 1, green: 0.45, blue: 0.45))
			}
		}
	}
}

private struct PrimaryCapsuleStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: 17, weight: .semibold, design: .rounded))
			.padding(.horizontal, 18)
			.frame(height: 56)
			.background(
				RoundedRectangle(cornerRadius: 18)
					.fill(Color(red: 0.11, green: 0.23, blue: 0.47).opacity(configuration.isPressed ? 0.82 : 1))
			)
			.foregroundStyle(.white)
	}
}

private struct SecondaryCapsuleStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: 16, weight: .semibold, design: .rounded))
			.padding(.horizontal, 18)
			.frame(height: 50)
			.background(
				RoundedRectangle(cornerRadius: 16)
					.fill(Color.white.opacity(configuration.isPressed ? 0.08 : 0.05))
			)
			.foregroundStyle(.white)
	}
}

private struct SecondaryIconButtonStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: 16, weight: .semibold))
			.frame(width: 44, height: 44)
			.background(
				RoundedRectangle(cornerRadius: 14)
					.fill(Color.white.opacity(configuration.isPressed ? 0.08 : 0.05))
			)
			.foregroundStyle(.white)
	}
}
