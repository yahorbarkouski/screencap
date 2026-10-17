import AppKit
import Foundation
import ScreencapCore

/// Whether Screencap may drive another app, and asking for it.
///
/// Selecting the page a thread was on means sending that browser an Apple event, which macOS gates per pair of
/// apps. The gate is silent: a refusal comes back as error -1743 with no dialog, and the person has no reason to
/// connect the two. So it is asked for while they are being onboarded, and once for anybody updating into a
/// version that has Resume, rather than at the moment a resume quietly fails.
@MainActor
enum AutomationAccess {
  enum State: String, Sendable {
    /// Allowed: pages can be selected inside this app.
    case allowed
    /// Refused, which only System Settings can undo.
    case refused
    /// Never asked, so asking now shows the system's dialog.
    case notAsked
    /// Not installed on this Mac.
    case notInstalled
  }

  /// The browsers worth asking about: the ones running now and the one that opens links. Asking about every
  /// browser installed showed one system dialog per browser, four in a row for a person who uses one.
  static func browsersInUse() -> [String] {
    var found = Set(
      NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier)
        .filter { PrivateWindows.browsers[$0] != nil })
    if let probe = URL(string: "https://example.com"),
      let app = NSWorkspace.shared.urlForApplication(toOpen: probe),
      let bundleID = Bundle(url: app)?.bundleIdentifier, PrivateWindows.browsers[bundleID] != nil
    {
      found.insert(bundleID)
    }
    return found.sorted()
  }

  /// The browsers installed here.
  static func installedBrowsers() -> [String] {
    PrivateWindows.browsers.keys
      .filter { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) != nil }
      .sorted()
  }

  /// The state of the gate, without showing anything. `AEDeterminePermissionToAutomateTarget` is the only way to
  /// read it: the TCC database itself cannot be opened without Full Disk Access.
  static func state(of bundleID: String) -> State {
    guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) != nil else { return .notInstalled }
    return determine(bundleID, ask: false)
  }

  /// Asks the gate, and with `ask` shows the system's dialog when it has never been asked.
  ///
  /// Free of AppKit so it can run off the main thread, which it must: with `ask` the call does not return until
  /// the person has answered the dialog, and a blocked main thread is a frozen app behind it.
  nonisolated static func determine(_ bundleID: String, ask: Bool) -> State {
    var target = AEAddressDesc()
    let identifier = Array(bundleID.utf8)
    let created = identifier.withUnsafeBufferPointer { buffer in
      AECreateDesc(typeApplicationBundleID, buffer.baseAddress, buffer.count, &target)
    }
    guard created == noErr else { return .notAsked }
    defer { AEDisposeDesc(&target) }
    let status = AEDeterminePermissionToAutomateTarget(&target, typeWildCard, typeWildCard, ask)
    switch status {
    case noErr: return .allowed
    // -1743: refused, and only System Settings can undo it.
    case OSStatus(errAEEventNotPermitted): return .refused
    // -1744: never asked, so asking now shows the dialog. This is what a fresh Mac answers, and why a resume that
    // has never asked fails exactly like a refusal.
    case OSStatus(errAEEventWouldRequireUserConsent): return .notAsked
    // -600: the app is not running, so nothing can be said about it yet.
    case OSStatus(procNotFound): return .notAsked
    default: return .notAsked
    }
  }

  /// Shows the system's dialog for each browser that has never been asked about, and answers with what every
  /// installed browser's state is afterwards.
  ///
  /// Two things have to be true or the dialog never appears. Screencap has to be the active app: macOS shows no
  /// consent dialog for an app the person is not looking at, and the call simply answers "would need consent"
  /// instead. And the call has to be off the main thread, because it does not return until the dialog is
  /// answered.
  static func request(_ browsers: [String] = browsersInUse()) async -> [String: State] {
    // NSApp is nil until the shared application exists, which a command-line run has not set up.
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.activate()
    // Let the activation land before the first dialog is asked for.
    try? await Task.sleep(for: .milliseconds(250))
    var states: [String: State] = [:]
    for bundleID in browsers {
      states[bundleID] = await withCheckedContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
          continuation.resume(returning: determine(bundleID, ask: true))
        }
      }
    }
    return states
  }

  /// Whether anything can be driven at all: one allowed browser is enough for a resume to select pages.
  static func anyAllowed() -> Bool {
    installedBrowsers().contains { state(of: $0) == .allowed }
  }

  /// Whether a browser in use has never been asked about, which is when the card is worth showing.
  static func anyUnasked() -> Bool {
    browsersInUse().contains { state(of: $0) == .notAsked }
  }

  /// What to say after asking: which browsers answered, or that macOS showed nothing at all.
  static func outcome(of states: [String: State]) -> String {
    let allowed = states.filter { $0.value == .allowed }.keys.map(name(of:)).sorted()
    let refused = states.filter { $0.value == .refused }.keys.map(name(of:)).sorted()
    if !allowed.isEmpty {
      var said = "Allowed: " + allowed.joined(separator: ", ")
      if !refused.isEmpty { said += " · refused: " + refused.joined(separator: ", ") }
      return said
    }
    if !refused.isEmpty { return "Refused: " + refused.joined(separator: ", ") + ". Change it in System Settings." }
    return "macOS did not ask. Allow Screencap under Privacy & Security › Automation."
  }

  /// A line naming what is allowed, for Settings and for the palette when a resume could not reach a page.
  static func summary() -> String {
    let states = installedBrowsers().map { ($0, state(of: $0)) }
    let allowed = states.filter { $0.1 == .allowed }.map { name(of: $0.0) }
    let refused = states.filter { $0.1 == .refused }.map { name(of: $0.0) }
    if allowed.isEmpty, refused.isEmpty { return "No browser has been asked about yet." }
    var parts: [String] = []
    if !allowed.isEmpty { parts.append("Allowed: " + allowed.joined(separator: ", ")) }
    if !refused.isEmpty { parts.append("Refused: " + refused.joined(separator: ", ")) }
    return parts.joined(separator: " · ")
  }

  static func name(of bundleID: String) -> String {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { return bundleID }
    return url.deletingPathExtension().lastPathComponent
  }

  /// Opens the pane where a refusal is undone, since nothing in the app can undo it.
  static func openSettings() {
    guard
      let url = URL(
        string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
    else { return }
    NSWorkspace.shared.open(url)
  }
}
