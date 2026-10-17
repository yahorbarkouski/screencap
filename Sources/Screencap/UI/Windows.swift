import AppKit
import Carbon
import ScreencapCore
import SwiftUI

/// A borderless panel that takes the keys (for the search field) without making Screencap the active app, the way
/// Spotlight does: what you were working in stays in front.
final class KeyPanel: NSPanel {
  override var canBecomeKey: Bool { true }
}

/// The status item and its panel: a borderless, non-activating panel on the popover material, anchored under the
/// status item, built once and shown in one frame.
@MainActor
final class PanelController: NSObject, NSWindowDelegate {
  let model: AppModel
  let search: PanelSearch
  private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  private var panel: NSPanel!
  private var outsideClick: Any?
  private var hotKey: EventHotKeyRef?
  var openMain: () -> Void = {}
  var openSettings: () -> Void = {}

  init(model: AppModel) {
    self.model = model
    search = PanelSearch(model: model)
    super.init()
    if let button = statusItem.button {
      button.image = MenuBarGlyph.image()
      button.target = self
      button.action = #selector(statusItemClicked(_:))
      button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }
    buildPanel()
    registerHotKey()
  }

  private func buildPanel() {
    let view = PanelView(
      model: model,
      search: search,
      openMain: { [weak self] in
        self?.hide()
        self?.openMain()
      },
      openActivity: { [weak self] activity, capture in
        guard let self else { return }
        self.hide()
        self.openMain()
        self.model.section = .day
        self.model.select(activity, capture: capture)
      },
      openThread: { [weak self] id in
        guard let self else { return }
        self.hide()
        self.openMain()
        self.model.section = .threads
        self.model.openThreadID = id
        self.model.refresh()
      },
      openResult: { [weak self] result in
        guard let self else { return }
        self.hide()
        self.openMain()
        self.model.open(result: result)
      },
      close: { [weak self] in self?.hide() })
    let hosting = NSHostingView(rootView: view)
    let effect = NSVisualEffectView()
    effect.material = .popover
    effect.state = .active
    effect.blendingMode = .behindWindow
    effect.wantsLayer = true
    effect.layer?.cornerRadius = 14
    effect.layer?.masksToBounds = true
    hosting.translatesAutoresizingMaskIntoConstraints = false
    effect.addSubview(hosting)
    NSLayoutConstraint.activate([
      hosting.leadingAnchor.constraint(equalTo: effect.leadingAnchor), hosting.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
      hosting.topAnchor.constraint(equalTo: effect.topAnchor), hosting.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
    ])
    panel = KeyPanel(
      contentRect: NSRect(origin: .zero, size: PanelView.size), styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: false)
    panel.delegate = self
    panel.isFloatingPanel = true
    panel.level = .popUpMenu
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = true
    panel.contentView = effect
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
  }

  @objc private func statusItemClicked(_ sender: NSStatusBarButton) {
    if NSApp.currentEvent?.type == .rightMouseUp {
      showMenu()
    } else {
      toggle()
    }
  }

  var isShown: Bool { panel.isVisible }

  func toggle() {
    panel.isVisible ? hide() : show()
  }

