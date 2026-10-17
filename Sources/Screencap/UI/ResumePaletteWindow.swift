import AppKit
import Carbon
import ScreencapCore
import SwiftUI

/// The window the resume palette lives in: centred on the screen the pointer is on, borderless, and taking the
/// keys without making Screencap the active app, so what you were working in stays in front while you choose.
@MainActor
final class ResumePaletteController: NSObject, NSWindowDelegate {
  let model: ResumeModel
  private var panel: NSPanel!
  private var hotKey: EventHotKeyRef?
  private var outsideClick: Any?
  private var keyMonitor: Any?
  private let toast = ResumeToast()
  /// The hotkey this controller answers to, told apart from the menu-bar panel's by its id.
  static let hotKeyID: UInt32 = 2

  init(database: AppDatabase, location: StoreLocation, corrections: Corrections?) {
    model = ResumeModel(database: database, location: location, corrections: corrections)
    super.init()
    build()
    installHotKeyHandler()
    ResumeShortcut.shared.pause = { [weak self] paused in self?.pause(paused) }
  }

  private func build() {
    let view = ResumePalette(model: model, resume: { [weak self] in self?.resumeChosen() })
    let hosting = NSHostingView(rootView: view)
    hosting.translatesAutoresizingMaskIntoConstraints = false
    // Liquid Glass rather than a blur: the palette sits over whatever you were working in, and glass keeps that
    // readable underneath instead of flattening it into grey.
    let glass = NSGlassEffectView.rounded(ResumePalette.cornerRadius, content: hosting)
    panel = KeyPanel(
      contentRect: NSRect(origin: .zero, size: ResumePalette.size),
      styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: false)
    panel.delegate = self
    panel.isFloatingPanel = true
    panel.level = .popUpMenu
    panel.backgroundColor = .clear
    panel.isOpaque = false
    // The glass is clipped to its rounded shape, so the window's shadow follows the rounding and gives the palette
    // its depth on a light page as well as a dark one.
    panel.hasShadow = true
    panel.contentView = glass
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
  }

