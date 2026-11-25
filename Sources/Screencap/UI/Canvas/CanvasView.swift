import AppKit
import ScreencapCore
import SwiftUI

/// The canvas: a day's threads laid out on one surface that scrolls, pinches and throws like a map. Everything on it is
/// a layer under one camera, so moving it moves one transform and nothing is laid out again.
final class CanvasView: NSView {
  private let model: CanvasModel
  private let icons: PlaceIcons
  private let location: StoreLocation

  // The stack, the shown day's sheet with the world on it, and an open screen over both.
  private let cards = StillLayer()
  private let sheet = CALayer()
  private let world = StillLayer()
  private let veil = CALayer()
  private let hero = CALayer()
  /// What the probe checks.
  var probeState: (camera: CanvasCamera, skimming: String?, shown: Int?, opened: String?, cards: Int) {
    (camera, hovered?.isSkimming == true ? hovered?.thing.id : nil, hovered?.shown, opened?.thing.id, cardLayers.count)
  }
  var probePlates: [CGRect] { plates.map(viewFrame) }
  /// What the README's film points at.
  var storyPlates: [(thread: String, thing: CanvasThing, frame: CGRect, radius: CGFloat)] {
    plates.map { ($0.block.thread.name, $0.thing, viewFrame(of: $0), $0.radius * camera.zoom) }
  }
  var storyNames: [(thread: String, frame: CGRect)] { blocks.map { ($0.block.thread.name, camera.toView($0.block.nameFrame)) } }
  var probeNames: [CGRect] { blocks.map { camera.toView($0.block.nameFrame) } }
  private var cardLayers: [(layer: CALayer, summary: CanvasDaySummary)] = []

  private var day: CanvasDay?
  private var dayStart = Date.distantPast
  private var arranged: CanvasLayout?
  private var plates: [PlateLayers] = []
  private var blocks: [BlockLayers] = []
  /// Each block's plates, and the blocks whose text is at the size this zoom asks for.
  private var platesOf: [[PlateLayers]] = []
  private var fitted: Set<Int> = []
  private var colors: CanvasColors

  private var camera = CanvasCamera()
  private var motion: CanvasMotion?
  private var link: CADisplayLink?
  private var lastTick: CFTimeInterval = 0
  private var textZoom: CGFloat = 0
  /// The whole day is in view, and stays so as the window is resized.
  private(set) var isWholeDay = true
  private var isStacked = false
  private var find = ""
  private var opened: CanvasModel.Opened?
  /// The plate an open screen grew out of.
  private weak var openedPlate: PlateLayers?

  private weak var hovered: PlateLayers?
  private var drag: (start: CGPoint, camera: CanvasCamera, last: CGPoint, at: TimeInterval, velocity: CGPoint, moved: Bool)?
  private var sharpening: Task<Void, Never>?
  private var tracking: NSTrackingArea?
  private var swipe: CGFloat = 0

  static let sheetScale: CGFloat = 0.88, sheetTop: CGFloat = 138, sheetShift: CGFloat = -44, cardStep: CGFloat = 30
  static let ruler: CGFloat = 132
  /// Motion a click starts, after the app's rules: strong ease-out, under 300 ms.
  static let easeOut = CAMediaTimingFunction(controlPoints: 0.23, 1, 0.32, 1)

  init(model: CanvasModel, icons: PlaceIcons, location: StoreLocation) {
    self.model = model
    self.icons = icons
    self.location = location
    colors = CanvasColors(NSApp.effectiveAppearance)
    super.init(frame: .zero)
    let root = StillLayer()
    root.isGeometryFlipped = true
    root.masksToBounds = true
    layer = root
    wantsLayer = true
    for layer in [cards, sheet, veil, hero] as [CALayer] { root.addSublayer(layer) }
    sheet.anchorPoint = CGPoint(x: 0.5, y: 0)
    sheet.masksToBounds = true
    sheet.cornerCurve = .continuous
    world.anchorPoint = .zero
    sheet.addSublayer(world)
    veil.opacity = 0
    hero.isHidden = true
    hero.masksToBounds = true
    hero.cornerRadius = 12
    hero.cornerCurve = .continuous
    hero.contentsGravity = .resize
    hero.minificationFilter = .trilinear
    applyColors()
  }

