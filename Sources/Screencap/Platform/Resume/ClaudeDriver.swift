import AppKit
import ApplicationServices
import ScreencapCore

/// Selecting one conversation inside Claude's single window.
///
/// Claude keeps every conversation in one window whose title is always "Claude", often a dozen of them at
/// once, so bringing the window forward leaves the person to find their place by reading the sidebar.
/// There is no dictionary to script, so the row is found in the window's accessibility tree and pressed, which is
/// what a click does.
@MainActor
struct ClaudeDriver: ThingDriver {
  func handles(_ thing: Thing) -> Bool { thing.kind == .session }

  func bring(_ thing: Thing) -> WindowIndex.Outcome { ClaudeWindow.select(title: thing.label) }
}

/// Reaching one conversation inside Claude's single window.
@MainActor
enum ClaudeWindow {
  static let bundleID = ClaudeSessionIndex.bundleID

  /// Puts the conversation named `title` in front, or says why it could not.
  ///
  /// Claude comes forward before its sidebar is read. While its window is on another Space, Claude lists no
  /// windows at all, so the sidebar can be read only once the switch to that Space is done.
  static func select(title: String) -> WindowIndex.Outcome {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
      return .missing
    }
    guard AXIsProcessTrusted() else { return .noPermission }
    let activated = app.activate()
    let element = application(app)
    guard let row = find(titled: title, in: element) else {
      // Claude renders only the rows scrolled into view, so a conversation further down the list cannot be
      // pressed. The window is in front all the same, which leaves one click rather than a search.
      return activated ? .windowOnly : .missing
    }
    return press(row) && activated ? .brought : .refused
  }

  /// The app's accessibility element, with the web tree asked for and waited for.
  ///
  /// Claude's window is drawn by a browser engine, which builds an accessibility tree only for a client that says
  /// it needs one, and then builds it in its own time: asked and read in the same breath, the window answers with
  /// no children at all. So the flag is set and the window's children are waited for.
  static func application(_ app: NSRunningApplication, waiting: TimeInterval = 2) -> AXUIElement {
    let element = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 1.0)
    AXUIElementSetAttributeValue(element, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    let deadline = Date().addingTimeInterval(waiting)
    while Date() < deadline {
      if hasWindowContent(element) { break }
      // The tree arrives on the app's own run loop, so this thread waits rather than spins.
      Thread.sleep(forTimeInterval: 0.1)
    }
    return element
  }

  /// Whether any window of the app has children: the sign that the tree has been built.
  static func hasWindowContent(_ app: AXUIElement) -> Bool {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
      let windows = value as? [AXUIElement]
    else { return false }
    for window in windows {
      var children: CFTypeRef?
      if AXUIElementCopyAttributeValue(window, kAXChildrenAttribute as CFString, &children) == .success,
        let list = children as? [AXUIElement], !list.isEmpty
      {
        return true
      }
    }
    return false
  }

  /// The app's windows, which is where the search starts: the menu bar is a large tree with nothing in it that
  /// a resume wants.
  static func windows(_ app: AXUIElement) -> [AXUIElement] {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
      let windows = value as? [AXUIElement]
    else { return [] }
    return windows
  }

  /// An element whose text is this conversation's name, searched breadth-first so the sidebar's rows are reached
  /// before the text inside the conversation itself.
  /// A row's text is the conversation's name followed by whatever the sidebar adds — "Open", "Started by Claude
  /// from …" — so an exact match is preferred and a row that begins with the name is accepted.
  /// How much of the tree a search may read. Claude's window holds tens of thousands of elements, so the search
  /// is bounded by time as well as by count: a resume has to feel instant whether or not it finds the row.
  static let searchBudget = 200_000
  static let searchSeconds: TimeInterval = 1.5
  /// What the last search cost, for the probe.
  private(set) static var lastSearch: (visited: Int, seconds: TimeInterval, exhausted: Bool) = (0, 0, false)

  static func find(titled title: String, in root: AXUIElement, budget: Int = searchBudget) -> AXUIElement? {
    let wanted = normalise(title)
    guard wanted.count >= 6 else { return nil }
    var queue = windows(root)
    if queue.isEmpty { queue = [root] }
    var left = budget
    var beginsWith: AXUIElement?
    let started = Date()
    let deadline = started.addingTimeInterval(searchSeconds)
    func done(_ found: AXUIElement?, exhausted: Bool) -> AXUIElement? {
      lastSearch = (budget - left, Date().timeIntervalSince(started), exhausted)
      return found
    }
    while !queue.isEmpty, left > 0 {
      var next: [AXUIElement] = []
      for element in queue {
        left -= 1
        if left <= 0 || Date() > deadline { return done(beginsWith, exhausted: true) }
        let said = text(of: element).map(normalise)
        if said.contains(wanted) { return done(element, exhausted: false) }
        if beginsWith == nil, said.contains(where: { $0.hasPrefix(wanted) }) { beginsWith = element }
        var value: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
          let children = value as? [AXUIElement]
        {
          next += children
        }
      }
      queue = next
    }
    return done(beginsWith, exhausted: false)
  }

  /// Whether the row for a conversation can be found, and what it says, without pressing anything.
  static func locate(title: String) -> (text: String, pressable: Bool)? {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first,
      AXIsProcessTrusted()
    else { return nil }
    guard let row = find(titled: title, in: application(app)) else { return nil }
    return (text(of: row).first { !$0.isEmpty } ?? "", pressableAncestor(row) != nil)
  }

  /// The element a press would land on: the row itself, or the nearest ancestor that can be pressed.
  static func pressableAncestor(_ element: AXUIElement, levels: Int = 4) -> AXUIElement? {
    var current: AXUIElement? = element
    for _ in 0...levels {
      guard let node = current else { return nil }
      var names: CFArray?
      if AXUIElementCopyActionNames(node, &names) == .success, let actions = names as? [String],
        actions.contains(where: { [kAXPressAction, "AXOpen", kAXPickAction].contains($0) })
      {
        return node
      }
      current = ContextMonitor.element(node, kAXParentAttribute)
    }
    return nil
  }

  /// Presses an element, or the nearest ancestor that can be pressed: the text of a sidebar row is sometimes a
  /// label inside the control rather than the control itself. Only a press, never the menu a row also offers.
  static func press(_ element: AXUIElement) -> Bool {
    guard let node = pressableAncestor(element) else { return false }
    var names: CFArray?
    guard AXUIElementCopyActionNames(node, &names) == .success, let actions = names as? [String] else { return false }
    for action in [kAXPressAction, "AXOpen", kAXPickAction] where actions.contains(action) {
      if AXUIElementPerformAction(node, action as CFString) == .success { return true }
    }
    return false
  }

  /// Everything an element says about itself, for matching and for the probe.
  static func text(of element: AXUIElement) -> [String] {
    [kAXTitleAttribute, kAXValueAttribute, kAXDescriptionAttribute].compactMap {
      ContextMonitor.string(element, $0)
    }
  }

  static func normalise(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "…"))
      .lowercased()
  }

  /// What the app's menus hold. Menus are built by the app rather than by the page, so they do not come and go
  /// with scrolling the way the sidebar's rows do.
  static func menus(limit: Int = 200) -> [String] {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first,
      AXIsProcessTrusted()
    else { return ["Claude is not running, or no Accessibility permission"] }
    let element = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 1.0)
    guard let bar = ContextMonitor.element(element, kAXMenuBarAttribute) else { return ["no menu bar"] }
    var lines: [String] = []
    func walk(_ node: AXUIElement, depth: Int) {
      guard lines.count < limit, depth < 4 else { return }
      var value: CFTypeRef?
      guard AXUIElementCopyAttributeValue(node, kAXChildrenAttribute as CFString, &value) == .success,
        let children = value as? [AXUIElement]
      else { return }
      for child in children {
        let role = ContextMonitor.string(child, kAXRoleAttribute) ?? "?"
        let name = ContextMonitor.string(child, kAXTitleAttribute) ?? ""
        if !name.isEmpty {
          lines.append("\(String(repeating: "  ", count: depth))\(role) \(name)")
        }
        walk(child, depth: depth + 1)
      }
    }
    walk(bar, depth: 0)
    return lines
  }

  /// What the window's tree holds, for working out how to reach the sidebar on a Mac where selection fails.
  /// Role, depth and text only — no conversation content is read beyond the labels that would be matched.
  static func probe(limit: Int = 400) -> [String] {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
      return ["Claude is not running"]
    }
    guard AXIsProcessTrusted() else { return ["no Accessibility permission"] }
    var lines: [String] = []
    let element = application(app)
    let found = windows(element)
    lines.append("windows: \(found.count), tree built: \(hasWindowContent(element))")
    var queue: [(AXUIElement, Int)] = (found.isEmpty ? [element] : found).map { ($0, 0) }
    while !queue.isEmpty, lines.count < limit {
      var next: [(AXUIElement, Int)] = []
      for (element, depth) in queue where lines.count < limit {
        let role = ContextMonitor.string(element, kAXRoleAttribute) ?? "?"
        let said = text(of: element).filter { !$0.isEmpty }.prefix(2).joined(separator: " · ")
        var names: CFArray?
        AXUIElementCopyActionNames(element, &names)
        let actions = (names as? [String])?.joined(separator: ",") ?? ""
        if !said.isEmpty || !actions.isEmpty {
          lines.append("\(String(repeating: "  ", count: depth))\(role) [\(actions)] \(said.prefix(80))")
        }
        var value: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
          let children = value as? [AXUIElement]
        {
          next += children.map { ($0, depth + 1) }
        }
      }
      queue = next
    }
    return lines
  }
}