  /// The keys the palette lives by, taken before the search field sees them.
  ///
  /// A text field consumes the arrows to move its insertion point, so a SwiftUI `onKeyPress` above it never runs
  /// while the field has the keys — which is every moment the palette is open. A monitor on the panel's own key
  /// events is the only place they can be caught.
  private func startKeyMonitor() {
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      guard let self, self.panel.isVisible, event.window === self.panel else { return event }
      let command = event.modifierFlags.contains(.command)
      switch Int(event.keyCode) {
      case kVK_UpArrow:
        self.model.move(-1)
        return nil
      case kVK_DownArrow:
        self.model.move(1)
        return nil
      case kVK_Tab:
        self.model.togglePeek()
        return nil
      case kVK_Return, kVK_ANSI_KeypadEnter:
        self.resumeChosen()
        return nil
      case kVK_Escape:
        // Out of the places first, then out of the search, then away.
        if self.model.peeking != nil {
          self.model.leavePeek()
        } else if !self.model.query.isEmpty {
          self.model.query = ""
        } else {
          self.hide()
        }
        return nil
      case kVK_Delete where command:
        self.model.dropChosenPlace()
        return nil
      case kVK_ANSI_Z where command && self.model.lastDropped != nil:
        self.model.undoDrop()
        return nil
      case kVK_ANSI_K where command:
        Task { await self.model.splitChosen() }
        return nil
      default:
        return event
      }
    }
  }

  private func stopKeyMonitor() {
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    keyMonitor = nil
  }

  /// Puts the palette away, then brings the chosen thread forward, and says so only when something could not be
  /// brought back: when everything came, the windows in front are the answer, and a note over them is noise.
  ///
  /// In that order: driving a browser through Apple Events takes a tenth of a second a page, and a palette left on
  /// screen meanwhile looks frozen. The row is taken before hiding, because hiding starts the palette over.
  func resumeChosen() {
    guard let row = model.chosen else { return }
    hide()
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let result = self.model.resume(row)
      if !result.trouble.isEmpty { self.toast.show(thread: result.thread, leftOff: result.leftOff, trouble: result.trouble) }
      if !result.unasked.isEmpty { Task { _ = await AutomationAccess.request(result.unasked) } }
    }
  }

  var isShown: Bool { panel.isVisible }

  /// Called each time the palette opens, after it has shown what is stored, so the app can work out each thread's
  /// places again and the palette can take the result while it is still open.
  var onOpen: (() -> Void)?

  /// Takes newly worked-out places while the palette is open, keeping the chosen thread chosen.
  func refreshIfShown() {
    guard panel.isVisible else { return }
    model.refresh()
  }

  /// Where the palette is on screen, in global points, for `probe-palette --shot`.
  var frame: NSRect { panel.frame }

  /// The palette's real list, laid out in a window off the screen, for measuring how it scrolls without taking
  /// the screen or the pointer from the person (`probe-palette`). Returns the scroll view the list lives in.
  func showOffscreenForProbe() -> NSScrollView? {
    model.reset()
    model.reload()
    panel.setFrame(NSRect(origin: NSPoint(x: -20_000, y: -20_000), size: ResumePalette.size), display: true)
    panel.orderFrontRegardless()
    func find(_ view: NSView) -> NSScrollView? {
      if let scroll = view as? NSScrollView { return scroll }
      for child in view.subviews { if let found = find(child) { return found } }
      return nil
    }
    return panel.contentView.flatMap(find)
  }

  func toggle() { panel.isVisible ? hide() : show() }

  func show() {
    model.reset()
    model.reload()
    model.requestFocus()
    model.findSplits()
    onOpen?()
    let size = ResumePalette.size
    let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
    let frame = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1_440, height: 900)
    // A third of the way down reads better than the exact middle: the eye lands above centre.
    panel.setFrame(
      NSRect(
        x: frame.midX - size.width / 2, y: frame.midY - size.height / 2 + frame.height * 0.12,
        width: size.width, height: size.height),
      display: true)
    panel.orderFrontRegardless()
    // The shadow is worked out from what the window has drawn, so it is asked for once the glass is on screen.
    panel.invalidateShadow()
    panel.makeKey()
    startKeyMonitor()
    outsideClick = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
      MainActor.assumeIsolated { self?.hide() }
    }
  }

  func hide() {
    panel.orderOut(nil)
    stopKeyMonitor()
    if let outsideClick { NSEvent.removeMonitor(outsideClick) }
    outsideClick = nil
    model.reset()
  }

  /// Choosing a thread brings its app forward, which takes the keys from the panel; the panel goes away with them.
  func windowDidResignKey(_ notification: Notification) {
    if panel.isVisible { hide() }
  }

  /// What opens the palette, as its keycaps write it: "⌥space".
  static var shortcutText: String { ResumeShortcut.shared.current.keycap }
  /// The same shortcut as a sentence names it: "⌥Space".
  static var shortcutName: String { ResumeShortcut.shared.current.name }

  private var settings = ResumeSettings()

  /// Takes the shortcut Settings names when Resume is on and gives it back when it is off. Called at launch and
  /// after every change in Settings; taking the same shortcut again is harmless.
  ///
  /// Another app may already hold the shortcut (ChatGPT, Alfred and Raycast all offer ⌥Space), and registering
  /// then fails rather than stealing it. The palette falls back to ⌥Space, then ⌥⌘R, and Settings says why.
  func apply(_ settings: ResumeSettings) {
    self.settings = settings
    release()
    guard settings.isEnabled else {
      if panel.isVisible { hide() }
      return
    }
    let shortcut = ResumeShortcut.shared
    if let wanted = settings.shortcut, wanted != .optionSpace {
      if register(wanted) {
        shortcut.took(wanted)
      } else {
        let fallback = registerDefault()
        shortcut.took(fallback, problem: "Another app holds \(wanted.name), so the palette opens with \(fallback.name).")
      }
      return
    }
    let got = registerDefault()
    shortcut.took(got, problem: got == .optionSpace ? nil : "Another app holds ⌥Space, so the palette opens with \(got.name).")
  }

  /// Lets go of the shortcut while Settings records a new one, so pressing the old one is recorded rather than
  /// opening the palette, and takes it again after.
  func pause(_ paused: Bool) {
    paused ? release() : apply(settings)
  }

  private func release() {
    if let hotKey { UnregisterEventHotKey(hotKey) }
    hotKey = nil
  }

  private func registerDefault() -> Shortcut {
    if register(.optionSpace) { return .optionSpace }
    register(.optionCommandR)
    return .optionCommandR
  }

  @discardableResult
  private func register(_ shortcut: Shortcut) -> Bool {
    let id = EventHotKeyID(signature: OSType(0x5343_4150), id: Self.hotKeyID)
    var ref: EventHotKeyRef?
    let status = RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers, id, GetApplicationEventTarget(), 0, &ref)
    guard status == noErr, let ref else {
      Log.ui.info("\(shortcut.name, privacy: .public) is taken (\(status, privacy: .public))")
      return false
    }
    hotKey = ref
    Log.ui.info("the resume palette answers to \(shortcut.name, privacy: .public)")
    return true
  }

  /// Carbon hot keys need no Accessibility permission, and the handler answers only to this controller's id, so
  /// the menu-bar panel's ⌥⌘S keeps working.
  private func installHotKeyHandler() {
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let selfPointer = Unmanaged.passUnretained(self).toOpaque()
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, event, userData in
        guard let userData, let event else { return noErr }
        var pressed = EventHotKeyID()
        GetEventParameter(
          event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
          MemoryLayout<EventHotKeyID>.size, nil, &pressed)
        guard pressed.id == ResumePaletteController.hotKeyID else { return noErr }
        let controller = Unmanaged<ResumePaletteController>.fromOpaque(userData).takeUnretainedValue()
        MainActor.assumeIsolated { controller.toggle() }
        return noErr
      }, 1, &spec, selfPointer, nil)
  }
}