  required init?(coder: NSCoder) { nil }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  private var scale: CGFloat { window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2 }
  private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
  /// Keys act at once; what a click starts may move.
  private var byClick: Bool { steps?.byClick ?? NSApp.currentEvent.map { $0.type != .keyDown } ?? false }
  /// Set when frames are drawn one by one (the README's demo): motion moves by `step` and not by the display's clock.
  var steps: CanvasSteps?

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      stop()
      sharpening?.cancel()
    } else {
      model.view = self
      textZoom = 0
      apply()
    }
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    rebuild()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    applyColors()
  }

  override func layout() {
    super.layout()
    let size = bounds.size
    guard size != lastSize else { return }
    lastSize = size
    still {
      cards.frame = bounds
      veil.frame = bounds
      placeSheet(animated: false)
      placeCards(animated: false)
    }
    if let day, isWholeDay { relayout(day) }
    if opened != nil { placeHero() }
  }

  private var lastSize = CGSize.zero

  private func still(_ body: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    body()
    CATransaction.commit()
  }

  private func applyColors() {
    colors = CanvasColors(effectiveAppearance)
    still {
      layer?.backgroundColor = colors.page
      sheet.backgroundColor = colors.page
      sheet.borderColor = colors.hairline
      veil.backgroundColor = colors.page
      hero.borderColor = colors.hairline
      hero.borderWidth = 0.5
      hero.backgroundColor = colors.card
      for plate in plates { plate.color(colors) }
      for block in blocks { block.color() }
      placeCards(animated: false)
    }
    refreshIcons()
    textZoom = 0
    apply()
  }

  // MARK: What to show

  /// Takes up what changed in the model.
  func update() {
    // Today changes as it goes; not under the pointer, and not behind an open screen.
    let busy = model.dayStart == dayStart && (hovered != nil || opened != nil || drag != nil)
    if !busy, model.day != day || model.dayStart != dayStart { show() }
    if model.isStacked != isStacked {
      isStacked = model.isStacked
      setHover(nil)
      placeSheet(animated: byClick && !reduceMotion)
      placeCards(animated: byClick && !reduceMotion)
      if isWholeDay, arranged != nil { move(to: wholeDay(), animated: byClick) }
    } else if cardLayers.map(\.summary) != model.behind {
      still { placeCards(animated: false) }
    }
    if model.find != find {
      find = model.find
      applyFind()
    }
    if model.opened != opened { showOpened() }
    refreshIcons()
  }

  private func show() {
    let sameDay = model.dayStart == dayStart
    let older = model.dayStart < dayStart
    let before = arranged
    let old = camera
    // Close up, the thread you were looking at stays where it was while the rest changes around it.
    let middle = old.toCanvas(CGPoint(x: bounds.midX, y: bounds.midY))
    let near = isWholeDay ? nil : before?.blocks.min { distance($0.frame, middle) < distance($1.frame, middle) }
    day = model.day
    dayStart = model.dayStart
    setHover(nil)
    guard let day else { return }
    arranged = CanvasLayout(day, fitting: room)
    rebuild()
    if let near, let same = arranged?.blocks.first(where: { $0.thread.id == near.thread.id }) {
      let at = old.toView(near.frame.origin)
      jump(to: CanvasCamera(x: at.x - same.frame.minX * old.zoom, y: at.y - same.frame.minY * old.zoom, zoom: old.zoom))
    } else {
      isWholeDay = true
      jump(to: wholeDay())
    }
    if !sameDay, byClick, !reduceMotion, before != nil { settleIn(from: older ? -14 : 14) }
  }

  /// Moves everything that is moving `seconds` on, when frames are drawn one by one.
  func step(_ seconds: Double) {
    guard steps != nil else { return }
    if var motion {
      let next = motion.advance(camera, by: CGFloat(seconds))
      self.motion = next.arrived ? nil : motion
      camera = next.camera
      apply()
    }
    steps?.advance(seconds)
  }

  private func settleIn(from offset: CGFloat) {
    if steps != nil {
      steps?.add(0.2) { [weak self] p in
        self?.still {
          self?.world.opacity = Float(p)
          self?.world.position = CGPoint(x: 0, y: offset * (1 - p))
        }
      }
      return
    }
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0
    let slide = CABasicAnimation(keyPath: "transform.translation.y")
    slide.fromValue = offset
    slide.toValue = 0
    slide.isAdditive = true
    let group = CAAnimationGroup()
    group.animations = [fade]
    group.duration = 0.2
    group.timingFunction = Self.easeOut
    world.add(group, forKey: "settle")
    let move = CABasicAnimation(keyPath: "position.y")
    move.fromValue = offset
    move.toValue = 0
    move.isAdditive = true
    move.duration = 0.2
    move.timingFunction = Self.easeOut
    world.add(move, forKey: "slide")
  }

  private func relayout(_ day: CanvasDay) {
    let next = CanvasLayout(day, fitting: room)
    if next != arranged {
      arranged = next
      rebuild()
    }
    jump(to: wholeDay())
  }

  /// Makes the layers for the layout; screenshots already decoded show at once.
  private func rebuild() {
    guard let arranged, let day else { return }
    setHover(nil)
    still {
      world.sublayers?.forEach { $0.removeFromSuperlayer() }
      blocks = arranged.blocks.map { BlockLayers($0, scale: scale) }
      platesOf = arranged.blocks.map { block in block.plates.map { PlateLayers($0, block: block, span: day.span, scale: scale) } }
      plates = platesOf.flatMap { $0 }
      for plate in plates {
        plate.color(colors)
        world.addSublayer(plate.root)
      }
      for block in blocks { block.layers.forEach(world.addSublayer) }
    }
    for plate in plates { load(plate, plate.thing.cover) }
    refreshIcons()
    applyFind()
    textZoom = 0
    apply()
    if opened != nil { openedPlate = plates.first { $0.thing.id == opened?.thing.id && $0.block.thread.id == opened?.thread.id } }
    NSAccessibility.post(element: self, notification: .layoutChanged)
  }

  private func refreshIcons() {
    still {
      for plate in plates { plate.setIcon(icons.canvasIcon(plate.thing.icon, app: plate.thing.bundleID, ink: colors.ink)) }
    }
  }

  private func applyFind() {
    let words = find.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    func matches(_ thing: CanvasThing) -> Bool { words.allSatisfy { thing.searchText.contains($0) } }
    still {
      for plate in plates { plate.root.opacity = words.isEmpty || matches(plate.thing) ? 1 : 0.12 }
      for block in blocks {
        let hit = words.isEmpty || block.block.thread.things.contains(where: matches)
        for layer in block.layers where layer !== block.also || hit == false { layer.opacity = hit ? 1 : 0.12 }
      }
    }
    textZoom = words.isEmpty ? 0 : textZoom
    foundNext = 0
  }

  private var foundNext = 0

  /// Goes to the next match, as Return does in the search field.
  func showNextFound() {
    let words = find.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    let hits = plates.filter { plate in words.allSatisfy { plate.thing.searchText.contains($0) } }
    guard !words.isEmpty, !hits.isEmpty else { return }
    let hit = hits[foundNext % hits.count]
    foundNext += 1
    isWholeDay = false
    move(to: fitting(hit.plate.frame.union(hit.plate.frame.offsetBy(dx: 0, dy: hit.plate.captionHeight)), pad: 90), animated: false)
  }

  // MARK: Camera

  /// The room the day is laid out for.
  private var room: CGSize {
    let inset = insets
    return CGSize(width: bounds.width - inset.left * 2, height: bounds.height - inset.top - inset.bottom)
  }

  private var insets: (left: CGFloat, top: CGFloat, bottom: CGFloat) {
    guard isStacked else { return (48, 14, 48) }
    return (48, 16, bounds.height - (bounds.height - Self.sheetTop) / Self.sheetScale + 24)
  }

  private func wholeDay() -> CanvasCamera {
    guard let arranged, arranged.size.width > 0, bounds.width > 0 else { return camera }
    let inset = insets, room = room
    let zoom = min(max(min(room.width / arranged.size.width, room.height / arranged.size.height, 0.9), CanvasCamera.zooms.lowerBound), 2)
    let spare = max(0, room.height - arranged.size.height * zoom)
    return CanvasCamera(x: (bounds.width - arranged.size.width * zoom) / 2, y: inset.top + spare / 2, zoom: zoom)
  }

  private func fitting(_ rect: CGRect, pad: CGFloat = 56) -> CanvasCamera {
    let zoom = min(max(min((bounds.width - pad * 2) / rect.width, (bounds.height - pad * 2 - 30) / rect.height, 1.25), 0.06), 2)
    return CanvasCamera(x: bounds.midX - rect.midX * zoom, y: (bounds.height - 30) / 2 - rect.midY * zoom, zoom: zoom)
  }

  /// The nearest camera whose middle is over the day.
  private func held(_ camera: CanvasCamera) -> CanvasCamera {
    guard let arranged else { return camera }
    let middle = camera.toCanvas(CGPoint(x: bounds.midX, y: bounds.midY))
    let inside = CGPoint(x: min(max(middle.x, 0), arranged.size.width), y: min(max(middle.y, 0), arranged.size.height))
    var copy = camera
    copy.x -= (inside.x - middle.x) * camera.zoom
    copy.y -= (inside.y - middle.y) * camera.zoom
    return copy
  }

  private func jump(to next: CanvasCamera) {
    stop()
    camera = next.clamped()
    apply()
  }

  private func move(to next: CanvasCamera, animated: Bool, coast: CGFloat? = nil) {
    guard animated, !reduceMotion, steps != nil || window?.isVisible == true else { return jump(to: next) }
    motion = CanvasMotion(to: next, coast: coast)
    guard link == nil, steps == nil else { return }
    lastTick = 0
    let link = displayLink(target: self, selector: #selector(tick(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  private func stop() {
    link?.invalidate()
    link = nil
    motion = nil
  }

  @objc private func tick(_ link: CADisplayLink) {
    guard var motion else { return stop() }
    let elapsed = lastTick == 0 ? link.duration : link.timestamp - lastTick
    lastTick = link.timestamp
    let next = motion.advance(camera, by: CGFloat(max(elapsed, 1 / 240)))
    self.motion = motion
    camera = next.camera
    apply()
    guard next.arrived else { return }
    stop()
    let held = held(camera)
    if held != camera { move(to: held, animated: true) }
  }

  private func apply() {
    still {
      world.setAffineTransform(CGAffineTransform(a: camera.zoom, b: 0, c: 0, d: camera.zoom, tx: camera.x, ty: camera.y))
      if camera.zoom != textZoom {
        textZoom = camera.zoom
        fitted = []
      }
      // What is in view keeps its text at a readable size; the rest catches up when it comes into view.
      let visible = camera.toCanvas(bounds)
      for (index, block) in blocks.enumerated() where !fitted.contains(index) && visible.intersects(block.block.frame.insetBy(dx: -80, dy: -80)) {
        fitted.insert(index)
        block.fit(zoom: camera.zoom, colors: colors)
        for plate in platesOf[index] { plate.fit(zoom: camera.zoom, colors: colors) }
      }
      if !find.isEmpty { dimBlocks() }
    }
    let percent = Int((camera.zoom * 100).rounded())
    if model.zoomPercent != percent { model.zoomPercent = percent }
    sharpen()
  }

  private func dimBlocks() {
    let words = find.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    for block in blocks {
      let hit = block.block.thread.things.contains { thing in words.allSatisfy { thing.searchText.contains($0) } }
      if !hit { block.layers.forEach { $0.opacity = 0.12 } }
    }
  }

  func showWholeDay() {
    isWholeDay = true
    move(to: wholeDay(), animated: byClick)
  }

  func zoom(by factor: CGFloat) {
    isWholeDay = false
    let middle = CGPoint(x: bounds.midX, y: bounds.midY)
    move(to: (motion?.target ?? camera).zoomed(by: factor, at: middle), animated: byClick)
  }

  private func show(_ block: CanvasLayout.Block) {
    isWholeDay = false
    move(to: fitting(block.frame), animated: true)
  }

  // MARK: Pictures

  private func url(_ path: String) -> URL { location.url(path) }

  private func load(_ plate: PlateLayers, _ index: Int) {
    if steps != nil {
      let image = ImageLoader.shared.now(url(plate.thing.shots[index].thumbPath), maxPixels: 480)
      return still { plate.show(image?.canvasImage, index: index) }
    }
    let url = url(plate.thing.shots[index].thumbPath)
    if let image = ImageLoader.shared.cached(url, maxPixels: 480) {
      still { plate.show(image.canvasImage, index: index) }
      return
    }
    still { plate.show(nil, index: index) }
    Task { [weak plate] in
      guard let image = await ImageLoader.shared.load(url, maxPixels: 480), let plate, plate.shown == index, !plate.isSharp else { return }
      still { plate.show(image.canvasImage, index: index) }
      let fade = CABasicAnimation(keyPath: "opacity")
      fade.fromValue = 0
      fade.duration = 0.14
      plate.picture.add(fade, forKey: "appear")
    }
  }

  /// Once the canvas is still, pictures drawn larger than their thumbnail get the full screenshot, and others give it up.
  private func sharpen() {
    sharpening?.cancel()
    if steps != nil { return sharpenNow() }
    sharpening = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(160))
      guard let self, !Task.isCancelled else { return }
      let visible = self.camera.toCanvas(self.bounds).insetBy(dx: -100, dy: -100)
      for plate in self.plates where !plate.isSkimming {
        let needed = plate.pixelsNeeded(zoom: self.camera.zoom, scale: self.scale)
        let wants = needed > 560 && visible.intersects(plate.plate.frame)
        guard wants else {
          if plate.isSharp {
            plate.isSharp = false
            self.load(plate, plate.shown)
          }
          continue
        }
        let index = plate.shown
        guard !plate.isSharp, let path = plate.thing.shots[index].framePath else { continue }
        plate.isSharp = true
        let pixels = needed > 1100 ? FullFrame.maxPixels : 1100
        Task { [weak self, weak plate] in
          guard let self, let image = await ImageLoader.shared.load(self.url(path), maxPixels: pixels), let plate, plate.isSharp, plate.shown == index
          else { return }
          self.still { plate.show(image.canvasImage, index: index) }
        }
      }
    }
  }

  /// What `sharpen` does, at once and with the decoding waited for: a drawn frame has no later.
  private func sharpenNow() {
    let visible = camera.toCanvas(bounds).insetBy(dx: -100, dy: -100)
    for plate in plates where visible.intersects(plate.plate.frame) {
      let shot = plate.thing.shots[plate.shown]
      let pixels = plate.pixelsNeeded(zoom: camera.zoom, scale: scale) > 560 ? FullFrame.maxPixels : 480
      guard let image = ImageLoader.shared.now(url(pixels > 480 ? shot.framePath ?? shot.thumbPath : shot.thumbPath), maxPixels: pixels) else { continue }
      plate.isSharp = pixels > 480
      still { plate.show(image.canvasImage, index: plate.shown) }
    }
  }

  // MARK: The stack of days

  private func sheetPoint(_ point: CGPoint) -> CGPoint {
    guard isStacked else { return point }
    return CGPoint(x: (point.x - bounds.midX - Self.sheetShift) / Self.sheetScale + bounds.midX, y: (point.y - Self.sheetTop) / Self.sheetScale)
  }

  /// Moves to a place `body` describes: 0 is where things were, 1 where they end up.
  private func animate(_ animated: Bool, _ seconds: Double = 0.28, _ body: @escaping @MainActor (CGFloat) -> Void) {
    if animated, steps != nil {
      steps?.add(seconds) { [weak self] p in self?.still { body(p) } }
      still { body(0) }
      return
    }
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    CATransaction.setAnimationDuration(seconds)
    CATransaction.setAnimationTimingFunction(Self.easeOut)
    body(1)
    CATransaction.commit()
  }

  /// How far into the stack things are, `p` of the way through opening or closing it.
  private func stacked(_ p: CGFloat) -> CGFloat { isStacked ? p : 1 - p }

  private func placeSheet(animated: Bool) {
    animate(animated) { [self] p in
      let s = stacked(p)
      let scale = 1 + (Self.sheetScale - 1) * s
      sheet.bounds = CGRect(origin: .zero, size: bounds.size)
      sheet.position = CGPoint(x: bounds.midX + Self.sheetShift * s, y: Self.sheetTop * s)
      sheet.setAffineTransform(CGAffineTransform(scaleX: scale, y: scale))
      sheet.cornerRadius = 16 / Self.sheetScale * s
      sheet.borderWidth = 0.5 / Self.sheetScale * s
    }
  }

  /// Up to four earlier days wait behind, each a step higher and a little smaller.
  private func placeCards(animated: Bool) {
    let behind = model.behind
    if cardLayers.map(\.summary) != behind || !animated {
      still {
        cards.sublayers?.forEach { $0.removeFromSuperlayer() }
        cardLayers = behind.enumerated().reversed().map { index, summary in
          let card = CALayer()
          card.anchorPoint = CGPoint(x: 0.5, y: 0)
          card.cornerCurve = .continuous
          card.backgroundColor = colors.card
          card.borderColor = colors.hairline
          fillCard(card, summary, step: index + 1)
          cards.addSublayer(card)
          placeCard(card, step: index + 1, stacked: stacked(animated ? 0 : 1))
          return (card, summary)
        }
      }
    }
    animate(animated) { [self] p in
      for (offset, entry) in cardLayers.enumerated() { placeCard(entry.layer, step: cardLayers.count - offset, stacked: stacked(p)) }
    }
  }

  private static func cardScale(_ step: Int) -> CGFloat { sheetScale * (1 - 0.035 * CGFloat(step)) }

  private func placeCard(_ card: CALayer, step: Int, stacked s: CGFloat) {
    let n = CGFloat(step)
    let scale = (1 - 0.01 * n) * (1 - s) + Self.cardScale(step) * s
    card.bounds = CGRect(origin: .zero, size: bounds.size)
    card.position = CGPoint(x: bounds.midX + Self.sheetShift * s, y: -6 * n * (1 - s) + (Self.sheetTop - n * Self.cardStep) * s)
    card.setAffineTransform(CGAffineTransform(scaleX: scale, y: scale))
    card.cornerRadius = 16 / scale
    card.borderWidth = 0.5 / scale
    card.opacity = Float((1 - 0.16 * (n - 1)) * s)
  }

  /// A card's visible edge: the day, and the threads that took most of it.
  private func fillCard(_ card: CALayer, _ summary: CanvasDaySummary, step: Int) {
    let cardScale = Self.cardScale(step)
    let date = Date(timeIntervalSince1970: summary.start)
    let name = NSMutableAttributedString(
      attributedString: CanvasText.line(date.formatted(.dateTime.weekday(.wide)), .systemFont(ofSize: 12.5, weight: .semibold), colors.ink))
    name.append(CanvasText.line("  " + date.formatted(.dateTime.day().month(.abbreviated)), .systemFont(ofSize: 12.5), colors.ink5))
    let threads = CanvasText.line(summary.threads.joined(separator: "   ·   "), .systemFont(ofSize: 12.5), colors.ink5, alignment: .right)
    let width = bounds.width * cardScale
    let left = CanvasText(), right = CanvasText()
    for text in [left, right] {
      text.contentsScale = scale
      card.addSublayer(text)
    }
    let half = max(0, width * 0.3)
    left.place(name, at: CGPoint(x: 20 / cardScale, y: 7 / cardScale), size: CGSize(width: half, height: 17), zoom: cardScale)
    right.place(
      threads, at: CGPoint(x: (20 + half) / cardScale, y: 7 / cardScale), size: CGSize(width: max(0, width - half - 40), height: 17), zoom: cardScale)
  }

  private func card(at point: CGPoint) -> CanvasDaySummary? {
    guard isStacked, point.y < Self.sheetTop else { return nil }
    for (offset, entry) in cardLayers.enumerated().reversed() {
      let step = cardLayers.count - offset
      let top = Self.sheetTop - CGFloat(step) * Self.cardStep
      let half = bounds.width * Self.cardScale(step) / 2
      if point.y >= top, point.y < top + Self.cardStep, abs(point.x - bounds.midX - Self.sheetShift) < half { return entry.summary }
    }
    return nil
  }

  // MARK: An open screen

  /// Where an open screen sits: as large as the space between the bars above and below allows.
  private func heroFrame(_ shot: CanvasShot) -> CGRect {
    let room = CGRect(x: 60, y: CanvasViewer.top, width: bounds.width - 120, height: bounds.height - CanvasViewer.top - CanvasViewer.bottom)
    let aspect = CGFloat(max(0.1, shot.aspect))
    let own = CGFloat(shot.pixelWidth) * CGFloat(shot.crop?.width ?? 1) * 1.25
    let width = max(1, min(room.width, room.height * aspect, own))
    return CGRect(x: room.midX - width / 2, y: room.midY - width / aspect / 2, width: width, height: width / aspect)
  }

  private func whole(_ shot: CanvasShot) -> CGRect {
    shot.crop.map { CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height) } ?? CGRect(x: 0, y: 0, width: 1, height: 1)
  }

  private func placeHero() {
    guard let opened else { return }
    still {
      hero.frame = heroFrame(opened.shot)
      hero.contentsRect = whole(opened.shot)
    }
  }

  private func showOpened() {
    let before = opened
    opened = model.opened
    guard let now = opened else { return close(before) }
    guard before?.thing != now.thing else {
      fillHero(now.shot)
      placeHero()
      return
    }
    setHover(nil)
    openedPlate = plates.first { $0.thing.id == now.thing.id && $0.block.thread.id == now.thread.id }
    still {
      hero.isHidden = false
      hero.removeAllAnimations()
    }
    fillHero(now.shot)
    placeHero()
    let animated = byClick && !reduceMotion
    animateVeil(to: 1, animated: animated)
    guard animated, let plate = openedPlate else { return }
    let from = viewFrame(of: plate)
    grow(from: from, fill: plate.thing.shots[now.index].fill(Double(from.width / from.height)), to: hero.frame, whole: whole(now.shot), back: false)
    still { plate.picture.isHidden = true }
  }

  private func close(_ before: CanvasModel.Opened?) {
    let animated = byClick && !reduceMotion
    animateVeil(to: 0, animated: animated)
    guard animated, let before, let plate = openedPlate, plate.plate.thing.shots.indices.contains(before.index) else {
      still {
        hero.isHidden = true
        hero.contents = nil
        openedPlate?.picture.isHidden = false
      }
      return
    }
    let to = viewFrame(of: plate)
    grow(from: to, fill: before.shot.fill(Double(to.width / to.height)), to: hero.frame, whole: whole(before.shot), back: true)
  }

  private func viewFrame(of plate: PlateLayers) -> CGRect {
    let frame = camera.toView(plate.plate.frame)
    guard isStacked else { return frame }
    let s = Self.sheetScale
    return CGRect(
      x: (frame.minX - bounds.midX) * s + bounds.midX + Self.sheetShift, y: frame.minY * s + Self.sheetTop, width: frame.width * s, height: frame.height * s)
  }

  private func animateVeil(to opacity: CGFloat, animated: Bool) {
    let from = CGFloat(veil.opacity)
    animate(animated, 0.2) { [self] p in veil.opacity = Float(from + (opacity - from) * p) }
  }

  /// The screen grows out of its plate (or shrinks back into it), from the part the plate shows to all of it.
  private func grow(from small: CGRect, fill: ScreenRect, to large: CGRect, whole: CGRect, back: Bool) {
    let part = CGRect(x: fill.x, y: fill.y, width: fill.width, height: fill.height)
    if steps != nil {
      let plate = openedPlate
      let radius = (openedPlate?.radius ?? 12) * camera.zoom
      steps?.add(back ? 0.2 : 0.24) { [weak self] p in
        guard let self else { return }
        let q = back ? 1 - p : p
        self.still {
          self.hero.frame = small.mixed(large, q)
          self.hero.contentsRect = part.mixed(whole, q)
          self.hero.cornerRadius = radius + (12 - radius) * q
          guard p == 1 else { return }
          plate?.picture.isHidden = false
          if back, self.opened == nil {
            self.hero.isHidden = true
            self.hero.contents = nil
          }
        }
      }
      return
    }
    func animation(_ key: String, _ a: Any, _ b: Any) -> CABasicAnimation {
      let animation = CABasicAnimation(keyPath: key)
      animation.fromValue = back ? b : a
      animation.toValue = back ? a : b
      return animation
    }
    let group = CAAnimationGroup()
    group.animations = [
      animation("position", CGPoint(x: small.midX, y: small.midY), CGPoint(x: large.midX, y: large.midY)),
      animation("bounds", CGRect(origin: .zero, size: small.size), CGRect(origin: .zero, size: large.size)),
      animation("contentsRect", part, whole),
      animation("cornerRadius", (openedPlate?.radius ?? 12) * camera.zoom, 12),
    ]
    group.duration = back ? 0.2 : 0.24
    group.timingFunction = Self.easeOut
    group.fillMode = .forwards
    group.isRemovedOnCompletion = !back
    let plate = openedPlate
    CATransaction.begin()
    CATransaction.setCompletionBlock { [weak self] in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.still {
          plate?.picture.isHidden = false
          guard back, self.opened == nil else { return }
          self.hero.isHidden = true
          self.hero.contents = nil
          self.hero.removeAllAnimations()
        }
      }
    }
    hero.add(group, forKey: "grow")
    CATransaction.commit()
  }

  private func fillHero(_ shot: CanvasShot) {
    if steps != nil {
      let image = ImageLoader.shared.now(url(shot.framePath ?? shot.thumbPath), maxPixels: FullFrame.maxPixels)
      return still { hero.contents = image?.canvasImage }
    }
    let thumb = url(shot.thumbPath)
    let frame = shot.framePath.map(url)
    let size = FullFrame.maxPixels
    if let frame, let image = ImageLoader.shared.cached(frame, maxPixels: size) {
      still { hero.contents = image.canvasImage }
      return
    }
    if let image = ImageLoader.shared.cached(thumb, maxPixels: 480) { still { hero.contents = image.canvasImage } }
    Task { [weak self] in
      if self?.hero.contents == nil, let image = await ImageLoader.shared.load(thumb, maxPixels: 480), let self, self.opened?.shot == shot {
        self.still { self.hero.contents = image.canvasImage }
      }
      guard let frame, let image = await ImageLoader.shared.load(frame, maxPixels: size), let self, self.opened?.shot == shot else { return }
      self.still { self.hero.contents = image.canvasImage }
    }
  }

  // MARK: Hands

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    tracking = area
  }

  private func point(_ event: NSEvent) -> CGPoint { convert(event.locationInWindow, from: nil) }

  private func plate(at point: CGPoint) -> PlateLayers? {
    if isStacked, point.y < Self.sheetTop { return nil }
    let canvas = camera.toCanvas(sheetPoint(point))
    return plates.first { $0.plate.frame.contains(canvas) }
  }

  override func mouseMoved(with event: NSEvent) {
    let point = point(event)
    guard opened == nil, drag == nil else { return setHover(nil) }
    let plate = plate(at: point)
    setHover(plate)
    if let plate { skim(plate, at: point) }
  }

  override func mouseExited(with event: NSEvent) { setHover(nil) }

  private func setHover(_ plate: PlateLayers?) {
    guard plate !== hovered else { return }
    if let old = hovered {
      still { old.isSkimming = false }
      if old.shown != old.thing.cover {
        old.isSharp = false
        load(old, old.thing.cover)
      }
      sharpen()
    }
    hovered = plate
    guard let plate, plate.thing.shots.count > 1 else { return }
    // The screens to skim over, decoded ahead.
    let urls = plate.thing.shots.map { url($0.thumbPath) }
    Task { for url in urls { _ = await ImageLoader.shared.load(url, maxPixels: 480) } }
  }

  /// The pointer's place across a picture is a moment of the thing's day.
  private func skim(_ plate: PlateLayers, at point: CGPoint) {
    let shots = plate.thing.shots
    guard shots.count > 1 else { return }
    let canvas = camera.toCanvas(sheetPoint(point))
    let fraction = min(max((canvas.x - plate.plate.frame.minX) / plate.plate.frame.width, 0), 0.9999)
    let index = Int(fraction * CGFloat(shots.count))
    still {
      plate.isSkimming = true
      plate.mark(fraction, at: shots[index].at, zoom: camera.zoom)
    }
    guard index != plate.shown else { return }
    if steps != nil {
      plate.show(nil, index: index)
      return sharpenNow()
    }
    plate.isSharp = false
    let url = url(shots[index].thumbPath)
    if let image = ImageLoader.shared.cached(url, maxPixels: 480) { still { plate.show(image.canvasImage, index: index) } }
  }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    guard opened == nil else {
      if !hero.frame.contains(point(event)) { model.opened = nil }
      return
    }
    stop()
    let point = point(event)
    if let summary = card(at: point) { return model.go(model.date(summary)) }
    drag = (point, camera, point, event.timestamp, .zero, false)
  }

  override func mouseDragged(with event: NSEvent) {
    guard var drag else { return }
    let point = point(event)
    if !drag.moved {
      guard hypot(point.x - drag.start.x, point.y - drag.start.y) >= 4 else { return }
      drag.moved = true
      isWholeDay = false
      setHover(nil)
      NSCursor.closedHand.push()
    }
    let s = isStacked ? Self.sheetScale : 1
    let elapsed = max(event.timestamp - drag.at, 0.001)
    drag.velocity = CGPoint(x: (point.x - drag.last.x) / elapsed, y: (point.y - drag.last.y) / elapsed)
    drag.last = point
    drag.at = event.timestamp
    camera.x = drag.camera.x + (point.x - drag.start.x) / s
    camera.y = drag.camera.y + (point.y - drag.start.y) / s
    self.drag = drag
    apply()
  }

  override func mouseUp(with event: NSEvent) {
    guard let drag else { return }
    self.drag = nil
    if drag.moved {
      NSCursor.pop()
      let s = isStacked ? Self.sheetScale : 1
      if event.timestamp - drag.at < 0.08 {
        // Thrown: it slows as a scroll view does.
        var target = camera
        target.x += drag.velocity.x * 0.325 / s
        target.y += drag.velocity.y * 0.325 / s
        move(to: held(target), animated: true, coast: 0.325)
      } else {
        settle()
      }
      return
    }
    let point = point(event)
    if let plate = plate(at: point) { return model.open(plate.thing, in: plate.block.thread, at: plate.shown) }
    let canvas = camera.toCanvas(sheetPoint(point))
    if let block = blocks.first(where: { $0.block.nameFrame.contains(canvas) }) { return show(block.block) }
    if camera.zoom >= 0.5, let block = blocks.first(where: { !$0.block.also.isEmpty && $0.block.alsoFrame.contains(canvas) }) {
      return model.open(block.block.also[0], in: block.block.thread, at: 0)
    }
    if event.clickCount == 2 { showWholeDay() }
  }

  override func scrollWheel(with event: NSEvent) {
    if opened != nil { return swipeShots(event) }
    if event.modifierFlags.contains(.command) {
      stop()
      isWholeDay = false
      camera = camera.zoomed(by: exp(event.scrollingDeltaY * 0.006), at: sheetPoint(point(event)))
      return apply()
    }
    let s = isStacked ? Self.sheetScale : 1
    let step: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 12
    if event.scrollingDeltaX != 0 || event.scrollingDeltaY != 0 {
      stop()
      isWholeDay = false
      var next = camera
      next.x += event.scrollingDeltaX * step / s
      next.y += event.scrollingDeltaY * step / s
      // Past the edge it follows the fingers less and less, and comes back when they let go.
      let inside = held(next)
      next.x = inside.x + (next.x - inside.x) * 0.55
      next.y = inside.y + (next.y - inside.y) * 0.55
      camera = next
      apply()
      if let plate = hovered, plate.isSkimming { setHover(nil) }
    }
    let ended = event.phase == .ended || event.phase == .cancelled || event.momentumPhase == .ended
    if ended || (event.phase.isEmpty && event.momentumPhase.isEmpty) { settle() }
  }

  /// Two fingers sideways step through an open thing's screens.
  private func swipeShots(_ event: NSEvent) {
    if event.phase == .began { swipe = 0 }
    guard event.momentumPhase.isEmpty else { return }
    swipe += event.scrollingDeltaX
    while abs(swipe) >= 30 {
      model.stepShot(swipe > 0 ? -1 : 1)
      swipe -= swipe > 0 ? 30 : -30
    }
  }

  private func settle() {
    let held = held(camera)
    if held != camera { move(to: held, animated: true) }
  }

  override func magnify(with event: NSEvent) {
    guard opened == nil else { return }
    stop()
    isWholeDay = false
    camera = camera.zoomed(by: 1 + event.magnification, at: sheetPoint(point(event)))
    setHover(nil)
    apply()
    if event.phase == .ended || event.phase == .cancelled { settle() }
  }

  /// Two-finger double tap: in to the thread under the pointer, or out to the whole day.
  override func smartMagnify(with event: NSEvent) {
    guard opened == nil else { return }
    let canvas = camera.toCanvas(sheetPoint(point(event)))
    if isWholeDay, let block = blocks.first(where: { $0.block.frame.contains(canvas) }) {
      show(block.block)
    } else {
      showWholeDay()
    }
  }

  func openHovered() -> Bool {
    guard let hovered else { return false }
    model.open(hovered.thing, in: hovered.block.thread, at: hovered.shown)
    return true
  }

  private func distance(_ rect: CGRect, _ point: CGPoint) -> CGFloat {
    hypot(max(rect.minX - point.x, 0, point.x - rect.maxX), max(rect.minY - point.y, 0, point.y - rect.maxY))
  }

  // MARK: Accessibility

  override func isAccessibilityElement() -> Bool { false }
  override func accessibilityRole() -> NSAccessibility.Role? { .group }
  override func accessibilityLabel() -> String? { "Canvas" }

  override func accessibilityChildren() -> [Any]? {
    plates.map { plate in
      let element = PlateElement()
      let thing = plate.thing
      element.setAccessibilityParent(self)
      element.setAccessibilityRole(.button)
      element.setAccessibilityLabel(
        [thing.title, thing.place, canvasDuration(thing.seconds), plate.block.thread.name].filter { !$0.isEmpty }.joined(separator: ", "))
      element.setAccessibilityFrame(window?.convertToScreen(convert(viewFrame(of: plate), to: nil)) ?? .zero)
      element.press = { [weak self, weak plate] in
        guard let self, let plate else { return }
        self.model.open(plate.thing, in: plate.block.thread, at: plate.thing.cover)
      }
      return element
    }
  }
}

