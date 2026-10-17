import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import ScreencapCore
import SwiftUI

/// The frames of the README's GIFs, on the made-up day, each drawn offscreen with a pointer on top and nothing
/// ever shown on screen. `scripts/readme-shots.py` lays them on the backdrop and makes `window.gif` and `popup.gif`.
///
/// The main window (`window`): the Day page with its strip scrubbed, then Timeline, then Threads, where the pointer
/// opens the biggest thread, and back to Day. The menu-bar panel (`popup`): the pointer opens the panel, runs along the
/// strip (each moment's screenshot fills the stage), rests on two threads, clicks a moment (the main window opens on
/// it), then ⌥⌘S and a typed search, and a click outside puts the panel away. Each frame is the app in the state the
/// pointer would leave it in: a pinned strip (`pinnedStripFraction`, `pinnedFraction`), the hovered thread, the page,
/// the typed query.
@MainActor
enum ReadmeFrames {
  // MARK: The main window

  static let windowFPS = 12.0
  static let mainSize = CGSize(width: 1180, height: 740)
  static let titleBar: CGFloat = 52
  /// The Day page's strip, from `DayView`'s layout: under the title bar, the page's 22-point top margin, the date and
  /// headline (56), the strip's 14-point margin, its hour labels (12) and their 6-point gap; 40 points in from either
  /// side; 18 tall.
  static let dayStrip = CGRect(x: 40, y: titleBar + 22 + 56 + 14 + 18, width: mainSize.width - 80, height: 18)
  /// The middle of the Threads page's first cover, from `ThreadsView`'s layout: 40-point margins, three columns 14
  /// apart, the title, the line under it and the category pills above the grid.
  static let firstCover = CGPoint(x: 40 + (mainSize.width - 80 - 28) / 6, y: titleBar + 28 + 152 + 70)

  static func window(model: AppModel, to directory: URL) async {
    // The whole working day fits this shorter window's Timeline.
    ReadmeShots.defaults.set(0.9, forKey: "timeline.zoom")
    model.section = .day
    model.openThreadID = nil
    model.selectedActivityID = nil
    model.query = ""
    model.refresh()
    let shots = windowStoryboard(thread: model.tiles.first?.thread.id ?? model.dayThreads.first?.id)
    await write(shots.count, fps: windowFPS, size: mainSize, to: directory) { index in
      let shot = shots[index].derived()
      if model.section != shot.section || model.openThreadID != shot.thread {
        model.section = shot.section
        model.openThreadID = shot.thread
        model.titleScrolledAway = false
        model.refresh()
      }
      return WindowScene(model: model, shot: shot)
    }
  }

  /// The pointer's path through the window and the clicks along it, at `windowFPS` frames a second.
  static func windowStoryboard(thread: Int64?) -> [WindowShot] {
    let rest = CGPoint(x: mainSize.width * 0.62, y: titleBar + 62)
    func onStrip(_ fraction: CGFloat) -> CGPoint { CGPoint(x: dayStrip.minX + fraction * dayStrip.width, y: dayStrip.midY) }
    var board = Board(WindowShot(pointer: rest), fps: windowFPS)
    board.hold(0.6)
    board.move(to: onStrip(0.05), 0.7)
    board.move(to: onStrip(0.45), 1.5)
    board.hold(0.5)
    board.move(to: onStrip(0.9), 1.5)
    board.hold(0.3)
    board.move(to: toggle(.timeline), 0.7)
    board.click { $0.section = .timeline }
    board.hold(1.8)
    board.move(to: toggle(.threads), 0.4)
    board.click { $0.section = .threads }
    board.hold(0.5)
    board.move(to: firstCover, 0.7)
    board.hold(0.2)
    board.click { $0.thread = thread }
    board.hold(1.6)
    board.move(to: toggle(.day), 0.8)
    board.click {
      $0.section = .day
      $0.thread = nil
    }
    board.hold(0.3)
    board.move(to: rest, 0.6)
    return board.frames()
  }

  /// The centre of a page's button in the title bar, from `TitleBar`'s layout: 18 points in from the window's edge, 3
  /// of padding, and 13 either side of each label.
  static func toggle(_ section: MainSection) -> CGPoint {
    let font = NSFont.systemFont(ofSize: 12.5, weight: .medium)
    var right = mainSize.width - 18 - 3
    for each in MainSection.allCases.reversed() {
      let width = (each.rawValue as NSString).size(withAttributes: [.font: font]).width + 26
      if each == section { return CGPoint(x: right - width / 2, y: titleBar / 2) }
      right -= width
    }
    return CGPoint(x: right, y: titleBar / 2)
  }

