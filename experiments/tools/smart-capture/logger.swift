// Logs a per-second input and focus timeline for the smart-capture study, without key contents or screen content.
//
// Every second it writes one JSON line with the number of key presses, clicks, scroll events and mouse moves seen
// since the previous second (window-server counters, which need no permission) and the current focus: the
// frontmost app's bundle id and salted hashes of the window title and of the browser page's host and path, read
// through the same Accessibility calls as Screencap's ContextMonitor. Focus changes and sleep, wake and lock
// events are written as separate lines the moment they happen. Titles and URLs are never written in clear; the
// salt lives in a separate file so the analysis can hash the app's capture rows the same way.
//
// Build: DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swiftc -O logger.swift -o logger
// Run:   ./logger --out timeline.jsonl --salt salt.txt --hours 3
//        ./logger --probe   (prints whether Accessibility is trusted and one sample, then exits)

import AppKit
import ApplicationServices
import Carbon
import CryptoKit

struct Options {
  var out = "timeline.jsonl"
  var saltPath = "salt.txt"
  var hours = 3.0
  var probe = false

  init(_ arguments: [String]) {
    var iterator = arguments.dropFirst().makeIterator()
    while let argument = iterator.next() {
      switch argument {
      case "--out": out = iterator.next() ?? out
      case "--salt": saltPath = iterator.next() ?? saltPath
      case "--hours": hours = Double(iterator.next() ?? "") ?? hours
      case "--probe": probe = true
      default: fatalError("unknown argument \(argument)")
      }
    }
  }
}

/// The focus at one moment, with every free-text field hashed.
struct Focus: Equatable {
  var app = ""
  var title = ""
  var stableTitle = ""
  var host = ""
  var path = ""
  var titleKnown = false
}

final class Hasher {
  let salt: String
  init(salt: String) { self.salt = salt }

  func hash(_ text: String?) -> String {
    guard let text, !text.isEmpty else { return "" }
    let digest = SHA256.hash(data: Data((salt + text).utf8))
    return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
  }
}

@MainActor
final class Logger {
  static let chromiumBrowsers: Set<String> = [
    "com.google.Chrome", "com.google.Chrome.canary", "com.brave.Browser", "com.microsoft.edgemac",
    "company.thebrowser.Browser", "company.thebrowser.dia", "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
  ]
  static let browsers: Set<String> = chromiumBrowsers.union(["com.apple.Safari", "com.apple.SafariTechnologyPreview"])

  static let counted: [(String, [CGEventType])] = [
    ("k", [.keyDown]),
    ("mod", [.flagsChanged]),
    ("c", [.leftMouseDown, .rightMouseDown, .otherMouseDown]),
    ("s", [.scrollWheel]),
    ("m", [.mouseMoved]),
    ("d", [.leftMouseDragged, .rightMouseDragged, .otherMouseDragged]),
  ]

  let output: FileHandle
  let hasher: Hasher
  let trusted: Bool
  var lastCounts: [String: UInt32] = [:]
  var focus = Focus()
  var axEvents = 0
  var observer: AXObserver?
  var observedPID: pid_t?
  var webArea: (window: AXUIElement, title: String?, area: AXUIElement)?
  var tokens: [NSObjectProtocol] = []
  var timer: Timer?

  init(output: FileHandle, hasher: Hasher) {
    self.output = output
    self.hasher = hasher
    trusted = AXIsProcessTrusted()
  }

  func write(_ object: [String: Any]) {
    var line = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    line.append(0x0A)
    output.write(line)
  }

