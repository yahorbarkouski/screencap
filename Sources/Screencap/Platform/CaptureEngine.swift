import AppKit
import Carbon
import ScreencapCore

/// Runs capture: decides when to take a capture, takes it, records it, and keeps OCR flowing.
///
/// When to capture is `DwellScheduler`'s call, from a once-a-second read of the input counters and the view changes
/// `ContextMonitor` reports; wake and unlock capture at once.
@MainActor
final class CaptureEngine {
  let database: AppDatabase
  let location: StoreLocation
  let settings: SettingsStore
  let monitor = ContextMonitor()
  private let capturer: ScreenCapturer
  private let recorder: CaptureRecorder
  private let ocr: OCRRunner

  /// Called after each recorded focused capture and after each OCR batch, so understanding can advance.
  var onEvidence: (() -> Void)?

  private(set) var pausedUntil: Date?
  private(set) var lastCaptureAt: Date?
  private(set) var capturesThisRun = 0
  private var currentBlock: MarkerKind?
  private let privateWindows = PrivateWindowScanner()
  private var isAsleep = false
  private var isLocked = false
  /// Asleep, locked by notification, or locked as the window server reports it now (a lock notification can be
  /// missed, and a wake comes before the unlock).
  private var screenUnavailable: Bool { isAsleep || isLocked || Self.sessionIsLocked() }
  private var pollTimer: Timer?
  private var ocrTimer: Timer?
  private var scheduler: DwellScheduler
  private var lastCounts: InputCounts?
  private var isCapturing = false
  private var isRunningOCR = false
  /// Set by a marker that ends the activity (sleep, lock), so the next frame is kept even if it repeats the last one.
  private var startsAfterBreak = false
  private var screenObserver: NSObjectProtocol?

  init(location: StoreLocation, database: AppDatabase, settings: SettingsStore, ocrHelper: URL) {
    self.location = location
    self.database = database
    self.settings = settings
    var rules = DwellScheduler.Rules()
    rules.fallback = settings.current.captureInterval
    scheduler = DwellScheduler(rules: rules)
    capturer = ScreenCapturer(excludedBundleIDs: settings.current.allExcludedBundleIDs)
    recorder = CaptureRecorder(database: database, location: location)
    ocr = OCRRunner(database: database, location: location, helperURL: ocrHelper)
  }

  var isPaused: Bool { pausedUntil.map { $0 > Date() } ?? false }

