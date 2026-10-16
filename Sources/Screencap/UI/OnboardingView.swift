import AppKit
import ApplicationServices
import ScreencapCore
import SwiftUI

/// The first launch, one step a screen: what Screencap is, the two permissions it needs (each step turns to done by
/// itself once the permission is granted), the key for the models, and where the app lives afterwards.
struct OnboardingView: View {
  enum Step: Int, CaseIterable {
    case welcome, screen, accessibility, key, done
  }

  @State var step: Step
  /// Saves the key and starts understanding with it.
  var saveKey: (String) -> Void
  var finish: () -> Void
  @State private var screenAllowed = CGPreflightScreenCaptureAccess()
  @State private var accessibilityAllowed = AXIsProcessTrusted()
  @State private var askedForScreen = false
  @State private var key = ""
  @State private var hasKey = OpenRouter.storedKey() != nil
  @State private var textOnly = SettingsStore().current.textOnlyMode

  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: 0)
      content.frame(maxWidth: 380).id(step).transition(.opacity)
      Spacer(minLength: 0)
      HStack(spacing: 6) {
        ForEach(Step.allCases, id: \.self) { item in
          Capsule().fill(item == step ? Theme.ink : Theme.ink6.opacity(0.4)).frame(width: item == step ? 16 : 6, height: 6)
        }
      }
      .animation(.snappy(duration: 0.25), value: step)
      .padding(.bottom, 28)
    }
    .frame(width: 560, height: 520)
    .background(Theme.page)
    .task {
      // Permissions granted in System Settings show up here within a second.
      while !Task.isCancelled {
        screenAllowed = CGPreflightScreenCaptureAccess()
        accessibilityAllowed = AXIsProcessTrusted()
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }

  @ViewBuilder var content: some View {
    switch step {
    case .welcome:
      page(
        icon: Image(nsImage: NSApp.applicationIconImage), title: "Screencap remembers your day",
        body: "It captures the screen when something holds still, reads it on this Mac, and turns your day into the threads of your work and play.") {
          Button("Get started") { go(.screen) }.buttonStyle(PillStyle(prominent: true, height: 34))
        }
    case .screen:
      page(
        icon: symbol("rectangle.dashed.badge.record"), title: "Allow screen recording",
        body: "Screenshots and screen text are kept on this Mac. Password managers and their web vaults are never captured.") {
          if screenAllowed {
            done("Allowed") { go(.accessibility) }
          } else {
            Button("Allow") {
              askedForScreen = true
              CGRequestScreenCaptureAccess()
            }
            .buttonStyle(PillStyle(prominent: true, height: 34))
            if askedForScreen {
              Button("Allowed already? Reopen Screencap") { Self.relaunch() }.buttonStyle(PillStyle())
            }
          }
        }
    case .accessibility:
      page(
        icon: symbol("macwindow"), title: "Read window titles and pages",
        body: "With Accessibility, Screencap knows which document, chat or page was in front, without asking any app.") {
          if accessibilityAllowed {
            done("Allowed") { go(.key) }
          } else {
            Button("Allow") { AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary) }
              .buttonStyle(PillStyle(prominent: true, height: 34))
            Button("Not now") { go(.key) }.buttonStyle(PillStyle())
          }
        }
    case .key:
      page(
        icon: symbol("sparkles"), title: "Connect the models",
        body: "Screencap uses your OpenRouter key to sort your day into activities and threads with AI models, for about $2 a month at eight hours a day. Every request uses zero data retention: neither OpenRouter nor the models keep it or train on it.") {
          if hasKey {
            done("Key saved") { go(.done) }
          } else {
            HStack(spacing: 8) {
              SecureField("sk-or-…", text: $key)
                .textFieldStyle(.plain).font(.mono(13))
                .padding(.horizontal, 14).frame(width: 260, height: 34)
                .background(Capsule().fill(Theme.wash))
                .onSubmit(save)
              Button("Save", action: save).buttonStyle(PillStyle(prominent: true, height: 34)).disabled(!key.hasPrefix("sk-or-"))
            }
            Toggle("Send no screenshots, only text", isOn: $textOnly)
              .toggleStyle(.checkbox).font(.ui(13)).foregroundStyle(Theme.ink3)
              .onChange(of: textOnly) { _, value in SettingsStore().update { $0.textOnlyMode = value } }
            HStack(spacing: 6) {
              Button("Get a key") { NSWorkspace.shared.open(URL(string: "https://openrouter.ai/keys")!) }.buttonStyle(PillStyle())
              Button("Later") { go(.done) }.buttonStyle(PillStyle())
            }
          }
        }
    case .done:
      page(
        icon: Image(nsImage: MenuBarGlyph.image()).renderingMode(.template), title: "Screencap is in your menu bar",
        body: "Click its icon, or press ⌥⌘S anywhere, to see today. The first threads appear a few minutes after you start working.") {
          Button("Open today", action: finish).buttonStyle(PillStyle(prominent: true, height: 34))
        }
    }
  }

  func page<Actions: View>(icon: Image, title: String, body: String, @ViewBuilder actions: () -> Actions) -> some View {
    VStack(spacing: 0) {
      icon.resizable().aspectRatio(contentMode: .fit).frame(width: 64, height: 64).foregroundStyle(Theme.ink2)
      Text(title).font(.system(size: 24, weight: .medium)).tracking(-0.3).foregroundStyle(Theme.ink)
        .multilineTextAlignment(.center).padding(.top, 22)
      Text(body).font(.ui(14)).foregroundStyle(Theme.ink4).multilineTextAlignment(.center).lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true).padding(.top, 10)
      VStack(spacing: 10) { actions() }.padding(.top, 28)
    }
  }

  func symbol(_ name: String) -> Image { Image(systemName: name).renderingMode(.template) }

  /// A step that is already satisfied: a check and the way on.
  func done(_ label: String, next: @escaping () -> Void) -> some View {
    VStack(spacing: 14) {
      Label(label, systemImage: "checkmark.circle.fill").font(.ui(13.5, .medium)).foregroundStyle(Theme.exact)
      Button("Continue", action: next).buttonStyle(PillStyle(prominent: true, height: 34))
    }
  }

  func go(_ next: Step) { withAnimation(.easeOut(duration: 0.2)) { step = next } }

  func save() {
    guard key.hasPrefix("sk-or-") else { return }
    saveKey(key)
    key = ""
    hasKey = true
  }

  /// macOS can need a fresh start before a new screen recording grant takes effect.
  static func relaunch() {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.createsNewApplicationInstance = true
    NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, _ in
      DispatchQueue.main.async { NSApp.terminate(nil) }
    }
  }
}
