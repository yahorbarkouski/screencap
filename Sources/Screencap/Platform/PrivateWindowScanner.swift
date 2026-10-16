import AppKit
import ApplicationServices
import ScreencapCore

/// Finds private browser windows before each capture by reading every browser window's accessibility title and
/// identifier (`PrivateWindows`). A window found private stays private while it exists: a browser cannot change a
/// window's mode, and Chrome's title loses its marker while a dialog has focus. A browser that does not answer is
/// treated as showing private windows only, so a failure leaves windows out of the frame instead of capturing them.
@MainActor
final class PrivateWindowScanner {
  struct Scan: Sendable {
    /// Frames of private windows by process, in global coordinates with a top-left origin, as `SCWindow.frame`.
    var privateFrames: [pid_t: [CGRect]] = [:]
    /// Browsers whose windows could not be read; all their windows are left out.
    var unreadable: Set<pid_t> = []
    var isFocusedWindowPrivate = false

    var hasPrivateWindows: Bool { !privateFrames.isEmpty || !unreadable.isEmpty }

    /// Whether `window` (a window server window of process `pid`) is one of the private ones.
    func contains(pid: pid_t, frame: CGRect) -> Bool {
      if unreadable.contains(pid) { return true }
      return privateFrames[pid]?.contains { abs($0.minX - frame.minX) <= 2 && abs($0.minY - frame.minY) <= 2
        && abs($0.width - frame.width) <= 2 && abs($0.height - frame.height) <= 2 } ?? false
    }
  }

  /// Private windows seen so far that are still open.
  private var known: [AXUIElement] = []

  /// Without Accessibility nothing can be read, and only Firefox's window titles show the private mode
  /// (`ScreenCapturer` checks those).
  func scan() -> Scan {
    var scan = Scan()
    guard AXIsProcessTrusted() else { return scan }
    let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
    var stillOpen: [AXUIElement] = []
    for app in NSWorkspace.shared.runningApplications {
      guard let bundleID = app.bundleIdentifier, PrivateWindows.browsers[bundleID] != nil, !app.isTerminated else { continue }
      let pid = app.processIdentifier
      let element = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(element, 0.25)
      var value: CFTypeRef?
      let error = AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &value)
      if error == .noValue { continue }
      guard error == .success, let windows = value as? [AXUIElement] else {
        scan.unreadable.insert(pid)
        if pid == frontmost { scan.isFocusedWindowPrivate = true }
        continue
      }
      var privateHere: [AXUIElement] = []
      for window in windows {
        let isPrivate = known.contains { CFEqual($0, window) }
          || PrivateWindows.isPrivate(
            bundleID: bundleID, title: Self.string(window, kAXTitleAttribute), identifier: Self.string(window, kAXIdentifierAttribute))
        guard isPrivate else { continue }
        privateHere.append(window)
        if let frame = Self.frame(of: window) {
          scan.privateFrames[pid, default: []].append(frame)
        } else {
          scan.unreadable.insert(pid)
        }
      }
      stillOpen += privateHere
      if pid == frontmost, !privateHere.isEmpty, let focused = Self.focusedWindow(of: element) {
        scan.isFocusedWindowPrivate = privateHere.contains { CFEqual($0, focused) }
      }
    }
    known = stillOpen
    return scan
  }

  static func focusedWindow(of app: AXUIElement) -> AXUIElement? {
    for attribute in [kAXFocusedWindowAttribute, kAXMainWindowAttribute] {
      var value: CFTypeRef?
      if AXUIElementCopyAttributeValue(app, attribute as CFString, &value) == .success, let value,
        CFGetTypeID(value) == AXUIElementGetTypeID()
      {
        return (value as! AXUIElement)
      }
    }
    return nil
  }

  static func string(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return value as? String
  }

  static func frame(of window: AXUIElement) -> CGRect? {
    var position: CFTypeRef?
    var size: CFTypeRef?
    guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &position) == .success,
      AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &size) == .success,
      let position, let size, CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
    else { return nil }
    var point = CGPoint.zero
    var extent = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
    return CGRect(origin: point, size: extent)
  }
}