  static func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() / 1000 }

  func counts() -> [String: UInt32] {
    var result: [String: UInt32] = [:]
    for (name, types) in Self.counted {
      result[name] = types.reduce(UInt32(0)) {
        $0 &+ CGEventSource.counterForEventType(.combinedSessionState, eventType: $1)
      }
    }
    return result
  }

  func start(hours: Double) {
    lastCounts = counts()
    write(["t": Self.now(), "ev": "start", "trusted": trusted, "hours": hours])
    let workspace = NSWorkspace.shared.notificationCenter
    let markers: [(NSNotification.Name, String)] = [
      (NSWorkspace.willSleepNotification, "sleep"), (NSWorkspace.didWakeNotification, "wake"),
      (NSWorkspace.screensDidSleepNotification, "screensSleep"), (NSWorkspace.screensDidWakeNotification, "screensWake"),
      (NSWorkspace.sessionDidResignActiveNotification, "sessionResign"),
      (NSWorkspace.sessionDidBecomeActiveNotification, "sessionActive"),
    ]
    for (name, kind) in markers {
      tokens.append(workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.write(["t": Self.now(), "ev": kind]) }
      })
    }
    let distributed = DistributedNotificationCenter.default()
    for (name, kind) in [("com.apple.screenIsLocked", "locked"), ("com.apple.screenIsUnlocked", "unlocked")] {
      tokens.append(distributed.addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.write(["t": Self.now(), "ev": kind]) }
      })
    }
    tokens.append(
      workspace.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) {
        [weak self] _ in
        MainActor.assumeIsolated {
          guard let self else { return }
          self.write(["t": Self.now(), "ev": "activate", "app": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""])
          self.attachObserver()
          self.refreshFocus(source: "activate")
        }
      })
    attachObserver()
    refreshFocus(source: "start")
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    timer?.tolerance = 0.05
    DispatchQueue.main.asyncAfter(deadline: .now() + hours * 3600) { [weak self] in
      MainActor.assumeIsolated {
        self?.write(["t": Self.now(), "ev": "end"])
        exit(0)
      }
    }
  }

  func tick() {
    // A focus change the observer missed (apps without title notifications) still shows up within a second.
    refreshFocus(source: "poll")
    let current = counts()
    var line: [String: Any] = ["t": Self.now()]
    for (name, value) in current { line[name] = Int(value &- (lastCounts[name] ?? value)) }
    lastCounts = current
    line["ax"] = axEvents
    axEvents = 0
    line["idle"] = (CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!) * 10).rounded() / 10
    line["secure"] = IsSecureEventInputEnabled()
    line["app"] = focus.app
    line["th"] = focus.stableTitle
    line["hh"] = focus.host
    line["ph"] = focus.path
    write(line)
  }

  func refreshFocus(source: String) {
    let next = readFocus()
    guard next != focus else { return }
    focus = next
    write([
      "t": Self.now(), "ev": "focus", "src": source, "app": next.app, "rawTh": next.title, "th": next.stableTitle,
      "hh": next.host, "ph": next.path, "titleKnown": next.titleKnown,
    ])
  }

  func readFocus() -> Focus {
    guard let app = NSWorkspace.shared.frontmostApplication else { return Focus() }
    let bundleID = app.bundleIdentifier ?? ""
    var result = Focus(app: bundleID)
    var title: String?
    if trusted {
      let element = AXUIElementCreateApplication(app.processIdentifier)
      AXUIElementSetMessagingTimeout(element, 0.25)
      if let window = Self.element(element, kAXFocusedWindowAttribute) {
        title = Self.string(window, kAXTitleAttribute)
        if Self.browsers.contains(bundleID), let url = pageURL(app: element, window: window, title: title) {
          result.host = hasher.hash(url.host())
          result.path = hasher.hash(url.path().isEmpty ? nil : url.path())
        }
      }
    }
    if title == nil { title = Self.windowListTitle(pid: app.processIdentifier) }
    result.titleKnown = title != nil
    result.title = hasher.hash(title)
    result.stableTitle = hasher.hash(title?.replacingOccurrences(of: #"^\(\d+\)\s*"#, with: "", options: .regularExpression))
    return result
  }

  func attachObserver() {
    guard let app = NSWorkspace.shared.frontmostApplication else { return }
    let pid = app.processIdentifier
    guard pid != observedPID else { return }
    if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode) }
    observer = nil
    observedPID = pid
    webArea = nil
    guard trusted else { return }
    let appElement = AXUIElementCreateApplication(pid)
    if let bundleID = app.bundleIdentifier, Self.chromiumBrowsers.contains(bundleID) {
      AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    }
    let callback: AXObserverCallback = { _, _, _, refcon in
      guard let refcon else { return }
      let logger = Unmanaged<Logger>.fromOpaque(refcon).takeUnretainedValue()
      MainActor.assumeIsolated {
        logger.axEvents += 1
        logger.refreshFocus(source: "ax")
      }
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

  func pageURL(app: AXUIElement, window: AXUIElement, title: String?) -> URL? {
    if let cached = webArea, CFEqual(cached.window, window), cached.title == title, let url = Self.url(cached.area) {
      return url
    }
    var budget = 3000
    guard let area = Self.focusedWebArea(app) ?? Self.findWebArea(window, depth: 0, budget: &budget) else { return nil }
    webArea = (window, title, area)
    return Self.url(area)
  }

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

func loadSalt(_ path: String) -> String {
  if let existing = try? String(contentsOfFile: path, encoding: .utf8), !existing.isEmpty {
    return existing.trimmingCharacters(in: .whitespacesAndNewlines)
  }
  let salt = (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
  try! salt.write(toFile: path, atomically: true, encoding: .utf8)
  return salt
}

let options = Options(CommandLine.arguments)
if options.probe {
  MainActor.assumeIsolated {
    let logger = Logger(output: FileHandle.standardOutput, hasher: Hasher(salt: "probe"))
    let focus = logger.readFocus()
    print("trusted=\(logger.trusted) app=\(focus.app) titleKnown=\(focus.titleKnown) hasHost=\(!focus.host.isEmpty)")
    print("counters=\(logger.counts())")
  }
  exit(0)
}
let salt = loadSalt(options.saltPath)
if !FileManager.default.fileExists(atPath: options.out) {
  FileManager.default.createFile(atPath: options.out, contents: nil)
}
let handle = FileHandle(forWritingAtPath: options.out)!
handle.seekToEndOfFile()
MainActor.assumeIsolated {
  let logger = Logger(output: handle, hasher: Hasher(salt: salt))
  logger.start(hours: options.hours)
  withExtendedLifetime(logger) { RunLoop.main.run() }
}
