import AppKit
import Foundation
import ScreencapCore

/// Finding and selecting a page in a browser, through Apple Events.
///
/// A browser window holds pages from several threads at once, and one window can show a video and a code
/// review a minute apart, so a resume must never bring a browser *window* forward as a unit.
/// It selects the page inside whatever window holds it, and leaves the rest of the tabs alone.
///
/// Dia and Chrome describe windows and tabs in their dictionaries (`active tab`, `tabs`, `URL`), which is what this
/// drives. Firefox has no dictionary, so a page in Firefox can only be found as a window.
@MainActor
struct BrowserDriver: ThingDriver {
  func handles(_ thing: Thing) -> Bool { thing.kind == .tab }

  func note(for outcome: WindowIndex.Outcome) -> String? { BrowserTabs.lastError }

  /// The page may have moved to another browser since it was bound, so every browser that is running is asked,
  /// starting with the one it was seen in.
  func bring(_ thing: Thing) -> WindowIndex.Outcome {
    guard let bundleID = thing.bundleID else { return .failed }
    // A browser with no dictionary cannot be asked for its tabs or told to select one, so the best Resume can do is
    // bring the browser forward, which leaves you a tab away.
    if PrivateWindows.browsers[bundleID] == .firefox {
      return WindowIndex.raise(bundleID: bundleID, title: nil) == .brought ? .windowOnly : .missing
    }
    for browser in BrowserDriver.candidates(preferring: bundleID) {
      guard let tab = BrowserTabs.find(key: thing.key, bundleID: browser) else { continue }
      let outcome = BrowserTabs.select(tab, bundleID: browser)
      if outcome == .brought {
        NSRunningApplication.runningApplications(withBundleIdentifier: browser).first?.activate()
      }
      return outcome
    }
    return BrowserTabs.tabs(bundleID: bundleID) != nil ? .missing : BrowserTabs.lastOutcome
  }

  /// Opening a closed page puts it in a new tab of the browser it belongs to, leaving every other tab alone.
  func reopen(_ thing: Thing) -> WindowIndex.Outcome {
    guard thing.key.hasPrefix("url:"), let url = URL(string: "https://" + thing.key.dropFirst(4)) else {
      return .failed
    }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    guard let bundleID = thing.bundleID,
      let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
    else {
      // The browser it was seen in is gone from this Mac; whatever opens pages now will do.
      NSWorkspace.shared.open(url)
      return .opened
    }
    NSWorkspace.shared.open([url], withApplicationAt: app, configuration: configuration)
    return .opened
  }

  static func candidates(preferring bundleID: String) -> [String] {
    [bundleID] + PrivateWindows.browsers.keys.filter { $0 != bundleID && WindowIndex.isRunning(bundleID: $0) }
  }
}

/// Finding and selecting a page through a browser's own dictionary.
@MainActor
enum BrowserTabs {
  struct Tab: Sendable {
    var windowIndex: Int
    var tabIndex: Int
    var url: String
    /// The key `ThingKey` would give this page, so matching uses the same normalisation as binding.
    var thingKey: String?
  }

  /// Every page open in a browser, or nil when the browser cannot be asked.
  /// What each browser answered during the current resume. Reading every tab is one Apple event round trip per
  /// browser, a tenth of a second or more; a thread with five pages used to read them five times over.
  private static var answered: [String: [Tab]?]?

  /// Runs `body` with each browser's tabs read at most once.
  static func readingOnce<T>(_ body: () throws -> T) rethrows -> T {
    answered = [:]
    defer { answered = nil }
    return try body()
  }

  static func tabs(bundleID: String) -> [Tab]? {
    if let cached = answered?[bundleID] { return cached }
    let read = readTabs(bundleID: bundleID)
    answered?[bundleID] = .some(read)
    return read
  }

  private static func readTabs(bundleID: String) -> [Tab]? {
    guard PrivateWindows.browsers[bundleID] != nil else { return nil }
    let script = """
      tell application id "\(bundleID)"
        set output to ""
        repeat with w from 1 to (count of windows)
          repeat with t from 1 to (count of tabs of window w)
            set output to output & w & "\t" & t & "\t" & (URL of tab t of window w) & linefeed
          end repeat
        end repeat
        return output
      end tell
      """
    guard let text = run(script) else { return nil }
    return text.split(separator: "\n").compactMap { line in
      let parts = line.split(separator: "\t", omittingEmptySubsequences: false)
      guard parts.count >= 3, let window = Int(parts[0]), let tab = Int(parts[1]) else { return nil }
      let url = parts[2...].joined(separator: "\t")
      return Tab(windowIndex: window, tabIndex: tab, url: url, thingKey: ThingKey.key(forURL: url))
    }
  }

