import AppKit
import ScreencapCore

/// Any app with nothing finer to aim at: its window, raised by title, or the app itself.
@MainActor
struct WindowDriver: ThingDriver {
  func handles(_ thing: Thing) -> Bool { thing.kind == .window || thing.kind == .app }

  func bring(_ thing: Thing) -> WindowIndex.Outcome {
    guard let bundleID = thing.bundleID else { return .failed }
    return WindowIndex.raise(bundleID: bundleID, title: thing.kind == .window ? thing.label : nil)
  }

  /// The app's one window had moved on to another channel, chat or page.
  func note(for outcome: WindowIndex.Outcome) -> String? {
    outcome == .windowOnly ? "in front, showing something else" : nil
  }

  /// An app that is not running is started: a thread's window cannot come back without it.
  func reopen(_ thing: Thing) -> WindowIndex.Outcome {
    guard let bundleID = thing.bundleID,
      let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
    else { return .missing }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    NSWorkspace.shared.openApplication(at: url, configuration: configuration)
    return .opened
  }
}