private final class PlateElement: NSAccessibilityElement {
  var press: (@MainActor @Sendable () -> Void)?
  override func accessibilityPerformPress() -> Bool {
    guard let press else { return false }
    MainActor.assumeIsolated { press() }
    return true
  }
}

/// What moves while frames are drawn one by one.
@MainActor
struct CanvasSteps {
  /// Whether what is done next is done with the pointer (moves) or with a key (jumps).
  var byClick = true
  private var moving: [(elapsed: Double, seconds: Double, body: @MainActor (CGFloat) -> Void)] = []

  mutating func add(_ seconds: Double, _ body: @escaping @MainActor (CGFloat) -> Void) { moving.append((0, seconds, body)) }

  mutating func advance(_ seconds: Double) {
    for index in moving.indices {
      moving[index].elapsed += seconds
      moving[index].body(Self.easeOut(min(1, moving[index].elapsed / moving[index].seconds)))
    }
    moving.removeAll { $0.elapsed >= $0.seconds }
  }

  /// `CanvasView.easeOut`, worked out by hand.
  private static func easeOut(_ x: Double) -> CGFloat {
    guard x > 0, x < 1 else { return CGFloat(min(max(x, 0), 1)) }
    func curve(_ a: Double, _ b: Double, _ t: Double) -> Double { 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t }
    var (low, high) = (0.0, 1.0)
    for _ in 0..<30 {
      let middle = (low + high) / 2
      if curve(0.23, 0.32, middle) < x { low = middle } else { high = middle }
    }
    return CGFloat(curve(1, 1, (low + high) / 2))
  }
}

