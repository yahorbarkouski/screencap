import AppKit
import Observation
import ScreencapCore
import SwiftUI

/// `Screencap canvas-story --spec demo/canvas/day.json --screens DIR --icons DIR --out DIR`: the app's part of the
/// README's Canvas demo, drawn frame by frame.
///
/// The demo is a made-up day drawn in `demo/canvas`, and everything of Screencap's in it has to be the app itself. So
/// the days of `day.json` are written into a throwaway store, with the screens the demo drew for them, and the main
/// window is filmed over that store: a pointer moves and clicks, the canvas and the ruler answer it as they do on
/// screen, and each frame is drawn offscreen. `manifest.json` says when each part starts and where each picture sits,
/// for the captions and for the pictures that fly in before the film begins.
@MainActor
enum CanvasStory {
  struct Spec: Decodable {
    var today: String
    var screen: Screen
    var apps: [String: App]
    var places: [String: Place]
    var threads: [String: Thread]
    var days: [Day]
    var earlier: [Int]
  }

  struct Screen: Decodable {
    var width: Double
    var height: Double
    var window: Rect
  }

  struct Rect: Decodable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
  }

  struct App: Decodable {
    var bundle: String
    var name: String
  }

  struct Place: Decodable {
    var app: String
    var title: String
    var host: String?
    var path: String?
    var session: String?
    var folder: String?
    var screens: Int
    var cover: Int?
  }

  struct Thread: Decodable {
    var name: String
    var category: ActivityCategory
  }

  struct Day: Decodable {
    var back: Int
    var runs: [Run]
  }

  /// A start time and what was done from it on, one thing after another.
  struct Run: Decodable {
    var start: String
    var visits: [Visit]

    init(from decoder: Decoder) throws {
      var values = try decoder.unkeyedContainer()
      start = try values.decode(String.self)
      visits = try values.decode([Visit].self)
    }
  }

  struct Visit: Decodable {
    var thread: String
    var place: String
    var minutes: Int
    var title: String

    init(from decoder: Decoder) throws {
      var values = try decoder.unkeyedContainer()
      thread = try values.decode(String.self)
      place = try values.decode(String.self)
      minutes = try values.decode(Int.self)
      title = try values.decode(String.self)
    }
  }

  static let size = CGSize(width: 1120, height: 700)
  static let bar: CGFloat = 52

  static func run(spec specURL: URL, screens: URL, icons: URL, out: URL, fps: Double) async throws {
    let spec = try JSONDecoder().decode(Spec.self, from: Data(contentsOf: specURL))
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    guard let today = formatter.date(from: spec.today) else { throw CocoaError(.coderInvalidValue) }

    let root = FileManager.default.temporaryDirectory.appendingPathComponent("canvas-story-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let location = StoreLocation(root: root)
    let database = try location.openDatabase()
    try fill(database, location: location, spec: spec, today: today, screens: screens)

    ImageLoader.shared.makeRoom()
    ReadmeShots.defaults.set(0.86, forKey: "timeline.zoom")
    ReadmeShots.defaults.set(7, forKey: "timeline.columns")
    let settings = SettingsStore(defaults: UserDefaults(suiteName: "com.screencaping.demo")!)
    let model = AppModel(database: database, location: location, settings: settings)
    model.icons.showcase(
      Dictionary(uniqueKeysWithValues: Set(spec.places.values.compactMap(\.host)).compactMap { host in
        NSImage(contentsOf: icons.appendingPathComponent("\(host).png")).map { (host, $0) }
      }))
    model.canvas.today = { today }
    model.section = .canvas
    model.go(toDay: today)
    // Every day the film passes through, read before it starts.
    for day in spec.days.reversed() {
      let date = Calendar.current.date(byAdding: .day, value: -day.back, to: today)!
      model.canvas.show(date)
      for _ in 0..<200 where model.canvas.dayStart != date { try await Task.sleep(for: .milliseconds(20)) }
    }
    for _ in 0..<100 where model.canvas.days.isEmpty { try await Task.sleep(for: .milliseconds(20)) }

    let film = try Film(model: model, fps: fps, to: out)
    await film.settle()
    try await shoot(film, spec: spec)
    try film.finish()
  }

  // MARK: The film

  /// What happens in the window, as hands would do it. Each `mark` is a caption's cue.
  private static func shoot(_ film: Film, spec: Spec) async throws {
    let model = film.model
    let rest = CGPoint(x: size.width * 0.72, y: size.height - 96)
    film.pointer = rest

    film.mark("canvas")
    film.notePlates()
    await film.hold(2.1)

    // Nine visits to one stream, one picture; running along it is running along the day.
    let launch = film.plate(0)
    await film.move(to: CGPoint(x: launch.minX + 14, y: launch.midY + 30), 0.9)
    film.mark("skim")
    await film.move(to: CGPoint(x: launch.maxX - 12, y: launch.midY + 30), 3.4, gently: true)
    await film.hold(0.25)
    await film.move(to: CGPoint(x: launch.minX + launch.width * 0.512, y: launch.midY + 30), 0.6)

    film.mark("open")
    await film.hold(0.2)
    await film.click()
    await film.hold(0.7)
    let strip = film.filmStrip
    if let opened = model.canvas.opened {
      let at = (CGFloat(opened.index) + 0.5) / CGFloat(opened.thing.shots.count)
      await film.move(to: CGPoint(x: strip.minX + strip.width * at, y: strip.midY), 0.6)
      film.ringHere()
      await film.move(to: CGPoint(x: strip.maxX - 8, y: strip.midY), 1.6, gently: true) { pointer in
        model.canvas.showShot(Int((pointer.x - strip.minX) / strip.width * CGFloat(opened.thing.shots.count)))
      }
    }
    await film.hold(0.35)
    await film.move(to: CGPoint(x: size.width - 34, y: bar + 28), 0.45)
    await film.click(at: .view) { model.canvas.opened = nil }
    await film.hold(0.35)

    // A thread's name brings it close.
    film.mark("close")
    if let name = film.name(of: "Kyoto in April") {
      await film.move(to: CGPoint(x: name.minX + 46, y: name.maxY - 26), 0.6)
      await film.click()
      await film.hold(0.7)
      let map = film.plate(named: "map")
      await film.move(to: CGPoint(x: map.minX + 30, y: map.midY), 0.4)
      await film.move(to: CGPoint(x: map.maxX - 30, y: map.midY), 1.2, gently: true)
      await film.hold(0.2)
    }
    await film.move(to: film.tool(.percent), 0.55)
    await film.click(at: .view) { film.canvas?.showWholeDay() }
    await film.hold(0.4)

    film.mark("find")
    await film.move(to: CGPoint(x: size.width / 2 - 60, y: bar / 2), 0.5)
    await film.click(at: .view) {}
    for count in 1..."lantern".count { await film.hold(0.085) { model.query = String("lantern".prefix(count)) } }
    await film.hold(1.2)
    model.query = ""
    await film.hold(0.15)

    film.mark("timeline")
    await film.move(to: ReadmeFrames.toggle(.timeline, inWindow: size.width), 0.5)
    await film.click(at: .view) { model.section = .timeline }
    model.refresh()
    await film.hold(0.7)
    await film.move(to: CGPoint(x: 175, y: 480), 0.6)
    await film.hold(0.8)
    await film.move(to: CGPoint(x: 592, y: 502), 0.5)
    await film.hold(0.9)
    await film.move(to: ReadmeFrames.toggle(.canvas, inWindow: size.width), 0.6)
    await film.click(at: .view) { model.section = .canvas }
    await film.hold(0.35)

    film.mark("days")
    await film.move(to: film.tool(.days), 0.5)
    await film.click(at: .view) { model.canvas.setStacked(true) }
    await film.hold(0.6)
    await film.move(to: CGPoint(x: size.width - 88, y: bar + (size.height - bar) / 2 + 40), 0.5)
    for _ in 0..<4 {
      await film.hold(0.7) { film.ruler?.scroll(by: 1, upTo: 60) }
    }
    await film.hold(0.2)
    film.ruler?.scroll(by: -4, upTo: 60)
    await film.hold(1.0)
    await film.move(to: film.tool(.days), 0.5)
    await film.click(at: .view) { model.canvas.setStacked(false) }
    film.mark("end")
    await film.move(to: rest, 0.7)
    await film.hold(1.5)
  }

  // MARK: The store

  private static func fill(_ database: AppDatabase, location: StoreLocation, spec: Spec, today: Date, screens: URL) throws {
    try database.setMeta(DemoStore.mark, "1")
    var paths: [String: (frame: String, thumb: String, width: Int, height: Int, hash: Int64)] = [:]
    var seed: UInt64 = 0x9E37_79B9_7F4A_7C15
    for (id, place) in spec.places.sorted(by: { $0.key < $1.key }) {
      for index in 0..<place.screens {
        let name = "\(id)-\(String(format: "%02d", index))"
        let url = screens.appendingPathComponent("\(name).png")
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
          throw CocoaError(.fileReadNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "story: no screen at \(url.path); run scripts/stills.mjs first"])
        }
        let frame = "Frames/\(name).heic", thumb = "Thumbs/\(name).heic"
        try FrameEncoder.writeHEIC(image, to: location.url(frame), quality: 0.9)
        try FrameEncoder.writeThumbnail(image, to: location.url(thumb))
        // The canvas shows a thing by the screen most like its others: the cover is a few bits from each of them, and
        // they are twice as far from one another.
        var hash: Int64 = 0
        while index != place.cover, hash.nonzeroBitCount < 9 {
          seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
          hash |= 1 << Int64(seed >> 58)
        }
        paths[name] = (frame, thumb, image.width, image.height, hash)
      }
    }

    var threadIDs: [String: Int64] = [:]
    for (id, thread) in spec.threads.sorted(by: { $0.key < $1.key }) {
      let start = today.timeIntervalSince1970 - 30 * 86_400
      let record = try database.writer.write { db in
        var record = ActivityThread(
          name: thread.name, summary: thread.name, category: thread.category, isNameLocked: true, createdAt: start,
          lastSeenAt: today.timeIntervalSince1970, activityCount: 1, captions: [])
        try record.insert(db)
        return record
      }
      threadIDs[id] = record.id
    }

    let window = ScreenRect(
      x: spec.screen.window.x / spec.screen.width, y: spec.screen.window.y / spec.screen.height,
      width: spec.screen.window.width / spec.screen.width, height: spec.screen.window.height / spec.screen.height)
    var prompts: [String: [Double]] = [:]
    for day in spec.days {
      let start = Calendar.current.date(byAdding: .day, value: -day.back, to: today)!.timeIntervalSince1970
      let visits = day.runs.flatMap(\.visits)
      let minutes = Dictionary(grouping: visits, by: \.place).mapValues { $0.reduce(0) { $0 + $1.minutes } }
      var seen: [String: Int] = [:]
      for run in day.runs {
        let clock = run.start.split(separator: ":").compactMap { Double($0) }
        var at = start + clock[0] * 3600 + clock[1] * 60
        for visit in run.visits {
          guard let place = spec.places[visit.place], let app = spec.apps[place.app] else { throw CocoaError(.coderInvalidValue) }
          if place.session != nil { prompts[visit.place, default: []].append(at - 1) }
          var ids: [String] = []
          for minute in 0..<visit.minutes {
            // A place's screens follow one another over all the time spent there that day.
            let through = Double(seen[visit.place, default: 0]) / Double(max(1, (minutes[visit.place] ?? 1) - 1))
            let index = min(place.screens - 1, Int((through * Double(place.screens - 1)).rounded()))
            seen[visit.place, default: 0] += 1
            let file = paths["\(visit.place)-\(String(format: "%02d", index))"]!
            let capture = Capture(
              at: at + Double(minute) * 60, trigger: .timer, displayID: 1, isFocusedDisplay: true,
              context: ForegroundContext(bundleID: app.bundle, appName: app.name, windowTitle: place.title, urlHost: place.host, urlPath: place.path),
              framePath: file.frame, thumbPath: file.thumb, pixelWidth: file.width, pixelHeight: file.height, dHash: file.hash, duplicateOf: nil,
              ocrState: .notNeeded, window: window)
            try database.insert(capture)
            ids.append(capture.id)
          }
          let end = at + Double(visit.minutes) * 60
          _ = try database.insert(
            Activity(
              firstCaptureID: ids.first!, lastCaptureID: ids.last!, startAt: at, endAt: end, captureCount: ids.count, isOpen: false,
              threadID: threadIDs[visit.thread], threadProbability: 0.97, caption: visit.title, title: visit.title))
          at = end
        }
      }
    }
    for index in stride(from: 0, to: spec.earlier.count - 1, by: 2) {
      let start = Calendar.current.date(byAdding: .day, value: -spec.earlier[index], to: today)!.timeIntervalSince1970 + 9 * 3600
      // Only the ruler and the stack's edges see these days: how busy each was, and three threads that took it.
      let names = threadIDs.keys.sorted()
      for part in 0..<3 {
        _ = try database.insert(
          Activity(
            firstCaptureID: "", lastCaptureID: "", startAt: start + Double(part) * 60, endAt: start + Double(part + 1) * 60,
            captureCount: spec.earlier[index + 1] * (3 - part) / 6, isOpen: false, threadID: threadIDs[names[(index / 2 * 5 + part * 4) % names.count]],
            threadProbability: 0.97, caption: "", title: ""))
      }
    }

    // Claude's sessions, as its transcripts would tell them.
    let transcripts = location.root.appendingPathComponent("transcripts/made-up", isDirectory: true)
    try FileManager.default.createDirectory(at: transcripts, withIntermediateDirectories: true)
    let stamp = ISO8601DateFormatter()
    stamp.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    for (id, times) in prompts {
      guard let place = spec.places[id] else { continue }
      var lines = [#"{"type":"custom-title","customTitle":"\#(place.session ?? "")"}"#]
      for at in times {
        lines.append(
          #"{"type":"user","timestamp":"\#(stamp.string(from: Date(timeIntervalSince1970: at)))","cwd":"/made-up/\#(place.folder ?? "")","entrypoint":"claude-desktop"}"#)
      }
      try lines.joined(separator: "\n").write(to: transcripts.appendingPathComponent("\(UUID().uuidString).jsonl"), atomically: true, encoding: .utf8)
    }
    _ = ClaudeSessionIndex.build(root: transcripts.deletingLastPathComponent(), cache: location.claudeSessionCache)
  }

  // MARK: The camera

  @MainActor @Observable
  final class Stage {
    var pointer = CGPoint.zero
    var ring: (at: CGPoint, progress: Double)?
    var timelinePoint: CGPoint?
    /// The pointer is over something that shows a hand.
    var hand = false
  }

  struct Scene: View {
    let model: AppModel
    let stage: Stage

    var body: some View {
      ShotWindow(model: model)
        .environment(\.pinnedTimelinePoint, stage.timelinePoint)
        .overlay(alignment: .topLeading) {
          ZStack(alignment: .topLeading) {
            ReadmeFrames.Ring(ring: stage.ring)
            ReadmeFrames.Pointer(at: stage.pointer, hand: stage.hand)
          }
        }
        .frame(width: size.width, height: size.height)
        .environment(\.colorScheme, .dark)
        .transaction { $0.animation = nil }
    }
  }

  enum Tool { case days, percent }
  /// Where a click lands: on the canvas's own views, or on a control the film works by hand.
  enum Target { case canvas, view }

  @MainActor
  final class Film {
    let model: AppModel
    private let fps: Double
    private let out: URL
    private let stage = Stage()
    private let hosting: NSHostingView<Scene>
    private let window: NSWindow
    private var index = 0
    private var marks: [String: Double] = [:]
    private var plates: [[String: Any]] = []
    private var writes: [Task<Void, Error>] = []
    private var ringStarted: Int?

    init(model: AppModel, fps: Double, to out: URL) throws {
      self.model = model
      self.fps = fps
      self.out = out
      try? FileManager.default.removeItem(at: out)
      try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
      hosting = NSHostingView(rootView: Scene(model: model, stage: stage))
      hosting.frame = CGRect(origin: .zero, size: size)
      window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      window.appearance = NSAppearance(named: .darkAqua)
      window.contentView = hosting
    }

    var pointer: CGPoint {
      get { stage.pointer }
      set { stage.pointer = newValue }
    }

    /// The canvas, put to moving by steps the first time it is met.
    var canvas: CanvasView? {
      guard let view = model.canvas.view, view.window === window else { return nil }
      if view.steps == nil {
        view.steps = CanvasSteps()
        view.viewDidChangeBackingProperties()
        view.showWholeDay()
        view.step(2)
        ruler?.isStepped = true
      }
      return view
    }

    var ruler: DayRuler? { (model.canvas.view?.superview as? CanvasContainer)?.ruler }

    func settle() async {
      for _ in 0..<12 {
        hosting.layoutSubtreeIfNeeded()
        try? await Task.sleep(for: .milliseconds(150))
        _ = canvas
      }
      canvas?.update()
    }

    // MARK: Cues

    func mark(_ name: String) { marks[name] = Double(index) / fps }

    private func toScene(_ rect: CGRect) -> CGRect { rect.offsetBy(dx: 0, dy: bar) }

    func plate(_ index: Int) -> CGRect { canvas.map { toScene($0.probePlates[index]) } ?? .zero }

    func plate(named part: String) -> CGRect {
      canvas?.storyPlates.first { $0.thing.shots.first?.framePath?.contains("/\(part)-") == true }.map { toScene($0.frame) } ?? .zero
    }

    func name(of thread: String) -> CGRect? { canvas?.storyNames.first { $0.thread == thread }.map { toScene($0.frame) } }

    /// The pictures as they sit now: which screen, which part of it, and where, for the ones that fly in.
    func notePlates() {
      plates = (canvas?.storyPlates ?? []).map { plate in
        let shot = plate.thing.shots[plate.thing.cover]
        let frame = toScene(plate.frame)
        let part = shot.fill(Double(CanvasLayout.aspect))
        let name = URL(fileURLWithPath: shot.framePath ?? "").deletingPathExtension().lastPathComponent
        return [
          "screen": name, "place": name.split(separator: "-").dropLast().joined(separator: "-"), "thread": plate.thread, "radius": plate.radius,
          "frame": [frame.minX, frame.minY, frame.width, frame.height], "part": [part.x, part.y, part.width, part.height],
        ]
      }
    }

    /// The open thing's film strip, from `CanvasViewer`'s layout.
    var filmStrip: CGRect {
      let width = min(760, size.width - 120)
      return CGRect(x: (size.width - width) / 2, y: size.height - CanvasViewer.bottom + 13, width: width, height: 44)
    }

    /// A button of the canvas's tools, from `CanvasPage`'s layout, from the right: the plus, the percentage, the minus, the
    /// divider, and the days.
    func tool(_ tool: Tool) -> CGPoint {
      let right = size.width - 16 - 3
      let x = tool == .percent ? right - 34 - 23 : right - 34 - 46 - 34 - 7 - 17
      return CGPoint(x: x, y: size.height - 16 - 18)
    }

    // MARK: Acting

    func hold(_ seconds: Double, _ first: () -> Void = {}) async {
      first()
      for _ in 0..<max(1, Int((seconds * fps).rounded())) { await frame() }
    }

    func move(to target: CGPoint, _ seconds: Double, gently: Bool = false, _ each: (CGPoint) -> Void = { _ in }) async {
      let start = pointer
      let count = max(1, Int((seconds * fps).rounded()))
      for step in 1...count {
        let t = Double(step) / Double(count)
        // A hand's move speeds up and slows down; a run along something keeps its pace but for its ends.
        let p = gently ? t * t * (3 - 2 * t) * 0.35 + t * 0.65 : t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
        pointer = CGPoint(x: start.x + (target.x - start.x) * p, y: start.y + (target.y - start.y) * p)
        each(pointer)
        await frame()
      }
    }

    func ringHere() { ringStarted = index }

    func click(at target: Target = .canvas, _ change: () -> Void = {}) async {
      ringHere()
      await frame()
      if target == .canvas, let canvas {
        canvas.mouseDown(with: event(.leftMouseDown))
        canvas.mouseUp(with: event(.leftMouseUp))
      }
      change()
      await frame()
    }

    private func event(_ type: NSEvent.EventType) -> NSEvent {
      NSEvent.mouseEvent(
        with: type, location: CGPoint(x: pointer.x, y: size.height - pointer.y), modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber,
        context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
    }

    // MARK: One frame

    private func frame() async {
      if let started = ringStarted {
        let progress = Double(index - started) / fps / 0.4
        stage.ring = progress < 1 ? (stage.ring?.at ?? pointer, progress) : nil
        if progress >= 1 { ringStarted = nil }
      }
      if model.section == .canvas, let canvas {
        canvas.update()
        ruler?.update()
        if model.canvas.opened == nil {
          if canvas.bounds.contains(canvas.convert(CGPoint(x: pointer.x, y: size.height - pointer.y), from: nil)), !model.canvas.isStacked || pointer.x < size.width - CanvasView.ruler {
            canvas.mouseMoved(with: event(.mouseMoved))
          } else {
            canvas.mouseExited(with: event(.mouseMoved))
          }
        }
        canvas.step(1 / fps)
        ruler?.step(1 / fps)
      }
      stage.timelinePoint = model.section == .timeline ? timelinePoint : nil
      hosting.layoutSubtreeIfNeeded()
      try? await Task.sleep(for: .milliseconds(model.section == .timeline ? 90 : 24))
      canvas?.update()
      hosting.layoutSubtreeIfNeeded()
      guard let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { return }
      hosting.cacheDisplay(in: hosting.bounds, to: rep)
      if let image = rep.cgImage {
        let url = out.appendingPathComponent(String(format: "%05d.png", index))
        writes.append(
          Task.detached {
            guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { throw CocoaError(.fileWriteUnknown) }
            CGImageDestinationAddImage(destination, image, nil)
            guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
          })
      }
      index += 1
      if writes.count >= 24 {
        for write in writes { _ = try? await write.value }
        writes = []
      }
    }

    /// The pointer in the timeline's own coordinates, from `TimelinePage`'s layout: 40-point margins, and above the
    /// timeline the settings row (20, 24, 6) and the pinned column titles (10, 78, 8, 6).
    private var timelinePoint: CGPoint? {
      let point = CGPoint(x: pointer.x - 40, y: pointer.y - bar - timelineTop)
      return point.x > 0 && point.y > 0 ? point : nil
    }

    private let timelineTop: CGFloat = 152

    func finish() throws {
      let group = DispatchGroup()
      for write in writes {
        group.enter()
        Task.detached {
          _ = try? await write.value
          group.leave()
        }
      }
      group.wait()
      let manifest: [String: Any] = [
        "fps": fps, "frames": index, "width": size.width, "height": size.height, "bar": bar, "marks": marks, "plates": plates,
      ]
      try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]).write(to: out.appendingPathComponent("manifest.json"))
      print("canvas-story: \(index) frames, \(plates.count) pictures in \(out.path)")
    }
  }
}
