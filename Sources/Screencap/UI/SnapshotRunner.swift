import AppKit
import ScreencapCore
import SwiftUI

/// Renders each surface into a PNG from an offscreen window that is never shown or activated, so the UI can be
/// checked on a store (for example the replayed gold days) without taking the screen from the person using it.
@MainActor
enum SnapshotRunner {
  static func run(model: AppModel, to directory: URL) async {
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let size = CGSize(width: 1180, height: 780)
    let busiest = model.timeline.threads.compactMap(\.threadID)

    model.section = .day
    await renderWindow(model: model, size: size, to: directory.appendingPathComponent("window.png"))
    await render(MainView(model: model), size: size, to: directory.appendingPathComponent("day.png"))
    await render(DayView(model: model, startY: 900), size: size, to: directory.appendingPathComponent("day-scrolled.png"))
    await render(MainView(model: model), size: size, to: directory.appendingPathComponent("day-dark.png"), dark: true)
    await render(DayView(model: model), size: CGSize(width: 1180, height: 2600), to: directory.appendingPathComponent("day-full.png"))
    model.section = .timeline
    await render(MainView(model: model), size: size, to: directory.appendingPathComponent("timeline.png"))
    await render(TimelinePage(model: model), size: CGSize(width: 1180, height: 2600), to: directory.appendingPathComponent("timeline-full.png"))
    model.section = .day

    if busiest.count > 1, let activity = model.timeline.items.compactMap({ item -> Activity? in
      guard case .session(let s) = item, s.threadID == busiest[1] else { return nil }
      return s.activities.max { $0.captureCount < $1.captureCount }
    }).first {
      model.select(activity)
      await render(MainView(model: model), size: size, to: directory.appendingPathComponent("day-inspector.png"))
      model.selectedActivityID = nil
    }

    await render(DayPicker(model: model) { _ in }, size: CGSize(width: 268, height: 330), to: directory.appendingPathComponent("day-picker.png"))
    await render(SettingsView(model: model) {}, size: CGSize(width: 520, height: 760), to: directory.appendingPathComponent("settings.png"), dark: true)
    for step in OnboardingView.Step.allCases {
      await render(
        OnboardingView(step: step, saveKey: { _ in }, finish: {}), size: CGSize(width: 560, height: 520),
        to: directory.appendingPathComponent("onboarding-\(step.rawValue).png"), dark: true)
    }

    model.section = .threads
    model.refresh()
    // The model's cover picks, when a key is there to ask with.
    for _ in 0..<120 where model.isLoadingCovers { try? await Task.sleep(for: .milliseconds(500)) }
    await render(MainView(model: model), size: size, to: directory.appendingPathComponent("threads.png"))
    if let top = model.tiles.first?.thread.id {
      model.openThreadID = top
      model.refresh()
      await render(MainView(model: model), size: size, to: directory.appendingPathComponent("thread-detail.png"))
      model.openThreadID = nil
    }

    model.section = .day
    model.query = "kyoto"
    try? model.runSearch()
    await render(MainView(model: model), size: size, to: directory.appendingPathComponent("search.png"))
    model.query = ""

    model.todayOverride = model.day
    model.refresh()
    let search = PanelSearch(model: model)
    func panel(scrubbing fraction: CGFloat? = nil) -> some View {
      PanelView(
        model: model, search: search, openMain: {}, openActivity: { _, _ in }, openThread: { _ in }, openResult: { _ in }, close: {},
        pinnedFraction: fraction)
    }
    await render(panel(), size: PanelView.size, to: directory.appendingPathComponent("panel.png"), dark: true)
    await render(panel(), size: PanelView.size, to: directory.appendingPathComponent("panel-light.png"))
    await render(panel(scrubbing: 0.62), size: PanelView.size, to: directory.appendingPathComponent("panel-scrub.png"), dark: true)
    search.isOpen = true
    await render(panel(), size: PanelView.size, to: directory.appendingPathComponent("panel-search-open.png"), dark: true)
    search.query = ProcessInfo.processInfo.environment["SCREENCAP_SNAPSHOT_QUERY"] ?? "kyoto"
    search.selection = 1
    await render(panel(), size: PanelView.size, to: directory.appendingPathComponent("panel-search.png"), dark: true)
    await render(panel(), size: PanelView.size, to: directory.appendingPathComponent("panel-search-light.png"))
    search.reset()

    // A screenshot expanded over the main window: the busiest activity of the day, at its middle screenshot.
    if let activity = model.timeline.items.flatMap({ item -> [Activity] in
      if case .session(let s) = item { return s.activities }
      return []
    }).max(by: { $0.captureCount < $1.captureCount }) {
      model.section = .day
      model.select(activity)
      model.expand()
      await render(MainView(model: model), size: size, to: directory.appendingPathComponent("lightbox.png"), dark: true)
      model.selectedActivityID = nil
    }
  }

  /// The main window's title bar and toolbar, drawn without ever being shown. An offscreen titled window leaves its
  /// content blank, so the other snapshots show the pages; the real window is checked with `scripts/window-shot.swift`.
  static func renderWindow(model: AppModel, size: CGSize, to url: URL) async {
    let controller = MainWindowController(model: model)
    guard let window = controller.window, let frame = window.contentView?.superview else { return }
    window.appearance = NSAppearance(named: .aqua)
    window.setContentSize(size)
    frame.layoutSubtreeIfNeeded()
    try? await Task.sleep(for: .seconds(2.5))
    frame.layoutSubtreeIfNeeded()
    guard let rep = frame.bitmapImageRepForCachingDisplay(in: frame.bounds) else { return }
    frame.cacheDisplay(in: frame.bounds, to: rep)
    try? rep.representation(using: .png, properties: [:])?.write(to: url)
    print("snapshot \(url.lastPathComponent)")
  }

  static func render<V: View>(_ view: V, size: CGSize, to url: URL, dark: Bool = false) async {
    let hosting = NSHostingView(
      rootView: view.frame(width: size.width, height: size.height, alignment: .top).background(Color(nsColor: .windowBackgroundColor)))
    hosting.frame = CGRect(origin: .zero, size: size)
    let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    window.contentView = hosting
    hosting.layoutSubtreeIfNeeded()
    // Let SwiftUI lay out and the screenshots decode before drawing.
    try? await Task.sleep(for: .seconds(2.5))
    hosting.layoutSubtreeIfNeeded()
    guard let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { return }
    hosting.cacheDisplay(in: hosting.bounds, to: rep)
    try? rep.representation(using: .png, properties: [:])?.write(to: url)
    print("snapshot \(url.lastPathComponent)")
  }
}