extension CGRect {
  /// `p` of the way to `other`.
  func mixed(_ other: CGRect, _ p: CGFloat) -> CGRect {
    CGRect(
      x: minX + (other.minX - minX) * p, y: minY + (other.minY - minY) * p, width: width + (other.width - width) * p,
      height: height + (other.height - height) * p)
  }
}

extension NSImage {
  var canvasImage: CGImage? { cgImage(forProposedRect: nil, context: nil, hints: nil) }
}

extension PlaceIcons {
  /// A thing's icon: its site's, else its app's. A site's dark glyph takes the ink.
  func canvasIcon(_ icon: CanvasIcon, app: String?, ink: CGColor) -> NSImage? {
    let place: Place =
      switch icon {
      case .site(let host): .site(host)
      case .app(let bundleID): .app(bundleID)
      }
    guard let image = image(for: place, app: app) else { return nil }
    guard case .site(let host) = place, sites[host] != nil, darkGlyphs.contains(host) else { return image }
    let tinted = NSImage(size: image.size)
    tinted.lockFocus()
    image.draw(in: NSRect(origin: .zero, size: image.size))
    NSColor(cgColor: ink)?.set()
    NSRect(origin: .zero, size: image.size).fill(using: .sourceAtop)
    tinted.unlockFocus()
    return tinted
  }
}