/// What opens the palette right now, for every place that names it. Observed, so Settings and the palette follow a
/// new shortcut without being opened again.
@MainActor
@Observable
final class ResumeShortcut {
  static let shared = ResumeShortcut()
  private(set) var current = Shortcut.optionSpace
  /// Why the palette answers to something other than what Settings asked for.
  private(set) var problem: String?
  /// Lets go of the shortcut while a new one is recorded; set by the palette's controller.
  @ObservationIgnored var pause: (Bool) -> Void = { _ in }

  func took(_ shortcut: Shortcut, problem: String? = nil) {
    current = shortcut
    self.problem = problem
  }
}

extension Shortcut {
  static let optionSpace = Shortcut(keyCode: UInt32(kVK_Space), modifiers: Shortcut.option, key: "Space")
  static let optionCommandR = Shortcut(
    keyCode: UInt32(kVK_ANSI_R), modifiers: Shortcut.option | Shortcut.command, key: "R")

  /// The shortcut a key press makes, or nil when it would make a poor one: a key without ⌘, ⌥ or ⌃ would be taken
  /// from typing in every app, so only the function keys may go without.
  init?(event: NSEvent) {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    let code = Int(event.keyCode)
    let function = Self.functionKeys[code]
    guard function != nil || !flags.isDisjoint(with: [.command, .option, .control]) else { return nil }
    var modifiers: UInt32 = 0
    if flags.contains(.control) { modifiers |= Shortcut.control }
    if flags.contains(.option) { modifiers |= Shortcut.option }
    if flags.contains(.shift) { modifiers |= Shortcut.shift }
    if flags.contains(.command) { modifiers |= Shortcut.command }
    // The key as it is printed, which the layout decides: ⌥ and ⇧ would otherwise turn R into ® or a capital.
    guard let key = function ?? Self.namedKeys[code] ?? event.characters(byApplyingModifiers: [])?.uppercased(),
      !key.isEmpty, !key.contains(where: \.isWhitespace)
    else { return nil }
    self.init(keyCode: UInt32(event.keyCode), modifiers: modifiers, key: key)
  }

  private static let namedKeys: [Int: String] = [
    kVK_Space: "Space", kVK_Return: "↩", kVK_Tab: "⇥", kVK_Delete: "⌫", kVK_ForwardDelete: "⌦",
    kVK_LeftArrow: "←", kVK_RightArrow: "→", kVK_UpArrow: "↑", kVK_DownArrow: "↓", kVK_Home: "↖", kVK_End: "↘",
    kVK_PageUp: "⇞", kVK_PageDown: "⇟",
  ]

  private static let functionKeys: [Int: String] = [
    kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5", kVK_F6: "F6", kVK_F7: "F7", kVK_F8: "F8",
    kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12",
  ]
}
