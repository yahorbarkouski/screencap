import AppKit
import ScreencapCore
import SwiftUI

/// The canvas's colours, resolved for the appearance it is drawn in.
@MainActor
struct CanvasColors {
  let page, ink, ink4, ink5, wash, hairline, card: CGColor

  init(_ appearance: NSAppearance) {
    func color(_ color: Color) -> CGColor {
      var resolved = CGColor(gray: 0, alpha: 1)
      appearance.performAsCurrentDrawingAppearance { resolved = NSColor(color).cgColor }
      return resolved
    }
    page = color(Theme.page)
    ink = color(Theme.ink)
    ink4 = color(Theme.ink4)
    ink5 = color(Theme.ink5)
    wash = color(Theme.wash)
    hairline = color(Theme.hairline)
    let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    card = dark ? CGColor(gray: 0.15, alpha: 1) : CGColor(gray: 0.957, alpha: 1)
  }
}

/// Time on the canvas: whatever is there took at least a minute's worth of looking.
func canvasDuration(_ seconds: Double) -> String { durationText(max(1, seconds / 60)) }

/// A layer whose changes never animate by themselves.
class StillLayer: CALayer {
  override init() { super.init() }
  override init(layer: Any) { super.init(layer: layer) }
  required init?(coder: NSCoder) { nil }
  override func action(forKey event: String) -> CAAction? { nil }
}

/// Text drawn at its size on screen: it sits in the canvas's coordinates but undoes the canvas's zoom, so it is sharp
/// at any zoom and wraps and truncates to the room it has on screen. Drawn with AppKit, which sets type as the rest of
/// the app does; `CATextLayer` drops the end of a wrapped line it has to cut.
final class CanvasText: StillLayer {
  private var text = NSAttributedString()

  override init() {
    super.init()
    anchorPoint = .zero
    needsDisplayOnBoundsChange = true
  }
  override init(layer: Any) { super.init(layer: layer) }
  required init?(coder: NSCoder) { nil }

  /// Puts `text` at `origin` (canvas points) in a box of `size` (points on screen). Text that is cut to its room gets a
  /// width in steps, so a pinch redraws a line a few times a second rather than on every frame.
  func place(_ text: NSAttributedString, at origin: CGPoint, size: CGSize, zoom: CGFloat, cuts: Bool = false) {
    if self.text != text {
      self.text = text
      setNeedsDisplay()
    }
    let width = cuts ? (size.width / 6).rounded(.down) * 6 : size.width.rounded(.down)
    let box = CGRect(origin: .zero, size: CGSize(width: max(width, 0), height: max(size.height.rounded(.up), 0)))
    if bounds != box { bounds = box }
    position = origin
    setAffineTransform(CGAffineTransform(scaleX: 1 / zoom, y: 1 / zoom))
  }

  override func draw(in context: CGContext) {
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
    if !contentsAreFlipped() {
      context.translateBy(x: 0, y: bounds.height)
      context.scaleBy(x: 1, y: -1)
    }
    text.draw(with: bounds, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    NSGraphicsContext.restoreGraphicsState()
  }

  /// `string` with a paragraph that cuts its last line with an ellipsis.
  static func line(_ string: String, _ font: NSFont, _ color: CGColor, alignment: NSTextAlignment = .left, wraps: Bool = false, kern: CGFloat = 0)
    -> NSAttributedString
  {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = wraps ? .byWordWrapping : .byTruncatingTail
    paragraph.alignment = alignment
    if wraps { paragraph.lineHeightMultiple = 0.95 }
    return NSAttributedString(
      string: string, attributes: [.font: font, .foregroundColor: NSColor(cgColor: color) ?? .labelColor, .paragraphStyle: paragraph, .kern: kern])
  }
}

/// One thing: its picture, its caption, and when in the day it was on screen.
@MainActor
final class PlateLayers {
  let plate: CanvasLayout.Plate
  let block: CanvasLayout.Block
  let root = StillLayer()
  let picture = StillLayer()
  private let caption = StillLayer()
  private let icon = StillLayer()
  private let title = CanvasText()
  private let time = CanvasText()
  private let strip = StillLayer()
  private let marks = CAShapeLayer()
  private let head = StillLayer()
  private let pin = StillLayer()
  private let clock = CanvasText()
  private let clockBack = StillLayer()
  private let span: ClosedRange<Double>
  private(set) var shown: Int
  /// The picture is the full frame rather than the thumbnail.
  var isSharp = false
  private var titleStyle: (size: CGFloat, dark: CGColor)?
  private var titleText = NSAttributedString()
  private var timeText = NSAttributedString()

