import AppKit
import ScreencapCore
import Sparkle

/// Keeps Screencap up to date with Sparkle, from the appcast attached to the latest GitHub release.
///
/// Checks run once a day with no question asked first. By default an update downloads in the background and installs
/// the next time the screen locks or the display sleeps, when Screencap captures nothing anyway, then the app relaunches;
/// "Restart to Update" in the panel and the menu installs it right away, and quitting installs it too. With automatic
/// installs off, a found update waits as a line in the panel until it is opened, unless Sparkle judges the moment right
/// to show its window at once (just after launch, or after the Mac has been idle).
///
/// The feed and every archive carry an EdDSA signature made with the key whose public half is `SUPublicEDKey` in
/// Info.plist; Sparkle checks both before it unpacks anything, then checks that the new app has the same code signature.
@MainActor
@Observable
final class Updates: NSObject {
  enum State: Equatable {
    case current
    /// Found by a scheduled check while automatic installs are off; Sparkle's window shows it when asked.
    case available(version: String)
    /// Downloaded and verified; installs at the next screen lock, on quit, or on "Restart to Update".
    case ready(version: String)
  }

  private(set) var state = State.current
  private(set) var canCheck = false
  @ObservationIgnored private var controller: SPUStandardUpdaterController!
  @ObservationIgnored private var installNow: (() -> Void)?
  @ObservationIgnored private var observers: [NSObjectProtocol] = []
  @ObservationIgnored private var canCheckObservation: NSKeyValueObservation?

  /// The defaults key the old process leaves for the relaunched one: the time it relaunched for an update.
  static let relaunchKey = "updates.relaunchedAt"

  override init() {
    super.init()
    controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: self)
  }

  var updater: SPUUpdater { controller.updater }

  /// Starts the schedule. The menu-bar app calls this; the command-line modes of the same binary never do.
  func start() {
    controller.startUpdater()
    canCheck = updater.canCheckForUpdates
    canCheckObservation = updater.observe(\.canCheckForUpdates, options: [.new]) { [weak self] updater, _ in
      MainActor.assumeIsolated { self?.canCheck = updater.canCheckForUpdates }
    }
    let workspace = NSWorkspace.shared.notificationCenter
    observers.append(
      workspace.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.installIfAway() }
      })
    observers.append(
      DistributedNotificationCenter.default().addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) {
        [weak self] _ in
        MainActor.assumeIsolated { self?.installIfAway() }
      })
  }

  var automaticallyChecks: Bool {
    get { access(keyPath: \.automaticallyChecks); return updater.automaticallyChecksForUpdates }
    set { withMutation(keyPath: \.automaticallyChecks) { updater.automaticallyChecksForUpdates = newValue } }
  }

  var automaticallyInstalls: Bool {
    get { access(keyPath: \.automaticallyInstalls); return updater.automaticallyDownloadsUpdates }
    set { withMutation(keyPath: \.automaticallyInstalls) { updater.automaticallyDownloadsUpdates = newValue } }
  }

  var lastCheck: Date? {
    access(keyPath: \.state)
    return updater.lastUpdateCheckDate
  }

  static var currentVersion: String {
    let info = Bundle.main.infoDictionary
    return "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
  }

  /// "Check for Updates…": installs a downloaded update at once, otherwise opens Sparkle's window on the check.
  func checkOrInstall() {
    if case .ready = state, let installNow {
      installNow()
    } else {
      NSApp.activate()
      controller.checkForUpdates(nil)
    }
  }

  /// The title of the menu item and the panel line for the current state, or nil while there is nothing new.
  var actionTitle: String? {
    switch state {
    case .current: nil
    case .available(let version): "Update to \(version)…"
    case .ready(let version): "Restart to Update to \(version)"
    }
  }

  private func installIfAway() {
    guard case .ready = state, let installNow else { return }
    Log.ui.info("installing the downloaded update while the screen is locked or asleep")
    installNow()
  }

  private static var isScreenLocked: Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
    return session["CGSSessionScreenIsLocked"] as? Bool ?? false
  }
}

extension Updates: SPUUpdaterDelegate {
  func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock: @escaping () -> Void) -> Bool {
    Log.ui.info("update \(item.displayVersionString, privacy: .public) downloaded; it installs at the next screen lock or on quit")
    installNow = immediateInstallationBlock
    state = .ready(version: item.displayVersionString)
    if Self.isScreenLocked { installIfAway() }
    return true
  }

  func updaterWillRelaunchApplication(_ updater: SPUUpdater) {
    UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.relaunchKey)
  }

  func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
    Log.ui.error("update stopped: \(String(describing: error), privacy: .public)")
  }
}

// Sparkle calls its user driver's delegate on the main thread.
extension Updates: @preconcurrency SPUStandardUserDriverDelegate {
  var supportsGentleScheduledUpdateReminders: Bool { true }

  /// Sparkle's window comes forward on its own only when Sparkle finds the moment right; otherwise the panel shows a line.
  func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool {
    immediateFocus
  }

  func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
    if handleShowingUpdate {
      // A menu-bar app is never the active app on its own, so Sparkle's window would open behind others (or in
      // another Stage Manager stage).
      NSApp.activate()
    } else {
      self.state = .available(version: update.displayVersionString)
    }
  }

  func standardUserDriverDidReceiveUserAttention(forUpdate update: SUAppcastItem) {
    if case .available = state { state = .current }
  }

  func standardUserDriverWillFinishUpdateSession() {
    if case .available = state { state = .current }
  }
}