  /// One frame of the window.
  @MainActor
  struct WindowShot: Pointed {
    var pointer: CGPoint
    var ring: (at: CGPoint, progress: Double)?
    var section = MainSection.day
    var thread: Int64?
    /// Worked out from the pointer: the strip fraction under it on the Day page.
    var scrub: CGFloat?

    func derived() -> WindowShot {
      var shot = self
      if section == .day, thread == nil, dayStrip.insetBy(dx: 0, dy: -3).contains(pointer) {
        shot.scrub = (pointer.x - dayStrip.minX) / dayStrip.width
      }
      return shot
    }
  }

  /// The main window as `ReadmeShots` draws it, its strip pinned under the pointer.
  struct WindowScene: View {
    let model: AppModel
    let shot: WindowShot

    var body: some View {
      ShotWindow(model: model)
        .environment(\.pinnedStripFraction, shot.scrub)
        .overlay(alignment: .topLeading) {
          ZStack(alignment: .topLeading) {
            Ring(ring: shot.ring)
            Pointer(at: shot.pointer, hand: false)
          }
        }
        .frame(width: mainSize.width, height: mainSize.height)
        .environment(\.colorScheme, .dark)
    }
  }

  // MARK: The menu-bar panel

  static let popupFPS = 15.0
  /// A slice of the desktop under the menu bar, the panel hanging from Screencap's icon as `PanelController` places it.
  static let size = CGSize(width: 452, height: 466)
  static let menuBar: CGFloat = 28
  static let panel = CGPoint(x: (size.width - PanelView.size.width) / 2, y: menuBar + 6)
  /// Where the panel's parts sit, from `PanelView`'s layout: `topInset` above and 16 points at the sides, the 36-point
  /// header, 12 between rows, the strip's hour labels (12) and gap (6) above the 14-point strip, and the stage's 36-point
  /// thread rows, whose hover wash reaches 8 points into the side margin.
  static let strip = CGRect(x: panel.x + 16, y: panel.y + PanelView.topInset + 66, width: PanelView.inner, height: 14)
  static let stageTop = panel.y + PanelView.topInset + 92
  static let glyph = CGPoint(x: size.width / 2, y: menuBar / 2)
  /// The main window as it opens on a moment, drawn at this size and shown scaled to the scene.
  static let windowSize = CGSize(width: 1180, height: 740)
  static let query = "kyoto"

  static func popup(model: AppModel, to directory: URL) async {
    model.section = .day
    model.todayOverride = model.day
    model.refresh()
    let threads = model.today.threads.filter { $0.threadID != nil }
    // The moment the pointer opens: the longest stretch of the day's biggest thread, as in the inspector shot.
    guard let opened = model.dayThreads.first?.activities.max(by: { $0.minutes < $1.minutes }) else { return }
    let openedAt = (opened.startAt + opened.endAt) / 2
    let openedFraction = CGFloat((openedAt - model.span.lowerBound) / (model.span.upperBound - model.span.lowerBound))
    model.select(opened, capture: model.moment(at: openedAt)?.capture)
    let window = await image(ShotWindow(model: model), size: windowSize)
    model.selectedActivityID = nil
    model.selectedCaptureID = nil

    let shots = popupStoryboard(openedFraction: openedFraction)
    let search = PanelSearch(model: model)
    await write(shots.count, fps: popupFPS, size: size, to: directory) { index in
      let shot = shots[index].derived(rows: threads.count)
      model.hoveredThreadID = shot.row.flatMap { threads[$0].threadID }
      if search.query != shot.query { search.query = shot.query }
      search.isOpen = shot.searchOpen
      search.selection = shot.selection
      return PopupScene(model: model, search: search, shot: shot, window: window, rows: threads.count)
    }
    model.hoveredThreadID = nil
    search.reset()
  }

