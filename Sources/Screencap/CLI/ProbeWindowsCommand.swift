import AppKit
@preconcurrency import ScreenCaptureKit
import ScreencapCore

/// `Screencap probe-windows --out FILE`: what the private-window scanner sees, for checking it against real browsers.
/// One line per window of every running browser: its app, accessibility identifier, whether its title carries a
/// private marker, its verdict, and whether a window server window matched its frame. Titles are left out, so the file
/// shows nothing of what was on screen. It ends with the pixel check: magenta pixels in the frame the app would take
/// and in a control frame with nothing cut. Run it from the signed app (`open -n -g Screencap.app --args probe-windows
/// --out FILE`), which holds the Accessibility and Screen Recording permissions.
@MainActor
enum ProbeWindowsCommand {
  static func run(out: URL) async throws {
    let scan = PrivateWindowScanner().scan()
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    var lines = ["accessibility \(AXIsProcessTrusted()), focused private \(scan.isFocusedWindowPrivate), unreadable \(scan.unreadable.count)"]
    for app in NSWorkspace.shared.runningApplications {
      guard let bundleID = app.bundleIdentifier, PrivateWindows.browsers[bundleID] != nil else { continue }
      let element = AXUIElementCreateApplication(app.processIdentifier)
      var value: CFTypeRef?
      let error = AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &value)
      let windows = (value as? [AXUIElement]) ?? []
      lines.append("\(bundleID): \(windows.count) accessibility windows, error \(error.rawValue)")
      let serverWindows = content.windows.filter { $0.owningApplication?.processID == app.processIdentifier && $0.windowLayer == 0 }
      for window in windows {
        let title = PrivateWindowScanner.string(window, kAXTitleAttribute)
        let identifier = PrivateWindowScanner.string(window, kAXIdentifierAttribute) ?? "-"
        let frame = PrivateWindowScanner.frame(of: window)
        let isPrivate = PrivateWindows.isPrivate(bundleID: bundleID, title: title, identifier: identifier)
        let matched = frame.map { frame in serverWindows.contains { Scan.close($0.frame, frame) } } ?? false
        let marker = PrivateWindows.isPrivate(bundleID: bundleID, title: title)
        lines.append("  identifier \(identifier.prefix(24)) | title marker \(marker) | private \(isPrivate) | frame \(frame.map { "\(Int($0.width))x\(Int($0.height))" } ?? "none") | matched \(matched)")
      }
      lines.append("  window server: \(serverWindows.count) layer-0 windows, left out by the scan: \(serverWindows.filter { scan.contains(pid: app.processIdentifier, frame: $0.frame) }.count)")
    }
    // The pixel check: a page of solid magenta (#FF00FF) in a private window must leave no magenta in the frame the app
    // takes. The control frame cuts nothing, to show whether the window was visible at all.
    let excluded = SettingsStore().current.allExcludedBundleIDs
    let cut = try await ScreenCapturer(excludedBundleIDs: excluded).capture(focusedDisplayID: nil, allDisplays: true, privateScan: scan)
    let control = try await ScreenCapturer(excludedBundleIDs: excluded).capture(
      focusedDisplayID: nil, allDisplays: true, privateScan: PrivateWindowScanner.Scan())
    lines.append("magenta pixels, frame as the app takes it: \(cut.map { Self.magenta($0.image) }), control without the cut: \(control.map { Self.magenta($0.image) })")
    try lines.joined(separator: "\n").appending("\n").write(to: out, atomically: true, encoding: .utf8)
  }

  /// Pixels of pure magenta, sampling every fourth pixel of every fourth row.
  static func magenta(_ image: CGImage) -> Int {
    let width = image.width, height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(
      data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return -1 }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    var count = 0
    for y in stride(from: 0, to: height, by: 4) {
      for x in stride(from: 0, to: width, by: 4) {
        let i = (y * width + x) * 4
        if pixels[i] > 235, pixels[i + 1] < 30, pixels[i + 2] > 235 { count += 1 }
      }
    }
    return count
  }

  private enum Scan {
    static func close(_ a: CGRect, _ b: CGRect) -> Bool {
      abs(a.minX - b.minX) <= 2 && abs(a.minY - b.minY) <= 2 && abs(a.width - b.width) <= 2 && abs(a.height - b.height) <= 2
    }
  }
}
