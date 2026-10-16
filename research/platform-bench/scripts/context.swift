import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Foreground-context cost benchmark. Usage: context
// Times each context read path, checks permissions without prompting, and (if Accessibility is
// granted) counts AXObserver notifications for the frontmost app over 20 s.

func time(_ name: String, n: Int = 200, _ body: () -> Void) {
  body()
  let u0 = Usage.of()!
  var w: [Double] = []
  for _ in 0..<n {
    let t = DispatchTime.now().uptimeNanoseconds
    body()
    w.append(Double(DispatchTime.now().uptimeNanoseconds - t) / 1000)
  }
  let d = Usage.of()! - u0
  print("\(name.padding(toLength: 52, withPad: " ", startingAt: 0)) median \(fmt(Stats(values: w).median, 1)) us  p90 \(fmt(Stats(values: w).p90, 1)) us  cpu/call \(fmt(Double(d.cpuNs) / Double(n) / 1000, 1)) us")
}

func axString(_ el: AXUIElement, _ attr: String) -> String? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
  if let s = v as? String { return s }
  if let u = v as? URL { return u.absoluteString }
  return nil
}

func axElement(_ el: AXUIElement, _ attr: String) -> AXUIElement? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success, let v else { return nil }
  return (v as! AXUIElement)
}

/// Depth-first search for the first AXWebArea under an element (bounded).
func findWebArea(_ el: AXUIElement, depth: Int = 0, budget: inout Int) -> AXUIElement? {
  budget -= 1
  if budget < 0 || depth > 12 { return nil }
  if axString(el, kAXRoleAttribute) == "AXWebArea" { return el }
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &v) == .success,
    let kids = v as? [AXUIElement]
  else { return nil }
  for k in kids { if let w = findWebArea(k, depth: depth + 1, budget: &budget) { return w } }
  return nil
}

func automationStatus(_ bundleID: String) -> OSStatus {
  var addr = AEAddressDesc()
  let data = bundleID.data(using: .utf8)!
  _ = data.withUnsafeBytes { AECreateDesc(typeApplicationBundleID, $0.baseAddress, data.count, &addr) }
  defer { AEDisposeDesc(&addr) }
  return AEDeterminePermissionToAutomateTarget(&addr, typeWildCard, typeWildCard, false)
}

@main struct ContextBench {
  static func main() {
    let front = NSWorkspace.shared.frontmostApplication!
    print("frontmost: bundle=\(front.bundleIdentifier ?? "?")")
    print("AXIsProcessTrusted=\(AXIsProcessTrusted())  CGPreflightScreenCaptureAccess=\(CGPreflightScreenCaptureAccess())")
    for b in ["com.google.Chrome", "company.thebrowser.dia", "company.thebrowser.Browser", "com.apple.Safari", "com.spotify.client", "com.apple.Music"] {
      let s = automationStatus(b)
      let meaning = [0: "granted", -1743: "denied", -1744: "would prompt", -600: "not running"][Int(s)] ?? "other"
      print("  Apple Events permission to \(b): \(s) (\(meaning))")
    }

    time("NSWorkspace.frontmostApplication") { _ = NSWorkspace.shared.frontmostApplication?.bundleIdentifier }
    time("CGWindowListCopyWindowInfo(onScreenOnly)", n: 100) {
      _ = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    }
    time("CGEventSource.secondsSinceLastEventType") {
      _ = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    }

    if AXIsProcessTrusted() {
      let app = AXUIElementCreateApplication(front.processIdentifier)
      AXUIElementSetMessagingTimeout(app, 0.25)
      time("AX focused window title (frontmost app)") {
        if let w = axElement(app, kAXFocusedWindowAttribute) { _ = axString(w, kAXTitleAttribute) }
      }
      if let w = axElement(app, kAXFocusedWindowAttribute) {
        print("  focused window has title: \(axString(w, kAXTitleAttribute) != nil), AXDocument: \(axString(w, kAXDocumentAttribute) != nil)")
        var budget = 3000
        let t = DispatchTime.now().uptimeNanoseconds
        let web = findWebArea(w, budget: &budget)
        print("  AXWebArea search: found=\(web != nil) visited=\(3000 - budget) in \(fmt(ms(DispatchTime.now().uptimeNanoseconds - t))) ms; AXURL present=\(web.flatMap { axString($0, "AXURL") } != nil)")
        if let web { time("AX AXURL on cached web area", n: 100) { _ = axString(web, "AXURL") } }
      }

      // AXObserver notification rate for the frontmost app, 20 s.
      var counts: [String: Int] = [:]
      let box = Unmanaged.passRetained(NSMutableDictionary())
      var observer: AXObserver?
      let cb: AXObserverCallback = { _, _, note, refcon in
        let d = Unmanaged<NSMutableDictionary>.fromOpaque(refcon!).takeUnretainedValue()
        let k = note as String
        d[k] = ((d[k] as? Int) ?? 0) + 1
      }
      if AXObserverCreate(front.processIdentifier, cb, &observer) == .success, let observer {
        for n in [kAXFocusedWindowChangedNotification, kAXTitleChangedNotification, kAXMainWindowChangedNotification, kAXFocusedUIElementChangedNotification] {
          AXObserverAddNotification(observer, app, n as CFString, box.toOpaque())
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        let u0 = Usage.of()!
        let end = Date().addingTimeInterval(20)
        while Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.5)) }
        let d = Usage.of()! - u0
        for (k, v) in box.takeUnretainedValue() { counts[k as! String] = v as? Int }
        print("AXObserver 20 s on frontmost app: \(counts)  process cpu \(fmt(ms(d.cpuNs))) ms")
      }
    } else {
      print("Accessibility not granted to this process: AX title/URL paths not measured")
    }

    // NSWorkspace activation notifications over 20 s (no polling).
    var activations = 0
    let obs = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in activations += 1 }
    let u0 = Usage.of()!
    let end = Date().addingTimeInterval(20)
    while Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.5)) }
    let d = Usage.of()! - u0
    NSWorkspace.shared.notificationCenter.removeObserver(obs)
    print("NSWorkspace didActivateApplication over 20 s: \(activations) events, process cpu \(fmt(ms(d.cpuNs))) ms")

    // MediaRemote (private) reachability: macOS 15.4+ restricts it to entitled clients.
    if let h = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW),
      let sym = dlsym(h, "MRMediaRemoteGetNowPlayingInfo")
    {
      typealias Fn = @convention(c) (DispatchQueue, @escaping @convention(block) (CFDictionary?) -> Void) -> Void
      let f = unsafeBitCast(sym, to: Fn.self)
      let sem = DispatchSemaphore(value: 0)
      var keys = -1
      f(DispatchQueue.global()) { dict in keys = (dict as? [String: Any])?.count ?? 0; sem.signal() }
      _ = sem.wait(timeout: .now() + 2)
      print("MRMediaRemoteGetNowPlayingInfo returned \(keys) keys (0 = blocked or nothing playing)")
    }
  }
}
