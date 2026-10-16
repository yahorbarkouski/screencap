import AppKit
import ApplicationServices
import ScreencapCore
import SwiftUI

/// The menu-bar app.
@MainActor
enum AppMain {
  static var delegate: AppDelegate?

  static func run(location: StoreLocation, viewOnly: Bool, snapshotDirectory: URL? = nil) {
    let app = NSApplication.shared
    let delegate = AppDelegate(location: location, viewOnly: viewOnly || snapshotDirectory != nil)
    delegate.snapshotDirectory = snapshotDirectory
    self.delegate = delegate
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let location: StoreLocation
  /// Shows a store without capturing into it or asking models (for checking the UI on a replayed store).
  let viewOnly: Bool
  /// Render every surface into PNGs here and quit, without showing a window.
  var snapshotDirectory: URL?
  private var model: AppModel!
  private var capture: CaptureEngine!
  private var understanding: UnderstandingDriver!
  private var panel: PanelController!
  private var mainWindow: MainWindowController?
  private var settingsWindow: NSWindow?
  private var onboardingWindow: NSWindow?
  private var refreshTimer: Timer?
  private var backup: BackupDriver?
  private var metricsTimer: Timer?
  private var updates: Updates?
  /// Relaunched by an update: the activation that comes with the relaunch shows no window.
  private var relaunchedForUpdate = false
  private let launchedAt = Date()
  private let usageAtLaunch = ResourceUsage.now()

  init(location: StoreLocation, viewOnly: Bool) {
    self.location = location
    self.viewOnly = viewOnly
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    PlaceIcons.removeSharedCache()
    do {
      let database = try location.openDatabase()
      Task.detached(priority: .background) {
        do { try database.scrubStoredSecrets() } catch { Log.capture.error("secret scrub failed: \(String(describing: error), privacy: .public)") }
      }
      let settings = SettingsStore()
      model = AppModel(database: database, location: location, settings: settings)
      applyAppearance()
      capture = CaptureEngine(location: location, database: database, settings: settings, ocrHelper: Helpers.ocr)
      understanding = UnderstandingDriver.make(database: database, location: location, settings: settings)
      model.captureEngine = capture
      model.understanding = understanding
      model.corrections = Corrections(database: database, location: location, engine: understanding.engine)
      capture.onEvidence = { [weak self] in
        self?.understanding.poke()
        self?.refreshIfVisible()
      }
      understanding.onChange = { [weak self] in self?.refreshIfVisible() }
      panel = PanelController(model: model)
      panel.openMain = { [weak self] in self?.showMain() }
      panel.openSettings = { [weak self] in self?.showSettings() }
      if !viewOnly {
        if let relaunchedAt = UserDefaults.standard.object(forKey: Updates.relaunchKey) as? Double {
          UserDefaults.standard.removeObject(forKey: Updates.relaunchKey)
          relaunchedForUpdate = Date().timeIntervalSince1970 - relaunchedAt < 120
          Log.ui.info("relaunched after an update to \(Updates.currentVersion, privacy: .public)")
        }
        // A bare binary from .build has no bundle to update, and Sparkle would say so in an alert.
        if Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil {
          let updates = Updates()
          updates.start()
          self.updates = updates
          model.updates = updates
        }
        capture.start()
        understanding.start()
        backup = BackupDriver(database: database, location: location, settings: settings)
        model.backup = backup
        metricsTimer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in
          MainActor.assumeIsolated {
            guard let self else { return }
            Task { self.writeMetrics(liveOCRSeconds: await self.capture.liveOCRCPUSeconds()) }
          }
        }
      }
      buildMenu()
      model.refresh()
      refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.refreshIfVisible() }
      }
      if viewOnly {
        if let last = try database.focusedCaptures(before: .greatestFiniteMagnitude, count: 1).last { model.go(toDay: last.date) }
        if let snapshotDirectory {
          Task {
            if ProcessInfo.processInfo.environment["SCREENCAP_README"] != nil {
              await ReadmeShots.run(model: model, to: snapshotDirectory)
            } else {
              await SnapshotRunner.run(model: model, to: snapshotDirectory)
            }
            NSApp.terminate(nil)
          }
        } else {
          showMain()
        }
      } else {
        if try database.meta("firstLaunch") == nil {
          try database.setMeta("firstLaunch", ISO8601DateFormatter().string(from: Date()))
        }
        // The first launch walks through what Screencap needs; a lost screen recording grant brings that step back.
        if try database.meta("onboarded") == nil {
          showOnboarding(from: .welcome)
        } else if !CGPreflightScreenCaptureAccess() {
          showOnboarding(from: .screen)
        }
      }
    } catch {
      Log.ui.error("launch failed: \(String(describing: error), privacy: .public)")
      let alert = NSAlert()
      alert.messageText = "Screencap could not open its data"
      alert.informativeText = error.localizedDescription
      alert.runModal()
      NSApp.terminate(nil)
    }
  }

  /// Reloads what the panel and main window show, while one of them is on screen; showing either reloads first.
  private func refreshIfVisible() {
    guard panel.isShown || mainWindow?.window?.isVisible == true else { return }
    model.refresh()
  }

  func applicationWillTerminate(_ notification: Notification) {
    capture?.stop()
    // The running OCR helper's CPU is not known here without waiting on its actor; this last line leaves it out.
    if !viewOnly { writeMetrics(liveOCRSeconds: 0) }
  }

  /// Appends the app's own cost since launch to `metrics.log` in the store: CPU of the app and of its OCR helper
  /// (finished runs plus `liveOCRSeconds` of the running one), and memory footprint. Local only; it is how the
  /// performance budget is checked on a real day.
  private func writeMetrics(liveOCRSeconds: Double) {
    let elapsed = Date().timeIntervalSince(launchedAt)
    guard elapsed > 0 else { return }
    var usage = ResourceUsage.now() - usageAtLaunch
    usage.childCPU += liveOCRSeconds
    let line = String(
      format: "%@ elapsed=%.0fs app_cpu=%.2f%% ocr_cpu=%.2f%% total_cpu=%.2f%% footprint=%.1fMB resident=%.1fMB captures=%d\n",
      ISO8601DateFormatter().string(from: Date()), elapsed, usage.selfCPU / elapsed * 100, usage.childCPU / elapsed * 100,
      (usage.selfCPU + usage.childCPU) / elapsed * 100, ResourceUsage.footprintMB(), ResourceUsage.residentMB(),
      capture?.capturesThisRun ?? 0)
    let url = location.root.appendingPathComponent("metrics.log")
    if let handle = try? FileHandle(forWritingTo: url) {
      handle.seekToEndOfFile()
      handle.write(Data(line.utf8))
      try? handle.close()
    } else {
      try? line.write(to: url, atomically: true, encoding: .utf8)
    }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showMain()
    return true
  }

  /// A menu-bar app gets no reopen message when it is opened again (Finder, Spotlight, `open`); it is only brought to
  /// the front. Brought to the front with none of its windows showing, it shows the main window. The panel never
  /// activates the app, and every window the app opens itself is visible before it activates.
  func applicationDidBecomeActive(_ notification: Notification) {
    guard snapshotDirectory == nil else { return }
    if relaunchedForUpdate, Date().timeIntervalSince(launchedAt) < 30 {
      relaunchedForUpdate = false
      return
    }
    let showing = [mainWindow?.window, settingsWindow, onboardingWindow].contains { $0?.isVisible == true }
    // After the activation that brought the app forward has finished.
    if !showing { DispatchQueue.main.async { self.showMain() } }
  }

  func showMain() {
    // Until onboarding is finished, every way to the main window (the Dock icon, opening the app again, the panel,
    // ⌘F) brings onboarding forward instead.
    if !viewOnly, (try? model.database.meta("onboarded")) == nil {
      showOnboarding(from: .welcome)
      return
    }
    Log.ui.info("showing the main window")
    if mainWindow == nil {
      // A closed window is released with its views and screenshots (about 180 MB once browsed), and made again here.
      mainWindow = MainWindowController(model: model)
      mainWindow?.onClose = { [weak self] in
        // After AppKit has finished closing the window.
        Task { @MainActor in
          self?.mainWindow = nil
          ImageLoader.shared.removeAll()
          malloc_zone_pressure_relief(nil, 0)
        }
      }
    }
    model.refresh()
    mainWindow?.show()
  }

  /// Dark by default; light, or the system's choice, when picked in Settings. Every window and the panel follow it.
  func applyAppearance() {
    switch model.settings.current.appearance {
    case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
    case .light: NSApp.appearance = NSAppearance(named: .aqua)
    case .system: NSApp.appearance = nil
    }
  }

  @objc func showSettings() {
    if settingsWindow == nil {
      let view = SettingsView(model: model) { [weak self] in
        guard let self else { return }
        self.capture.applySettings()
        self.applyAppearance()
        Task { await self.understanding.engine.setTextOnly(self.model.settings.current.textOnlyMode) }
        self.understanding.poke()
      }
      // The form scrolls, so it has no height of its own to report: the window gets its size here and keeps it.
      let controller = NSHostingController(rootView: view)
      controller.sizingOptions = []
      let window = NSWindow(contentViewController: controller)
      window.title = "Screencap Settings"
      window.styleMask = [.titled, .closable, .resizable]
      window.setContentSize(NSSize(width: 520, height: 720))
      window.contentMinSize = NSSize(width: 520, height: 420)
      window.isReleasedWhenClosed = false
      settingsWindow = window
    }
    NSApp.setActivationPolicy(.regular)
    settingsWindow?.center()
    settingsWindow?.makeKeyAndOrderFront(nil)
    NSApp.activate()
  }

  @objc func checkForUpdates() {
    updates?.checkOrInstall()
  }

  @objc func focusSearch() {
    showMain()
    NotificationCenter.default.post(name: .focusSearch, object: nil)
  }

  func showOnboarding(from step: OnboardingView.Step) {
    if onboardingWindow == nil {
      let view = OnboardingView(
        step: step,
        saveKey: { [weak self] key in
          _ = Keychain.write(Data(key.utf8), for: .openRouterKey)
          self?.understanding.poke()
        },
        finish: { [weak self] in
          guard let self else { return }
          try? self.model.database.setMeta("onboarded", ISO8601DateFormatter().string(from: Date()))
          self.onboardingWindow?.close()
          // The first screenshot right away (Screencap's own windows are left out of it), so today opens on it.
          self.capture.capture(.manual)
          self.showMain()
        })
      let window = NSWindow(contentViewController: NSHostingController(rootView: view))
      window.styleMask = [.titled, .closable, .fullSizeContentView]
      window.titlebarAppearsTransparent = true
      window.titleVisibility = .hidden
      window.isReleasedWhenClosed = false
      NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.onboardingWindow = nil
          if self?.mainWindow?.window?.isVisible != true { NSApp.setActivationPolicy(.accessory) }
        }
      }
      onboardingWindow = window
    }
    NSApp.setActivationPolicy(.regular)
    onboardingWindow?.center()
    onboardingWindow?.makeKeyAndOrderFront(nil)
    NSApp.activate()
  }

  private func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "About Screencap", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    if updates != nil {
      appMenu.addItem(withTitle: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "").target = self
    }
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Settings…", action: #selector(showSettings), keyEquivalent: ",").target = self
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide Screencap", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "Quit Screencap", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    main.addItem(appItem)

    let editItem = NSMenuItem()
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Find", action: #selector(focusSearch), keyEquivalent: "f").target = self
    editItem.submenu = edit
    main.addItem(editItem)

    let windowItem = NSMenuItem()
    let window = NSMenu(title: "Window")
    window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowItem.submenu = window
    main.addItem(windowItem)
    NSApp.mainMenu = main
    NSApp.windowsMenu = window
  }
}