  func start() {
    mark(.launched)
    monitor.onContextChange = { [weak self] _ in self?.contextChanged() }
    monitor.onViewChange = { [weak self] _ in self?.scheduler.viewChanged(at: Date().timeIntervalSince1970) }
    screenObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        Task { await self.capturer.invalidate() }
      }
    }
    monitor.onMarker = { [weak self] kind in self?.lifecycle(kind) }
    monitor.onApplicationsChanged = { [weak self] in
      guard let self else { return }
      Task { await self.capturer.invalidate() }
    }
    monitor.start()
    lastCounts = InputCounts.read()
    pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.poll() }
    }
    pollTimer?.tolerance = 0.2
    ocrTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.runOCR() }
    }
    ocrTimer?.tolerance = 15
    poll()
  }

  /// Reads the input counters and takes the capture the scheduler says is due.
  private func poll() {
    let now = Date().timeIntervalSince1970
    let counts = InputCounts.read()
    if let lastCounts { scheduler.observe(counts.since(lastCounts), at: now) }
    lastCounts = counts
    guard !screenUnavailable, let trigger = scheduler.due(at: now) else { return }
    capture(trigger)
  }

  /// CPU seconds of the OCR helper while it is still running; a finished helper counts in the process's children.
  func liveOCRCPUSeconds() async -> Double {
    await ocr.liveHelperCPUSeconds()
  }

  func stopOCRHelper() async {
    await ocr.stopHelper()
  }

  func stop() {
    if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
    mark(.quit)
    pollTimer?.invalidate()
    ocrTimer?.invalidate()
  }

  func pause(for duration: TimeInterval?) {
    pausedUntil = duration.map { Date().addingTimeInterval($0) } ?? .distantFuture
    mark(.paused)
  }

  func resume() {
    pausedUntil = nil
    mark(.resumed)
    capture(.manual)
  }

  func applySettings() {
    Task { await capturer.setExcluded(settings.current.allExcludedBundleIDs) }
  }

  func capture(_ trigger: CaptureTrigger) {
    guard !isCapturing else { return }
    var state = CaptureGate.State()
    state.isPaused = isPaused
    state.isScreenUnavailable = screenUnavailable
    state.secondsSinceInput = CGEventSource.secondsSinceLastEventType(
      .combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    state.isSecureInputOn = IsSecureEventInputEnabled()
    state.hasScreenRecordingPermission = CGPreflightScreenCaptureAccess()
    state.context = monitor.readContext()
    state.excludedBundleIDs = settings.current.allExcludedBundleIDs
    let privateScan = privateWindows.scan()
    state.isFocusedWindowPrivate = privateScan.isFocusedWindowPrivate
    if trigger == .manual { state.secondsSinceInput = 0 }
    switch CaptureGate.evaluate(state) {
    case .blocked(let kind):
      if currentBlock != kind { mark(kind) }
      currentBlock = kind
      scheduler.blocked(at: Date().timeIntervalSince1970)
      return
    case .capture:
      break
    }
    let resumedAfterBlock = currentBlock != nil || startsAfterBreak
    currentBlock = nil
    startsAfterBreak = false
    isCapturing = true
    let context = state.context
    let focusedWindow = NSWorkspace.shared.frontmostApplication.flatMap { FocusedDisplay.focusedWindow(forProcess: $0.processIdentifier) }
    let focused = focusedWindow?.displayID
    let at = Date()
    lastCaptureAt = at
    let isAnchor = scheduler.captured(trigger, place: context.placeKey, at: at.timeIntervalSince1970)
    Task {
      defer { Task { @MainActor in self.isCapturing = false } }
      do {
        if resumedAfterBlock { await recorder.forgetKeptFrames() }
        let frames = try await capturer.capture(focusedDisplayID: focused, allDisplays: trigger == .timer, privateScan: privateScan)
        for frame in frames {
          try await recorder.record(
            CapturedFrame(
              image: frame.image, displayID: frame.displayID, isFocusedDisplay: frame.isFocused, context: context,
              trigger: trigger, at: at.timeIntervalSince1970, window: frame.isFocused ? focusedWindow?.window : nil,
              isAnchor: isAnchor))
        }
        await MainActor.run {
          self.capturesThisRun += 1
          self.onEvidence?()
        }
      } catch {
        Log.capture.error("capture failed: \(error.localizedDescription, privacy: .public)")
        await capturer.invalidate()
      }
    }
  }

  private func contextChanged() {
    // A new app or site may have opened windows (a private browser window among them) that the cached list lacks.
    Task { await capturer.invalidate() }
  }

  private func lifecycle(_ kind: MarkerKind) {
    switch kind {
    case .sleep: isAsleep = true
    case .wake: isAsleep = false
    case .screenLocked: isLocked = true
    case .screenUnlocked: isLocked = false
    default: break
    }
    if kind.breaksActivity { startsAfterBreak = true }
    mark(kind)
    if !screenUnavailable, kind == .wake || kind == .screenUnlocked { capture(.contextSwitch) }
  }

  static func sessionIsLocked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
    return (session["CGSSessionScreenIsLocked"] as? Bool) == true || (session["kCGSSessionOnConsoleKey"] as? Bool) == false
  }

  private func mark(_ kind: MarkerKind) {
    do { try database.insert(Marker(at: Date().timeIntervalSince1970, kind: kind)) } catch {
      Log.capture.error("marker write failed: \(error.localizedDescription, privacy: .public)")
    }
  }

  func runOCR() {
    guard !isRunningOCR, !ProcessInfo.processInfo.isLowPowerModeEnabled else { return }
    isRunningOCR = true
    Task {
      defer { Task { @MainActor in self.isRunningOCR = false } }
      do {
        let done = try await ocr.runBatch()
        if !done.isEmpty { await MainActor.run { self.onEvidence?() } }
      } catch {
        Log.capture.error("OCR batch failed: \(error.localizedDescription, privacy: .public)")
      }
    }
  }
}

/// Window-server event counters since login. Reading them needs no permission and costs about 0.1 µs
/// (experiments/tools/smart-capture/counter_bench.swift).
struct InputCounts {
  var keys: UInt32
  var clicks: UInt32
  var scrolls: UInt32

  static func read() -> InputCounts {
    func count(_ types: [CGEventType]) -> UInt32 {
      types.reduce(0) { $0 &+ CGEventSource.counterForEventType(.combinedSessionState, eventType: $1) }
    }
    return InputCounts(
      keys: count([.keyDown]), clicks: count([.leftMouseDown, .rightMouseDown, .otherMouseDown]),
      scrolls: count([.scrollWheel]))
  }

  func since(_ earlier: InputCounts) -> DwellScheduler.Input {
    DwellScheduler.Input(
      keys: Int(keys &- earlier.keys), clicks: Int(clicks &- earlier.clicks), scrolls: Int(scrolls &- earlier.scrolls))
  }
}
