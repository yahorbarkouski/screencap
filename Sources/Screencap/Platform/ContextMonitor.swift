import AppKit
import ApplicationServices
import ScreencapCore

/// Knows the frontmost app, window title and browser page, and reports changes and lifecycle markers.
///
/// Everything is pushed: workspace notifications for app switches, sleep and session changes, distributed
/// notifications for screen lock, and an Accessibility observer on the frontmost app for window and title changes.
/// Busy pages change their title several times a second, so title events are throttled: the first is handled at
/// once, then at most one more per two seconds.
@MainActor
final class ContextMonitor {
  var onContextChange: ((ForegroundContext) -> Void)?
  /// The app, title, site or path in front changed; dwell capture times its view trigger from this.
  var onViewChange: ((ForegroundContext) -> Void)?
  var onMarker: ((MarkerKind) -> Void)?
  var onApplicationsChanged: (() -> Void)?

  private(set) var current = ForegroundContext()
  private var observer: AXObserver?
  private var observedPID: pid_t?
  private var lastTitleEvent = Date.distantPast
  private var pendingTitleRead: Timer?
  private var webArea: (window: AXUIElement, title: String?, area: AXUIElement)?
  private var tokens: [NSObjectProtocol] = []
  static let titleThrottle: TimeInterval = 2

  static let chromiumBrowsers: Set<String> = [
    "com.google.Chrome", "com.google.Chrome.canary", "com.brave.Browser", "com.microsoft.edgemac",
    "company.thebrowser.Browser", "company.thebrowser.dia", "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
  ]
  static let browsers: Set<String> = chromiumBrowsers.union(["com.apple.Safari", "com.apple.SafariTechnologyPreview"])

