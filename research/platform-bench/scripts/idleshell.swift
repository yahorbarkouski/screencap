import AppKit
import ApplicationServices

// Idle cost of an event-driven menu-bar shell: NSStatusItem, NSWorkspace observers, an AXObserver on
// the frontmost app (re-attached on activation, title changes debounced), a 60 s capture timer with
// tolerance (no capture is taken). Runs for <seconds>, then prints CPU, wakeups and footprint.
// Usage: idleshell <seconds>

final class Shell: NSObject, NSApplicationDelegate {
  var item: NSStatusItem!
  var observer: AXObserver?
  var axEvents = 0
  var activations = 0
  var debounced = 0
  var debounce: DispatchWorkItem?
  var ticks = 0
  let start = Usage.of()!
  var startWakeups: (UInt64, UInt64) = (0, 0)

  func applicationDidFinishLaunching(_ n: Notification) {
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    item.button?.title = "◎"
    startWakeups = wakeups()
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(activated(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
    attach(NSWorkspace.shared.frontmostApplication)
    let t = Timer(timeInterval: 60, repeats: true) { [weak self] _ in self?.ticks += 1 }
    t.tolerance = 6
    RunLoop.main.add(t, forMode: .common)
    let secs = Double(CommandLine.arguments[1])!
    DispatchQueue.main.asyncAfter(deadline: .now() + secs) { self.report(secs) }
  }

  func wakeups() -> (UInt64, UInt64) {
    var info = rusage_info_v6()
    _ = withUnsafeMutablePointer(to: &info) { p in
      p.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(getpid(), RUSAGE_INFO_V6, $0) }
    }
    return (info.ri_pkg_idle_wkups, info.ri_interrupt_wkups)
  }

  @objc func activated(_ n: Notification) {
    activations += 1
    attach(n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
  }

  func attach(_ app: NSRunningApplication?) {
    if let o = observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(o), .defaultMode) }
    observer = nil
    guard let app, AXIsProcessTrusted() else { return }
    var o: AXObserver?
    let cb: AXObserverCallback = { _, _, _, refcon in
      let s = Unmanaged<Shell>.fromOpaque(refcon!).takeUnretainedValue()
      s.axEvents += 1
      s.debounce?.cancel()
      let w = DispatchWorkItem { s.debounced += 1 }
      s.debounce = w
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: w)
    }
    guard AXObserverCreate(app.processIdentifier, cb, &o) == .success, let o else { return }
    let el = AXUIElementCreateApplication(app.processIdentifier)
    let me = Unmanaged.passUnretained(self).toOpaque()
    for name in [kAXFocusedWindowChangedNotification, kAXTitleChangedNotification] {
      AXObserverAddNotification(o, el, name as CFString, me)
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(o), .defaultMode)
    observer = o
  }

  func report(_ secs: Double) {
    let d = Usage.of()! - start
    let w = wakeups()
    print("idle shell over \(Int(secs)) s: cpu \(fmt(ms(d.cpuNs))) ms (\(fmt(ms(d.cpuNs) / secs / 10, 3))% of one core), energy \(fmt(Double(d.energyNj) / 1e6, 1)) mJ, pkg-idle wakeups \(w.0 - startWakeups.0), interrupt wakeups \(w.1 - startWakeups.1), footprint \(d.physFootprint / 1_048_576) MB; AX events \(axEvents) -> \(debounced) debounced context checks, activations \(activations)")
    NSApp.terminate(nil)
  }
}

@main struct Main {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let d = Shell()
    app.delegate = d
    app.run()
  }
}