  /// The pointer's path and what happens along it, at `popupFPS` frames a second.
  static func popupStoryboard(openedFraction: CGFloat) -> [PopupShot] {
    let rest = CGPoint(x: size.width - 34, y: size.height - 30)
    func onStrip(_ fraction: CGFloat) -> CGPoint { CGPoint(x: strip.minX + fraction * strip.width, y: strip.midY) }
    func row(_ index: Int, x: CGFloat) -> CGPoint { CGPoint(x: strip.minX + x * strip.width, y: stageTop + 36 * CGFloat(index) + 18) }
    var board = Board(PopupShot(pointer: rest), fps: popupFPS)
    board.hold(0.3)
    board.move(to: glyph, 0.7)
    board.click()
    board.animate(0.17) { shot, _, p in shot.panel = p }
    board.hold(0.2)
    // The GIF starts here, with the panel open: a page shows the first frame until the GIF has loaded.
    board.markStart()
    board.hold(0.5)
    board.move(to: onStrip(0.02), 0.6)
    board.move(to: onStrip(0.98), 3.6)
    board.hold(0.4)
    board.move(to: row(1, x: 0.55), 0.6)
    board.hold(0.8)
    board.move(to: row(0, x: 0.45), 0.3)
    board.hold(0.8)
    board.move(to: onStrip(openedFraction), 0.5)
    board.hold(0.6)
    board.click()
    board.animate(0.17) { shot, _, p in shot.panel = 1 - p }
    board.animate(0.25) { shot, _, p in shot.window = p }
    board.hold(1.5)
    board.animate(0.17) { shot, _, p in shot.window = 1 - p }
    board.hold(0.2)
    board.animate(0.17) { shot, _, p in
      shot.keys = "⌥ ⌘ S"
      shot.keysOpacity = p
    }
    board.animate(0.17) { shot, _, p in
      shot.panel = p
      shot.searchOpen = true
    }
    board.hold(0.4)
    for count in 1...query.count {
      board.animate(1 / 6) { shot, _, _ in shot.query = String(query.prefix(count)) }
    }
    board.animate(0.25) { shot, _, p in shot.keysOpacity = 1 - p }
    board.hold(0.7)
    board.move(to: CGPoint(x: strip.maxX - 70, y: panel.y + 120), 0.5)
    board.animate(1 / 12) { shot, _, _ in shot.selection = 1 }
    board.hold(1.0)
    board.move(to: rest, 0.7)
    board.click()
    board.animate(0.17) { shot, _, p in shot.panel = 1 - p }
    board.animate(1 / 12) { shot, _, _ in
      shot.query = ""
      shot.searchOpen = false
      shot.selection = 0
      shot.keys = nil
    }
    board.hold(0.3)
    return board.frames()
  }

  /// One frame of the panel.
  @MainActor
  struct PopupShot: Pointed {
    var pointer: CGPoint
    var ring: (at: CGPoint, progress: Double)?
    var panel = 0.0
    var window = 0.0
    var keys: String?
    var keysOpacity = 0.0
    var query = ""
    var searchOpen = false
    var selection = 0
    /// Worked out from the pointer: the strip fraction under it, and the thread row under it.
    var scrub: CGFloat?
    var row: Int?

    /// The panel's answer to where the pointer is: the moment on the strip, else the thread row.
    func derived(rows: Int) -> PopupShot {
      var shot = self
      guard panel == 1, query.isEmpty, !searchOpen else { return shot }
      if strip.insetBy(dx: 0, dy: -2).contains(pointer) {
        shot.scrub = (pointer.x - strip.minX) / strip.width
      } else if pointer.x >= strip.minX, pointer.x <= strip.maxX, pointer.y >= stageTop {
        let index = Int((pointer.y - stageTop) / 36)
        if index < min(rows, 7) { shot.row = index }
      }
      return shot
    }
  }

  /// The menu bar, the panel or the main window, the keys pressed, and the pointer.
  struct PopupScene: View {
    let model: AppModel
    let search: PanelSearch
    let shot: PopupShot
    let window: NSImage?
    let rows: Int

    var body: some View {
      ZStack(alignment: .topLeading) {
        menuBarItems
        if shot.window > 0, let window { main(window) }
        if shot.panel > 0 { panelView }
        if let keys = shot.keys { keycaps(keys).opacity(shot.keysOpacity) }
        Ring(ring: shot.ring)
        Pointer(at: shot.pointer, hand: shot.scrub != nil)
      }
      .frame(width: size.width, height: size.height, alignment: .topLeading)
      .environment(\.colorScheme, .dark)
    }

