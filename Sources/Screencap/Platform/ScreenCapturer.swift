import AppKit
import CoreGraphics
@preconcurrency import ScreenCaptureKit
import ScreencapCore

/// One display's frame from a capture tick.
struct DisplayFrame: @unchecked Sendable {
  let displayID: UInt32
  let image: CGImage
  let isFocused: Bool
}

/// ScreenCaptureKit screenshots at 1x. Capture costs about 40 ms whatever the output size, so the app captures at
/// 1x and decides afterwards whether the frame is new. Fetching shareable content costs 18 ms, so it is cached until
/// an app launches or quits, the frontmost app or site changes, the displays change, or the exclusions change, and
/// fetched fresh whenever a private window is open, so one opened in the background is in the list it is cut from.
/// Excluded apps and private browser windows (`PrivateWindowScanner`) are left out of every display's frame.
actor ScreenCapturer {
  private var content: SCShareableContent?
  private var excludedBundleIDs: Set<String>
  private let ownBundleID = Bundle.main.bundleIdentifier ?? "com.screencaping.app"

  init(excludedBundleIDs: Set<String>) {
    self.excludedBundleIDs = excludedBundleIDs
  }

  func invalidate() {
    content = nil
  }

  func setExcluded(_ bundleIDs: Set<String>) {
    excludedBundleIDs = bundleIDs
    content = nil
  }

  /// The focused display always; the others only when `allDisplays` (timer ticks).
  func capture(focusedDisplayID: CGDirectDisplayID?, allDisplays: Bool, privateScan: PrivateWindowScanner.Scan) async throws -> [DisplayFrame] {
    if privateScan.hasPrivateWindows { content = nil }
    let content = try await shareableContent()
    let focusedID = focusedDisplayID ?? content.displays.first?.displayID ?? CGMainDisplayID()
    let excluded = Set(excludedBundleIDs.map { $0.lowercased() } + [ownBundleID.lowercased()])
    let excludedApps = content.applications.filter { excluded.contains($0.bundleIdentifier.lowercased()) }
    let privateWindows = content.windows.filter { window in
      guard let app = window.owningApplication else { return false }
      return privateScan.contains(pid: app.processID, frame: window.frame)
        || PrivateWindows.isPrivate(bundleID: app.bundleIdentifier, title: nil, windowName: window.title)
    }
    var frames: [DisplayFrame] = []
    for display in content.displays where allDisplays || display.displayID == focusedID {
      let configuration = SCStreamConfiguration()
      configuration.width = display.width
      configuration.height = display.height
      configuration.showsCursor = false
      configuration.captureDynamicRange = .SDR
      // Excluding whole apps also covers their windows that open later; private windows can only go one by one.
      let filter =
        privateWindows.isEmpty
        ? SCContentFilter(display: display, excludingApplications: excludedApps, exceptingWindows: [])
        : SCContentFilter(
          display: display,
          excludingWindows: content.windows.filter { excluded.contains($0.owningApplication?.bundleIdentifier.lowercased() ?? "") } + privateWindows)
      let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
      frames.append(DisplayFrame(displayID: display.displayID, image: image, isFocused: display.displayID == focusedID))
    }
    return frames
  }

  private func shareableContent() async throws -> SCShareableContent {
    if let content { return content }
    let fresh = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    content = fresh
    return fresh
  }
}

enum FocusedDisplay {
  /// The display holding the centre of the frontmost app's frontmost normal window, and where that window sits in it.
  static func focusedWindow(forProcess pid: pid_t) -> (displayID: CGDirectDisplayID, window: ScreenRect?)? {
    guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]]
    else { return nil }
    for window in windows {
      guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
        (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
        ((window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) >= 0.1,
        let boundsDict = window[kCGWindowBounds as String] as? NSDictionary,
        let bounds = CGRect(dictionaryRepresentation: boundsDict), bounds.width >= 10, bounds.height >= 10
      else { continue }
      var displayID: CGDirectDisplayID = 0
      var count: UInt32 = 0
      let centre = CGPoint(x: bounds.midX, y: bounds.midY)
      if CGGetDisplaysWithPoint(centre, 1, &displayID, &count) == .success, count > 0 {
        return (displayID, ScreenRect(bounds, in: CGDisplayBounds(displayID)))
      }
      return nil
    }
    return nil
  }
}