  func show() {
    model.go(toDay: Date())
    guard let button = statusItem.button, let window = button.window else { return }
    let size = PanelView.size
    let anchor = window.convertToScreen(button.frame)
    let screen = window.screen?.visibleFrame ?? NSScreen.main!.visibleFrame
    let x = min(max(anchor.midX - size.width / 2, screen.minX + 8), screen.maxX - size.width - 8)
    panel.setFrame(NSRect(x: x, y: anchor.minY - size.height - 6, width: size.width, height: size.height), display: true)
    panel.orderFrontRegardless()
    panel.makeKey()
    search.requestFocus()
    outsideClick = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
      MainActor.assumeIsolated { self?.hide() }
    }
  }

  func hide() {
    panel.orderOut(nil)
    // A cursor the panel set under the pointer, such as the strip's pointing hand, would outlast the panel.
    if panel.frame.contains(NSEvent.mouseLocation) { NSCursor.arrow.set() }
    search.reset()
    if let outsideClick { NSEvent.removeMonitor(outsideClick) }
    outsideClick = nil
  }

  /// Switching to another app or space puts the panel away, as a menu would be.
  func windowDidResignKey(_ notification: Notification) {
    if panel.isVisible { hide() }
  }

  private func showMenu() {
    let menu = NSMenu()
    let engine = model.captureEngine
    if engine?.isPaused == true {
      menu.addItem(withTitle: "Resume capture", action: #selector(resume), keyEquivalent: "").target = self
    } else {
      for (title, seconds) in [("Pause for 30 minutes", 1800), ("Pause for 1 hour", 3600), ("Pause until tomorrow", -1)] {
        let item = menu.addItem(withTitle: title, action: #selector(pause(_:)), keyEquivalent: "")
        item.target = self
        item.tag = seconds
      }
    }
    menu.addItem(withTitle: "Capture now", action: #selector(captureNow), keyEquivalent: "").target = self
    menu.addItem(.separator())
    menu.addItem(withTitle: "Open Screencap", action: #selector(openMainFromMenu), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Settings…", action: #selector(openSettingsFromMenu), keyEquivalent: ",").target = self
    if let updates = model.updates {
      menu.addItem(withTitle: updates.actionTitle ?? "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "").target = self
    }
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit Screencap", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    statusItem.menu = menu
    statusItem.button?.performClick(nil)
    statusItem.menu = nil
  }

  @objc private func pause(_ sender: NSMenuItem) {
    if sender.tag > 0 {
      model.captureEngine?.pause(for: TimeInterval(sender.tag))
    } else {
      let tomorrow = Calendar.current.startOfDay(for: Date().addingTimeInterval(86_400)).addingTimeInterval(4 * 3600)
      model.captureEngine?.pause(for: tomorrow.timeIntervalSinceNow)
    }
  }

  @objc private func resume() { model.captureEngine?.resume() }
  @objc private func captureNow() { model.captureEngine?.capture(.manual) }
  @objc private func openMainFromMenu() { openMain() }
  @objc private func openSettingsFromMenu() { openSettings() }
  @objc private func checkForUpdates() { model.updates?.checkOrInstall() }

  /// ⌥⌘S anywhere toggles the panel; ⌥⌘R, registered by `ResumePaletteController`, opens the resume palette.
  /// Carbon hot keys need no Accessibility permission.
  private func registerHotKey() {
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let selfPointer = Unmanaged.passUnretained(self).toOpaque()
    InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
      guard let userData, let event else { return noErr }
      // Every installed handler sees every hot key, so each answers only to its own.
      var pressed = EventHotKeyID()
      GetEventParameter(
        event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
        MemoryLayout<EventHotKeyID>.size, nil, &pressed)
      guard pressed.id == 1 else { return noErr }
      let controller = Unmanaged<PanelController>.fromOpaque(userData).takeUnretainedValue()
      MainActor.assumeIsolated { controller.toggle() }
      return noErr
    }, 1, &spec, selfPointer, nil)
    let id = EventHotKeyID(signature: OSType(0x5343_4150), id: 1)
    RegisterEventHotKey(UInt32(kVK_ANSI_S), UInt32(cmdKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKey)
  }
}

/// The main window: transparent title bar over the app's own top bar, flat content.
@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate {
  /// Called when the window closes, so the owner can let the whole view tree and its loaded screenshots go.
  var onClose: () -> Void = {}
  private weak var model: AppModel?
  private var keyMonitor: Any?

  convenience init(model: AppModel) {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.title = "Screencap"
    window.minSize = NSSize(width: 980, height: 560)
    let hosting = NSHostingView(rootView: MainView(model: model))
    // The window keeps its own size; by default the hosting view would shrink it to the content's minimum.
    hosting.sizingOptions = []
    // The view's toolbar (day, search, Day/Threads) becomes the window's, in one row with the window buttons.
    hosting.sceneBridgingOptions = [.toolbars]
    window.toolbarStyle = .unified
    window.contentView = hosting
    window.isReleasedWhenClosed = false
    let restored = window.setFrameUsingName("ScreencapMain")
    if !restored || window.frame.width < window.minSize.width || window.frame.height < window.minSize.height {
      window.setContentSize(NSSize(width: 1180, height: 780))
      window.center()
    }
    window.setFrameAutosaveName("ScreencapMain")
    self.init(window: window)
    self.model = model
    window.delegate = self
  }

  /// Space expands the selected activity's screenshot (unless a text field has the keys); while one is expanded,
  /// ← and → step through the activity's screenshots and Esc or Space close it. Keys open it at once, without motion.
  private func watchKeys() {
    guard keyMonitor == nil else { return }
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      let keyCode = event.keyCode
      let plain = event.modifierFlags.intersection([.command, .option, .control, .shift]).isEmpty
      let number = event.window?.windowNumber
      let handled = MainActor.assumeIsolated { self?.handle(keyCode: keyCode, plain: plain, windowNumber: number) ?? false }
      return handled ? nil : event
    }
  }

  /// Whether the key was taken (see `watchKeys`).
  private func handle(keyCode: UInt16, plain: Bool, windowNumber: Int?) -> Bool {
    guard plain, let model, let window, windowNumber == window.windowNumber else { return false }
    if model.expandedCaptureID != nil {
      switch keyCode {
      case 123: model.step(-1)
      case 124: model.step(1)
      case 49, 53: model.collapse()
      default: return false
      }
      return true
    }
    if keyCode == 49, model.selectedActivityID != nil, !(window.firstResponder is NSText) {
      model.expand()
      return true
    }
    return false
  }

  func show() {
    watchKeys()
    let switching = NSApp.activationPolicy() != .regular
    NSApp.setActivationPolicy(.regular)
    showWindow(nil)
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate()
    guard switching else { return }
    // Becoming a regular app can drop the activation just asked for, and Stage Manager then files the window in its
    // side strip; once the switch has settled, ask again so the window comes to the front.
    DispatchQueue.main.async { [weak self] in
      NSApp.activate()
      self?.window?.makeKeyAndOrderFront(nil)
    }
  }

  func windowWillClose(_ notification: Notification) {
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    keyMonitor = nil
    model?.expandedCaptureID = nil
    NSApp.setActivationPolicy(.accessory)
    onClose()
  }
}