    var menuBarItems: some View {
      let end = Date(timeIntervalSince1970: model.span.upperBound)
      let clock = "\(end.formatted(.dateTime.weekday(.abbreviated))) \(end.formatted(.dateTime.day())) \(end.formatted(.dateTime.month(.abbreviated)))  \(clockText(model.span.upperBound))"
      return ZStack(alignment: .topLeading) {
        Rectangle().fill(.black.opacity(0.16)).frame(width: size.width, height: menuBar)
        RoundedRectangle(cornerRadius: 6, style: .continuous).fill(.white.opacity(0.22 * shot.panel))
          .frame(width: 32, height: 22).offset(x: glyph.x - 16, y: glyph.y - 11)
        Image(nsImage: MenuBarGlyph.image()).renderingMode(.template).foregroundStyle(.white)
          .frame(width: 22, height: 22).offset(x: glyph.x - 11, y: glyph.y - 11)
        HStack(spacing: 18) {
          Image(systemName: "wifi")
          Image(systemName: "switch.2")
          Text(clock)
        }
        .font(.system(size: 13, weight: .medium)).foregroundStyle(.white)
        .frame(width: size.width - glyph.x - 30, height: menuBar, alignment: .trailing)
        .offset(x: glyph.x + 16)
      }
    }

    var panelView: some View {
      PanelView(
        model: model, search: search, openMain: {}, openActivity: { _, _ in }, openThread: { _ in }, openResult: { _ in }, close: {},
        pinnedFraction: shot.scrub
      )
      // A fresh panel for each place on the strip, which it reads when it appears, and for each query, whose results
      // an offscreen grid would otherwise keep from the query before.
      .id("\(shot.scrub.map { "\($0)" } ?? "") \(shot.query)")
      .background(alignment: .topLeading) {
        ZStack(alignment: .topLeading) {
          Theme.page
          // The hovered row's wash, as `ThreadTimeRow` draws it under the pointer.
          if let row = shot.row {
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.wash)
              .frame(width: PanelView.inner + 16, height: 36).offset(x: 8, y: stageTop - panel.y + 36 * CGFloat(row))
          }
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline))
      .shadow(color: .black.opacity(0.45), radius: 26, y: 14)
      .opacity(shot.panel)
      .offset(x: panel.x, y: panel.y - 5 * (1 - shot.panel))
    }

