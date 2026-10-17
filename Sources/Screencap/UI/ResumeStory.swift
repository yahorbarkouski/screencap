import AppKit
import ImageIO
import ScreencapCore
import SwiftUI

/// `Screencap resume-story --spec demo/resume/story.json --out DIR`: the palette, as the app draws it, for the
/// README's Resume demo.
///
/// The demo is a made-up afternoon drawn in `demo/resume`, and the palette in it has to be this one rather than a
/// drawing of it. So the threads of `story.json` are written into a throwaway store, each with its places, its
/// times and the screen it was left on (a still the demo rendered), and `ResumePalette` is drawn over that store in
/// each state the demo shows. A board is the afternoon at one moment: before the first resume the trip is the
/// thread being worked in, after it the tokenizer is, and the palette puts the current thread last.
@MainActor
enum ResumeStory {
  struct Spec: Decodable {
    var now: String
    var screen: Size
    var threads: [Thread]
    var boards: [String: Board]
    var states: [State]
    var toasts: [String]
  }

  struct Size: Decodable {
    var width: Double
    var height: Double
  }

  struct Rect: Decodable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
  }

  struct Thread: Decodable {
    var id: String
    var name: String
    var leftOff: String
    var minutesAgo: [String: Double]
    /// The screen the thread was left on, relative to the spec, and the window that was in front on it.
    var still: String?
    var front: Rect?
    var places: [Place]
  }

  struct Place: Decodable {
    var key: String
    var kind: ThingKind
    var label: String
    var detail: String?
    var bundleID: String
    var minutes: Double
    var activities: Int
  }

  struct Board: Decodable {
    var current: String
  }

  struct State: Decodable {
    var name: String
    var board: String
    var query: String
    var selection: Int
    var peeking: Bool
    var place: Int
  }

  static func run(spec specURL: URL, out: URL) async throws {
    let spec = try JSONDecoder().decode(Spec.self, from: Data(contentsOf: specURL))
    guard let now = ISO8601DateFormatter().date(from: spec.now)?.timeIntervalSince1970 else {
      throw CocoaError(.coderInvalidValue, userInfo: [NSLocalizedDescriptionKey: "story: `now` is not an ISO 8601 moment"])
    }
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let base = specURL.deletingLastPathComponent()

    var models: [String: ResumeModel] = [:]
    var stores: [URL] = []
    // The stores exist only to be drawn from, so they go once the drawing is done, however it ends.
    defer { for store in stores { try? FileManager.default.removeItem(at: store) } }
    for (name, board) in spec.boards {
      let root = FileManager.default.temporaryDirectory.appendingPathComponent("resume-story-\(name)-\(UUID().uuidString)")
      stores.append(root)
      let location = StoreLocation(root: root)
      let database = try location.openDatabase()
      try fill(database, location: location, spec: spec, board: name, now: now, base: base)
      let model = ResumeModel(database: database, location: location, corrections: nil)
      model.showcase(now: now, selection: 0, peeking: false, place: 0)
      model.reload(now: now)
      let order = model.shown.map(\.name)
      guard order.last == spec.threads.first(where: { $0.id == board.current })?.name else {
        throw CocoaError(.coderInvalidValue, userInfo: [NSLocalizedDescriptionKey: "story: board \(name) does not end with \(board.current): \(order)"])
      }
      print("board \(name): \(order.joined(separator: ", "))")
      models[name] = model
    }

    let renderer = Renderer(size: ResumePalette.size)
    // Twice over: the first pass lets the icons and the previews load, the second is the one written.
    for pass in 0..<2 {
      for state in spec.states {
        guard let model = models[state.board] else { continue }
        model.query = state.query
        model.showcase(now: now, selection: state.selection, peeking: state.peeking, place: state.place)
        // One view per board, as the real palette is one view shown many times: typing into it then adds to the
        // query instead of selecting it.
        let view = ResumePalette(model: model, resume: {}).id(state.board)
        let png = await renderer.render(view, settle: pass == 0 ? 0.5 : 0.25)
        if pass == 1 { try png.write(to: out.appendingPathComponent("palette-\(state.name).png")) }
      }
    }

    var toasts: [String: [String: Double]] = [:]
    for id in spec.toasts {
      guard let thread = spec.threads.first(where: { $0.id == id }) else { continue }
      let view = ResumeToastView(thread: thread.name, leftOff: thread.leftOff, trouble: nil)
      let size = view.fittedSize
      let png = await Renderer(size: size).render(view, settle: 0.2)
      try png.write(to: out.appendingPathComponent("toast-\(id).png"))
      toasts[id] = ["width": size.width, "height": size.height]
    }
    let manifest: [String: Any] = [
      "palette": ["width": ResumePalette.size.width, "height": ResumePalette.size.height],
      "toasts": toasts,
    ]
    try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
      .write(to: out.appendingPathComponent("manifest.json"))
    print("resume-story: \(spec.states.count) palettes and \(toasts.count) toasts in \(out.path)")
  }

  /// One board's store: each thread, one activity ending when it was last left, the screen it was left on, and
  /// its places with the minutes spent in each.
  private static func fill(
    _ database: AppDatabase, location: StoreLocation, spec: Spec, board: String, now: Double, base: URL
  ) throws {
    let day = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: now)).timeIntervalSince1970
    var bindings: [ThreadBinding] = []
    for thread in spec.threads {
      let left = now - (thread.minutesAgo[board] ?? 0) * 60
      let record = try database.writer.write { db in
        var record = ActivityThread(
          name: thread.name, summary: thread.leftOff, category: .work, isNameLocked: true, createdAt: left - 86_400,
          lastSeenAt: left, activityCount: 1, captions: [thread.leftOff])
        try record.insert(db)
        return record
      }
      guard let threadID = record.id else { continue }

      let captureID = UUID().uuidString
      let at = left - 30
      var framePath: String?
      var thumbPath: String?
      var pixels = (width: Int(spec.screen.width), height: Int(spec.screen.height))
      if let still = thread.still {
        let url = base.appendingPathComponent(still)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
          throw CocoaError(.fileReadNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "story: no still at \(url.path); run `npm run stills` first"])
        }
        framePath = location.frameRelativePath(captureID: captureID, at: at)
        thumbPath = location.thumbRelativePath(captureID: captureID, at: at)
        try FrameEncoder.writeHEIC(image, to: location.url(framePath!))
        try FrameEncoder.writeThumbnail(image, to: location.url(thumbPath!))
        pixels = (image.width, image.height)
      }
      let window = thread.front.map {
        ScreenRect(
          x: $0.x / spec.screen.width, y: $0.y / spec.screen.height, width: $0.width / spec.screen.width,
          height: $0.height / spec.screen.height)
      }
      let context = ForegroundContext(
        bundleID: thread.places.first?.bundleID, appName: nil, windowTitle: thread.name, urlHost: nil, urlPath: nil)
      try database.insert(
        Capture(
          id: captureID, at: at, trigger: .contextSwitch, displayID: 1, isFocusedDisplay: true, context: context,
          framePath: framePath, thumbPath: thumbPath, pixelWidth: pixels.width, pixelHeight: pixels.height, dHash: 0,
          duplicateOf: nil, ocrState: .notNeeded, window: window))
      _ = try database.insert(
        Activity(
          firstCaptureID: captureID, lastCaptureID: captureID, startAt: left - 600, endAt: left, captureCount: 1,
          isOpen: false, threadID: threadID, threadProbability: 0.97, caption: thread.leftOff, title: thread.leftOff))

      let refs = thread.places.map {
        ThingRef(key: $0.key, kind: $0.kind, label: $0.label, detail: $0.detail, bundleID: $0.bundleID)
      }
      let ids = try database.upsertThings(
        refs, firstSeen: Dictionary(uniqueKeysWithValues: refs.map { ($0.key, left - 86_400) }),
        lastSeen: Dictionary(uniqueKeysWithValues: refs.map { ($0.key, left) }))
      for place in thread.places {
        guard let thingID = ids[place.key] else { continue }
        bindings.append(
          ThreadBinding(
            threadID: threadID, thingID: thingID, dayStart: day, seconds: place.minutes * 60,
            captures: Int(place.minutes), activities: place.activities))
      }
    }
    try database.replaceBindings(bindings, fromDay: 0)
  }

  /// Draws a view offscreen, dark, on a clear background, at twice its size in points.
  @MainActor final class Renderer {
    let hosting: NSHostingView<AnyView>
    let window: NSWindow

    init(size: CGSize) {
      hosting = NSHostingView(rootView: AnyView(EmptyView()))
      hosting.frame = CGRect(origin: .zero, size: size)
      window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      window.appearance = NSAppearance(named: .darkAqua)
      window.backgroundColor = .clear
      window.isOpaque = false
      window.contentView = hosting
    }

    func render<V: View>(_ view: V, settle: Double) async -> Data {
      hosting.rootView = AnyView(view.environment(\.colorScheme, .dark))
      hosting.layoutSubtreeIfNeeded()
      try? await Task.sleep(for: .seconds(settle))
      hosting.layoutSubtreeIfNeeded()
      let bounds = hosting.bounds
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(bounds.width * 2), pixelsHigh: Int(bounds.height * 2),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
      rep.size = bounds.size
      hosting.cacheDisplay(in: bounds, to: rep)
      return rep.representation(using: .png, properties: [:]) ?? Data()
    }
  }
}
