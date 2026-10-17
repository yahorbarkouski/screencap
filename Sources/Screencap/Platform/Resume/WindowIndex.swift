import AppKit
import ApplicationServices
import ScreencapCore

/// The windows on screen right now, and bringing one of them to the front.
///
/// Resuming a thread is almost never about reopening something: the windows of a thread returned to twenty
/// times in an evening stay open the whole time, buried under the others. So the work is finding which of the
/// windows that already exist belong to a thread, and raising them. Nothing is moved, resized, closed or hidden.
@MainActor
enum WindowIndex {
  struct Entry: Sendable {
    var bundleID: String
    var appName: String
    var pid: pid_t
    var title: String
    /// Front-to-back order as the window server reports it, frontmost first.
    var order: Int
  }

  /// Ordinary windows of ordinary apps, frontmost first. Menu-bar panels and the desktop are left out.
  static func onScreen() -> [Entry] {
    guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]]
    else { return [] }
    var apps: [pid_t: NSRunningApplication] = [:]
    for app in NSWorkspace.shared.runningApplications {
      apps[app.processIdentifier] = app
    }
    var entries: [Entry] = []
    for (order, window) in windows.enumerated() {
      guard (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
        let pid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
        let app = apps[pid], let bundleID = app.bundleIdentifier
      else { continue }
      entries.append(
        Entry(
          bundleID: bundleID, appName: app.localizedName ?? bundleID, pid: pid,
          title: window[kCGWindowName as String] as? String ?? "", order: order))
    }
    return entries
  }

  /// Whether an app is running at all, which is what tells a missing thing from a closed one.
  static func isRunning(bundleID: String) -> Bool {
    !NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).isEmpty
  }

  /// Raises the window of `bundleID` whose title matches `title`, and brings the app forward. `missing` means the
  /// app is not running.
  ///
  /// Titles are compared the way captures store them, without unread counters, and a window whose title was
  /// shortened with an ellipsis matches on the part before it: a browser writes "Main: Release notes for ve…" and
  /// then changes it as the page loads.
  static func raise(bundleID: String, title: String?) -> Outcome {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
      return .missing
    }
    guard AXIsProcessTrusted() else { return .noPermission }
    let element = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 0.5)
    guard let title, !title.isEmpty else {
      return app.activate() ? .brought : .failed
    }
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &value) == .success,
      let windows = value as? [AXUIElement]
    else { return .failed }
    let window = windows.first { candidate in
      guard let found = ContextMonitor.string(candidate, kAXTitleAttribute) else { return false }
      return ThingKey.titlesMatch(found, title)
    }
    // The app is open but none of its windows shows the place any more: Slack, Telegram and Notion keep one window
    // whose title follows the channel, chat or page on screen. The app still comes forward, and the outcome says it
    // landed somewhere else rather than counting as the place.
    guard let window else { return app.activate() ? .windowOnly : .refused }
    // Raising puts the window in front of its app's others; activating brings the app itself forward. A window on
    // another Space refuses to raise, which is reported rather than worked around.
    let raised = AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success
    let activated = app.activate()
    return raised && activated ? .brought : .refused
  }

  /// What came of trying to bring one thing forward.
  enum Outcome: String, Sendable {
    /// It is in front now.
    case brought
    /// It had been closed, so it was opened again.
    case opened
    /// It is not there any more and nothing here knows how to open it.
    case missing
    /// It exists but would not come forward, which usually means it lives on another Space.
    case refused
    /// The app came forward but the thing inside it could not be reached: Claude renders only the sidebar rows
    /// that are scrolled into view, so a conversation further down the list has no row to press, and Slack's one
    /// window may be showing another channel.
    case windowOnly = "window only"
    /// Screencap has no Accessibility or Apple Events permission for this.
    case noPermission = "no permission"
    /// Nothing here knows how to drive this app any finer than its window.
    case unsupported
    case failed
  }
}