  init(_ plate: CanvasLayout.Plate, block: CanvasLayout.Block, span: ClosedRange<Double>, scale: CGFloat) {
    self.plate = plate
    self.block = block
    self.span = span
    shown = plate.thing.cover
    root.anchorPoint = .zero
    root.frame = plate.frame
    picture.frame = CGRect(origin: .zero, size: plate.frame.size)
    picture.cornerRadius = radius
    picture.cornerCurve = .continuous
    picture.masksToBounds = true
    picture.contentsGravity = .resize
    picture.minificationFilter = .trilinear
    root.addSublayer(picture)
    for layer in [caption, strip] {
      layer.anchorPoint = .zero
      root.addSublayer(layer)
    }
    icon.contentsGravity = .resizeAspect
    icon.masksToBounds = true
    caption.addSublayer(icon)
    for text in [title, time, clock] { text.contentsScale = scale }
    caption.addSublayer(title)
    caption.addSublayer(time)
    strip.masksToBounds = true
    marks.actions = ["path": NSNull(), "fillColor": NSNull()]
    strip.addSublayer(marks)
    pin.isHidden = true
    strip.addSublayer(pin)
    head.backgroundColor = .white
    head.shadowOpacity = 0.4
    head.shadowRadius = 1
    head.shadowOffset = .zero
    head.isHidden = true
    picture.addSublayer(head)
    clockBack.backgroundColor = CGColor(gray: 0, alpha: 0.62)
    clockBack.isHidden = true
    clockBack.addSublayer(clock)
    picture.addSublayer(clockBack)
  }

  var thing: CanvasThing { plate.thing }
  var radius: CGFloat { plate.frame.width > 1000 ? 16 : plate.frame.width > 400 ? 12 : 9 }

  // MARK: Picture

  func show(_ image: CGImage?, index: Int) {
    shown = index
    let part = thing.shots[index].fill(Double(plate.frame.width / plate.frame.height))
    picture.contents = image
    picture.contentsRect = CGRect(x: part.x, y: part.y, width: part.width, height: part.height)
  }

  /// How many pixels wide the whole screenshot would be for the part shown to be sharp.
  func pixelsNeeded(zoom: CGFloat, scale: CGFloat) -> CGFloat {
    plate.frame.width * zoom * scale / max(0.1, CGFloat(thing.shots[shown].fill(Double(CanvasLayout.aspect)).width))
  }

  // MARK: Looks

  func color(_ colors: CanvasColors) {
    picture.backgroundColor = colors.wash
    picture.borderColor = colors.hairline
    strip.backgroundColor = colors.wash
    marks.fillColor = colors.ink4
    pin.backgroundColor = colors.ink
    titleStyle = nil
  }

  func setIcon(_ image: NSImage?) { icon.contents = image }

  /// Sizes everything under the picture for `zoom`: text keeps a readable size however far out, up to the room it has.
  func fit(zoom: CGFloat, colors: CanvasColors) {
    let width = plate.frame.width, height = plate.frame.height
    picture.borderWidth = min(max(0.5, 1 / zoom), 3)
    strip.isHidden = zoom < 0.5
    caption.isHidden = plate.isSmall && zoom < 0.5
    guard !caption.isHidden else { return }
    let size = min(plate.isSmall ? 14 : width > 1000 ? 44 : 30, max(13, 11.5 / zoom))
    let drop = max(8, size * 0.45), line = size * 1.5, iconSide = size * 1.25, gap = size * 0.45
    caption.frame = CGRect(x: 0, y: height + drop, width: width, height: line)
    icon.frame = CGRect(x: 0, y: (line - iconSide) / 2, width: iconSide, height: iconSide)
    icon.cornerRadius = iconSide * 0.22
    let points = (size * zoom * 4).rounded() / 4
    if titleStyle?.size != points || titleStyle?.dark != colors.ink {
      titleStyle = (points, colors.ink)
      let text = NSMutableAttributedString(attributedString: CanvasText.line(thing.title, .systemFont(ofSize: points, weight: .medium), colors.ink))
      if !thing.place.isEmpty { text.append(CanvasText.line("  " + thing.place, .systemFont(ofSize: points), colors.ink5)) }
      titleText = text
      timeText = CanvasText.line(
        canvasDuration(thing.seconds), .monospacedSystemFont(ofSize: points * 0.94, weight: .regular), colors.ink5, alignment: .right)
    }
    let textHeight = titleText.size().height
    let top = (line - textHeight / zoom) / 2
    let timeWidth = ceil(timeText.size().width) + 2
    time.place(timeText, at: CGPoint(x: width - timeWidth / zoom, y: top), size: CGSize(width: timeWidth, height: textHeight), zoom: zoom)
    let left = iconSide + gap
    title.place(titleText, at: CGPoint(x: left, y: top), size: CGSize(width: (width - left) * zoom - timeWidth - 8, height: textHeight), zoom: zoom, cuts: true)

    let thick = min(5, max(3, 2 / zoom))
    strip.frame = CGRect(x: 0, y: height + drop + line + 4, width: width, height: thick)
    strip.cornerRadius = thick / 2
    guard !strip.isHidden else { return }
    let path = CGMutablePath()
    let length = max(1, span.upperBound - span.lowerBound)
    for visit in thing.visits {
      let start = CGFloat((visit.lowerBound - span.lowerBound) / length) * width
      let long = max(2 / zoom, CGFloat((visit.upperBound - visit.lowerBound) / length) * width)
      path.addRect(CGRect(x: start, y: 0, width: long, height: thick))
    }
    marks.path = path
  }

