import Foundation

/// Whether a capture may happen now, and if not, which hard-boundary marker explains the gap.
public enum CaptureGate {
  public struct State: Sendable {
    public var isPaused = false
    /// Screen locked, asleep, or another user's session.
    public var isScreenUnavailable = false
    public var secondsSinceInput: Double = 0
    public var isSecureInputOn = false
    public var hasScreenRecordingPermission = true
    public var context = ForegroundContext()
    public var excludedBundleIDs: Set<String> = []
    /// The focused window is a private browser window (`PrivateWindows`, read by the capture engine's scanner).
    public var isFocusedWindowPrivate = false

    public init() {}
  }

  public enum Verdict: Equatable, Sendable {
    case capture
    case blocked(MarkerKind)
  }

  /// No input for five minutes is idle.
  public static let idleAfter: Double = 300

  public static func evaluate(_ state: State) -> Verdict {
    if state.isPaused { return .blocked(.paused) }
    if state.isScreenUnavailable { return .blocked(.screenLocked) }
    if !state.hasScreenRecordingPermission { return .blocked(.permissionLost) }
    if state.secondsSinceInput >= idleAfter { return .blocked(.idle) }
    if state.isSecureInputOn { return .blocked(.secureInput) }
    let excluded = Set(state.excludedBundleIDs.map { $0.lowercased() })
    if let bundleID = state.context.bundleID?.lowercased(), excluded.contains(bundleID) { return .blocked(.excluded) }
    if state.isFocusedWindowPrivate || PrivateWindows.isPrivate(bundleID: state.context.bundleID, title: state.context.windowTitle) {
      return .blocked(.excluded)
    }
    if isPasswordPage(host: state.context.urlHost, path: state.context.urlPath) { return .blocked(.excluded) }
    return .capture
  }

  /// Password managers' web vaults and the browsers' own password pages, where "show password" turns on no secure
  /// input.
  static let passwordHosts: Set<String> = [
    "vault.bitwarden.com", "vault.bitwarden.eu", "my.1password.com", "my.1password.eu", "my.1password.ca",
    "start.1password.com", "passwords.google.com", "app.dashlane.com", "pass.proton.me", "app.nordpass.com",
    "keepersecurity.com", "keepersecurity.eu", "lastpass.com", "lastpass.eu",
    // chrome://password-manager in Chrome, Arc, Brave and Dia; edge://wallet in Edge.
    "password-manager", "wallet",
  ]

  public static func isPasswordPage(host: String?, path: String?) -> Bool {
    guard let host = host?.lowercased() else { return false }
    if host == "lastpass.com" || host == "lastpass.eu" { return (path ?? "").lowercased().hasPrefix("/vault") }
    if passwordHosts.contains(host) { return true }
    // chrome://settings/passwords in older Chromium builds; about:logins in Firefox.
    return (host == "settings" && (path ?? "").lowercased().hasPrefix("/passwords")) || host == "logins"
  }
}