  func start() {
    let workspace = NSWorkspace.shared.notificationCenter
    let markers: [(NSNotification.Name, MarkerKind)] = [
      (NSWorkspace.willSleepNotification, .sleep), (NSWorkspace.didWakeNotification, .wake),
      (NSWorkspace.screensDidSleepNotification, .sleep), (NSWorkspace.screensDidWakeNotification, .wake),
      (NSWorkspace.sessionDidResignActiveNotification, .screenLocked),
      (NSWorkspace.sessionDidBecomeActiveNotification, .screenUnlocked),
    ]
    for (name, kind) in markers {
      tokens.append(workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.onMarker?(kind) }
      })
    }
    let distributed = DistributedNotificationCenter.default()
    for (name, kind) in [("com.apple.screenIsLocked", MarkerKind.screenLocked), ("com.apple.screenIsUnlocked", .screenUnlocked)] {
      tokens.append(distributed.addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.onMarker?(kind) }
      })
    }
    tokens.append(workspace.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) {
      [weak self] _ in MainActor.assumeIsolated { self?.frontmostAppChanged() }
    })
    for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
      tokens.append(workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.onApplicationsChanged?() }
      })
    }
    frontmostAppChanged()
  }

  /// Reads the context now. Cheap: tens of microseconds once the page element is cached.
  func readContext() -> ForegroundContext {
    guard let app = NSWorkspace.shared.frontmostApplication else { return ForegroundContext() }
    let pid = app.processIdentifier
    let bundleID = app.bundleIdentifier
    var context = ForegroundContext(bundleID: bundleID, appName: app.localizedName ?? bundleID)
    if AXIsProcessTrusted() {
      let element = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(element, 0.25)
      if let window = Self.element(element, kAXFocusedWindowAttribute) {
        context.windowTitle = Self.string(window, kAXTitleAttribute)
        if let bundleID, Self.browsers.contains(bundleID),
          let url = pageURL(app: element, window: window, title: context.windowTitle)
        {
          context.urlHost = url.host()
          context.urlPath = url.path().isEmpty ? nil : url.path()
        }
      }
    }
    if context.windowTitle == nil { context.windowTitle = Self.windowListTitle(pid: pid) }
    return context
  }

  private func frontmostAppChanged() {
    guard let app = NSWorkspace.shared.frontmostApplication else { return }
    attachObserver(to: app)
    publish()
  }

  /// A new app or site is a switch (the capture filter may need new windows); any change of the context key is a
  /// view change.
  private func publish() {
    let context = readContext()
    // A browser page that is still loading has no URL yet; its site is unknown, not a new one.
    if let bundleID = context.bundleID, Self.browsers.contains(bundleID), context.urlHost == nil,
      bundleID == current.bundleID
    {
      return
    }
    let switched = context.placeKey != current.placeKey
    let viewChanged = context.key != current.key
    current = context
    if switched { onContextChange?(context) }
    if viewChanged { onViewChange?(context) }
  }

  private func titleEvent() {
    let now = Date()
    if now.timeIntervalSince(lastTitleEvent) >= Self.titleThrottle, pendingTitleRead == nil {
      lastTitleEvent = now
      publish()
      return
    }
    guard pendingTitleRead == nil else { return }
    let delay = max(0.1, Self.titleThrottle - now.timeIntervalSince(lastTitleEvent))
    pendingTitleRead = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.pendingTitleRead = nil
        self.lastTitleEvent = Date()
        self.publish()
      }
    }
  }

  private func attachObserver(to app: NSRunningApplication) {
    let pid = app.processIdentifier
    guard pid != observedPID else { return }
    if let observer {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
    }
    observer = nil
    observedPID = pid
    webArea = nil
    guard AXIsProcessTrusted() else { return }
    let appElement = AXUIElementCreateApplication(pid)
    if let bundleID = app.bundleIdentifier, Self.chromiumBrowsers.contains(bundleID) {
      // Chromium builds its web accessibility tree only for assistive clients that ask for it.
      AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    }
    let callback: AXObserverCallback = { _, _, _, refcon in
      guard let refcon else { return }
      let monitor = Unmanaged<ContextMonitor>.fromOpaque(refcon).takeUnretainedValue()
      MainActor.assumeIsolated { monitor.titleEvent() }
    }
    var created: AXObserver?
    guard AXObserverCreate(pid, callback, &created) == .success, let created else { return }
    let refcon = Unmanaged.passUnretained(self).toOpaque()
    for name in [kAXFocusedWindowChangedNotification, kAXTitleChangedNotification, kAXMainWindowChangedNotification] {
      AXObserverAddNotification(created, appElement, name as CFString, refcon)
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .defaultMode)
    observer = created
  }

  /// The URL of the page in a browser window, from its AXWebArea. A tab switch keeps the window but replaces the
  /// page, and the old tab's element stays valid and keeps answering with the old URL, so the cache holds only
  /// while the window title is unchanged.
  private func pageURL(app: AXUIElement, window: AXUIElement, title: String?) -> URL? {
    if let cached = webArea, CFEqual(cached.window, window), cached.title == title, let url = Self.url(cached.area) {
      return url
    }
    var budget = 3000
    guard let area = Self.focusedWebArea(app) ?? Self.findWebArea(window, depth: 0, budget: &budget) else {
      return nil
    }
    webArea = (window, title, area)
    return Self.url(area)
  }

  /// The web area that contains the focused element: the page the person is looking at.
  static func focusedWebArea(_ app: AXUIElement) -> AXUIElement? {
    var current = element(app, kAXFocusedUIElementAttribute)
    var steps = 0
    while let node = current, steps < 40 {
      if string(node, kAXRoleAttribute) == "AXWebArea" { return node }
      current = element(node, kAXParentAttribute)
      steps += 1
    }
    return nil
  }

  static func findWebArea(_ element: AXUIElement, depth: Int, budget: inout Int) -> AXUIElement? {
    budget -= 1
    if budget < 0 || depth > 14 { return nil }
    if string(element, kAXRoleAttribute) == "AXWebArea" { return element }
    var children: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
      let list = children as? [AXUIElement]
    else { return nil }
    for child in list {
      if let found = findWebArea(child, depth: depth + 1, budget: &budget) { return found }
    }
    return nil
  }

  static func element(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success, let value,
      CFGetTypeID(value) == AXUIElementGetTypeID()
    else { return nil }
    return (value as! AXUIElement)
  }

  static func string(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return value as? String
  }

  static func url(_ element: AXUIElement) -> URL? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, "AXURL" as CFString, &value) == .success, let value else { return nil }
    if let url = value as? URL { return url }
    if let text = value as? String { return URL(string: text) }
    return nil
  }

  static func windowListTitle(pid: pid_t) -> String? {
    guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]]
    else { return nil }
    return windows.first {
      ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
        && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
    }?[kCGWindowName as String] as? String
  }
}