    func main(_ image: NSImage) -> some View {
      let width = size.width - 32
      let height = width * windowSize.height / windowSize.width
      return Image(nsImage: image).resizable().frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(.white.opacity(0.12)))
        .shadow(color: .black.opacity(0.45), radius: 26, y: 14)
        .scaleEffect(0.95 + 0.05 * shot.window)
        .opacity(shot.window)
        .offset(x: 16, y: menuBar + (size.height - menuBar - height) / 2)
    }

    func keycaps(_ keys: String) -> some View {
      HStack(spacing: 6) {
        ForEach(keys.split(separator: " ").map(String.init), id: \.self) { key in
          Text(key).font(.system(size: 15, weight: .medium)).foregroundStyle(.white)
            .frame(minWidth: 32, minHeight: 32)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.black.opacity(0.35)))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(.white.opacity(0.25)))
        }
      }
      .frame(width: size.width).offset(y: size.height - 48)
    }
  }

  // MARK: Both

  /// A frame with a pointer and the ring its last click left.
  @MainActor
  protocol Pointed {
    var pointer: CGPoint { get set }
    var ring: (at: CGPoint, progress: Double)? { get set }
  }

  /// Builds the frames: each step starts from the last frame and adds its own.
  @MainActor
  struct Board<Shot: Pointed> {
    let fps: Double
    var shots: [Shot]
    var clicks: [(at: CGPoint, frame: Int)] = []
    var start = 0
    init(_ first: Shot, fps: Double) {
      shots = [first]
      self.fps = fps
    }
    var last: Shot { shots[shots.count - 1] }

    /// The frames from the one `markStart` marked round to the one before it, each click's ring on the six frames
    /// after it.
    func frames() -> [Shot] {
      var all = shots
      for click in clicks {
        for step in 0..<6 where click.frame + step < all.count {
          all[click.frame + step].ring = (click.at, Double(step) / 6)
        }
      }
      return Array(all[start...] + all[..<start])
    }

    mutating func markStart() { start = shots.count - 1 }

    mutating func animate(_ seconds: Double, _ change: (inout Shot, Shot, Double) -> Void) {
      let start = last
      let count = max(1, Int((seconds * fps).rounded()))
      for step in 1...count {
        var shot = shots[shots.count - 1]
        change(&shot, start, ease(Double(step) / Double(count)))
        shots.append(shot)
      }
    }

    mutating func hold(_ seconds: Double) { animate(seconds) { _, _, _ in } }

    mutating func move(to target: CGPoint, _ seconds: Double) {
      animate(seconds) { shot, start, p in
        shot.pointer = CGPoint(x: start.pointer.x + (target.x - start.pointer.x) * p, y: start.pointer.y + (target.y - start.pointer.y) * p)
      }
    }

    /// A click where the pointer is, and what it changes from this frame on.
    mutating func click(_ change: (inout Shot) -> Void = { _ in }) {
      clicks.append((last.pointer, shots.count - 1))
      change(&shots[shots.count - 1])
    }

    /// Slow out, slow in, as a hand moves.
    func ease(_ t: Double) -> Double { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
  }

  /// A ring that widens and fades where the pointer clicked.
  struct Ring: View {
    let ring: (at: CGPoint, progress: Double)?

    var body: some View {
      if let ring {
        let diameter = 10 + 30 * ring.progress
        Circle().strokeBorder(.white.opacity(0.75 * (1 - ring.progress)), lineWidth: 2)
          .frame(width: diameter, height: diameter)
          .offset(x: ring.at.x - diameter / 2, y: ring.at.y - diameter / 2)
      }
    }
  }

  /// The system's pointer, the arrow or the pointing hand, its hot spot at `at`.
  struct Pointer: View {
    let at: CGPoint
    let hand: Bool

    var body: some View {
      let cursor = hand ? NSCursor.pointingHand : NSCursor.arrow
      Image(nsImage: cursor.image).offset(x: at.x - cursor.hotSpot.x, y: at.y - cursor.hotSpot.y)
    }
  }

  /// Draws `count` frames offscreen into `directory` as numbered PNGs, transparent where nothing is drawn, with
  /// `info.json` giving the rate. A first pass loads every screenshot the frames show; the second draws them. `frame`
  /// sets the model up for one frame and returns its view.
  static func write<V: View>(_ count: Int, fps: Double, size: CGSize, to directory: URL, frame: (Int) -> V) async {
    try? FileManager.default.removeItem(at: directory)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let hosting = NSHostingView(rootView: frame(0))
    hosting.frame = CGRect(origin: .zero, size: size)
    let offscreen = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    offscreen.appearance = NSAppearance(named: .darkAqua)
    offscreen.backgroundColor = .clear
    offscreen.isOpaque = false
    offscreen.contentView = hosting
    for pass in 0..<2 {
      for index in 0..<count {
        hosting.rootView = frame(index)
        hosting.layoutSubtreeIfNeeded()
        try? await Task.sleep(for: .milliseconds(pass == 0 ? 60 : 90))
        hosting.layoutSubtreeIfNeeded()
        guard pass == 1, let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { continue }
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: directory.appendingPathComponent(String(format: "%04d.png", index)))
      }
    }
    let info = ["fps": fps, "width": size.width, "height": size.height]
    try? JSONSerialization.data(withJSONObject: info).write(to: directory.appendingPathComponent("info.json"))
    print("snapshot \(directory.lastPathComponent): \(count) frames")
  }

  /// Draws `view` offscreen, dark, into an image.
  static func image<V: View>(_ view: V, size: CGSize) async -> NSImage? {
    let hosting = NSHostingView(rootView: view.frame(width: size.width, height: size.height, alignment: .top))
    hosting.frame = CGRect(origin: .zero, size: size)
    let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.appearance = NSAppearance(named: .darkAqua)
    window.contentView = hosting
    hosting.layoutSubtreeIfNeeded()
    try? await Task.sleep(for: .seconds(2.5))
    hosting.layoutSubtreeIfNeeded()
    guard let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { return nil }
    hosting.cacheDisplay(in: hosting.bounds, to: rep)
    let image = NSImage(size: size)
    image.addRepresentation(rep)
    return image
  }
}