  // MARK: Skimming

  var isSkimming = false {
    didSet {
      for layer in [head, pin, clockBack] { layer.isHidden = !isSkimming }
    }
  }

  /// Marks the pointer's place across the picture, and the moment it stands for in the day.
  func mark(_ fraction: CGFloat, at moment: Double, zoom: CGFloat) {
    let width = plate.frame.width, height = plate.frame.height
    head.frame = CGRect(x: width * fraction - 1 / zoom, y: 0, width: 2 / zoom, height: height)
    let text = CanvasText.line(clockText(moment), .monospacedDigitSystemFont(ofSize: 11, weight: .medium), .white, alignment: .center)
    let size = CGSize(width: ceil(text.size().width) + 14, height: 19)
    clockBack.frame = CGRect(
      x: width - (size.width + 8) / zoom, y: height - (size.height + 8) / zoom, width: size.width / zoom, height: size.height / zoom)
    clockBack.cornerRadius = 6 / zoom
    clock.place(text, at: CGPoint(x: 0, y: 2.5 / zoom), size: CGSize(width: size.width, height: 15), zoom: zoom)
    let along = CGFloat((moment - span.lowerBound) / max(1, span.upperBound - span.lowerBound)) * width
    pin.frame = CGRect(x: along - 1.5 / zoom, y: 0, width: 3 / zoom, height: strip.bounds.height)
  }
}

/// A thread's name over its things, and the line naming the things with no picture.
@MainActor
final class BlockLayers {
  let block: CanvasLayout.Block
  let name = CanvasText()
  private let time = CanvasText()
  let also = CanvasText()
  private var style: (size: CGFloat, ink: CGColor)?
  private var nameText = NSAttributedString()

  init(_ block: CanvasLayout.Block, scale: CGFloat) {
    self.block = block
    for text in [name, time, also] { text.contentsScale = scale }
  }

  var layers: [CALayer] { block.also.isEmpty ? [name, time] : [name, time, also] }

  func color() { style = nil }

  func fit(zoom: CGFloat, colors: CanvasColors) {
    let box = block.nameFrame
    let (cap, base): (CGFloat, CGFloat) =
      switch block.size {
      case .large: (80, 24)
      case .medium: (52, 17)
      case .small: (44, 17)
      }
    let size = min(cap, max(22, base / zoom))
    let points = (size * zoom * 4).rounded() / 4
    if style?.size != points || style?.ink != colors.ink {
      style = (points, colors.ink)
      nameText = CanvasText.line(block.thread.name, .systemFont(ofSize: points, weight: .semibold), colors.ink, wraps: true, kern: -0.018 * points)
    }
    let small = max(12, min(size * 0.5, 11 / zoom))
    let timeText = CanvasText.line(canvasDuration(block.thread.seconds), .monospacedSystemFont(ofSize: small * zoom, weight: .regular), colors.ink5)
    let timeSize = timeText.size()
    let timeTop = box.maxY - timeSize.height / zoom
    time.place(timeText, at: CGPoint(x: box.minX, y: timeTop), size: CGSize(width: box.width * zoom, height: timeSize.height), zoom: zoom)
    let width = (box.width * zoom / 6).rounded(.down) * 6
    let oneLine = nameText.size().height
    let needed = nameText.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin]).height
    let height = ceil(min(needed, oneLine * 2)) + 1
    name.place(nameText, at: CGPoint(x: box.minX, y: timeTop - (height + size * 0.1 * zoom) / zoom), size: CGSize(width: width, height: height), zoom: zoom, cuts: true)
    guard !block.also.isEmpty else { return }
    also.isHidden = zoom < 0.5
    guard !also.isHidden else { return }
    var seen = Set<String>()
    let titles = block.also.map(\.title).filter { seen.insert($0).inserted }.joined(separator: ", ")
    let alsoText = CanvasText.line("Also " + titles, .systemFont(ofSize: 13 * zoom), colors.ink5)
    also.place(alsoText, at: block.alsoFrame.origin, size: CGSize(width: block.alsoFrame.width * zoom, height: 18 * zoom), zoom: zoom, cuts: true)
  }
}