  /// The tab each window shows, windows in the browser's front-to-back order, for checking what a resume did.
  /// Nil for a browser whose dictionary does not say (Dia refuses to report its `active tab`, Firefox has none).
  static func shownTabs(bundleID: String) -> [(window: Int, tab: Int)]? {
    let property: String
    switch PrivateWindows.browsers[bundleID] {
    case .chromium: property = "active tab index of window w"
    case .safari: property = "index of current tab of window w"
    default: return nil
    }
    let script = """
      tell application id "\(bundleID)"
        set output to ""
        repeat with w from 1 to (count of windows)
          set output to output & w & "\t" & (\(property)) & linefeed
        end repeat
        return output
      end tell
      """
    guard let text = run(script) else { return nil }
    return text.split(separator: "\n").compactMap { line in
      let parts = line.split(separator: "\t")
      guard parts.count == 2, let window = Int(parts[0]), let tab = Int(parts[1]) else { return nil }
      return (window, tab)
    }
  }

  /// Selects a page and raises the window holding it. The app is brought forward by the caller, so that a resume
  /// can decide which of the things it brought ends up in front.
  static func select(_ tab: Tab, bundleID: String) -> WindowIndex.Outcome {
    guard let family = PrivateWindows.browsers[bundleID] else { return .unsupported }
    // What a browser accepts is not what its dictionary says it accepts. Dia declares `active tab`, a window's
    // `index` and a tab's `isFocused` as writable and refuses all three with -10006; its `focus` command, which
    // brings the window forward as well, is the only one that works. Checked against Dia on 2026-10-17.
    let selection: String
    switch family {
    case .arc:
      selection = "focus tab \(tab.tabIndex) of window \(tab.windowIndex)"
    case .chromium:
      selection = """
        set active tab index of window \(tab.windowIndex) to \(tab.tabIndex)
                set index of window \(tab.windowIndex) to 1
        """
    case .safari:
      selection = """
        set current tab of window \(tab.windowIndex) to tab \(tab.tabIndex) of window \(tab.windowIndex)
                set index of window \(tab.windowIndex) to 1
        """
    case .firefox:
      return .unsupported
    }
    let script = """
      tell application id "\(bundleID)"
        \(selection)
      end tell
      """
    return run(script) == nil ? lastOutcome : .brought
  }

  /// The page a thread wants, among those open now.
  ///
  /// Exactly, when it is there. Otherwise the one open page in the same section, because a page's address moves
  /// on while the place stays: a series bound at `watch/1001` is open the next day at
  /// `watch/1002`, which is the same place to come back to. Only a single candidate is taken, so
  /// a section holding several open pages is left alone rather than guessed at.
  static func find(key: String, bundleID: String) -> Tab? {
    guard let tabs = tabs(bundleID: bundleID) else { return nil }
    if let exact = tabs.first(where: { $0.thingKey == key }) { return exact }
    guard let section = ThingKey.section(of: key) else { return nil }
    let near = tabs.filter { tab in tab.thingKey.flatMap(ThingKey.section(of:)) == section }
    return near.count == 1 ? near[0] : nil
  }

  private(set) static var lastOutcome: WindowIndex.Outcome = .failed
  private(set) static var lastError: String?

  /// Runs a script, or records why it could not. Apple Events need the person's permission for each app they
  /// reach, which macOS asks for the first time and remembers.
  static func run(_ source: String) -> String? {
    lastError = nil
    guard let script = NSAppleScript(source: source) else {
      lastOutcome = .failed
      return nil
    }
    var error: NSDictionary?
    let result = script.executeAndReturnError(&error)
    if let error {
      let code = error[NSAppleScript.errorNumber] as? Int ?? 0
      lastError = "\(code): \(error[NSAppleScript.errorMessage] as? String ?? "unknown")"
      // -1743 is the person not having allowed this app to drive that one; -600 is the app not running.
      lastOutcome = code == -1743 ? .noPermission : (code == -600 ? .missing : .failed)
      return nil
    }
    lastOutcome = .brought
    return result.stringValue ?? ""
  }
}
