import CoreGraphics
import Foundation

/// Where everything on a day's canvas goes, in the canvas's own points (at 100 %), origin top left.
///
/// A thread is a block: its name, its main thing large, the rest beneath it. Blocks are as wide as the time they took
/// and fill columns from the top, most time first; the number of columns is the one that shows the day largest.
public struct CanvasLayout: Sendable, Equatable {
  public struct Plate: Sendable, Equatable {
    public var thing: CanvasThing
    /// The picture.
    public var frame: CGRect
    /// A thing beneath its thread's main one, or the main one of a short thread.
    public var isSmall: Bool
    /// The room for its caption under the picture.
    public var captionHeight: CGFloat
  }

  public struct Block: Sendable, Equatable {
    public enum Size: Sendable { case large, medium, small }
    public var thread: CanvasThread
    public var size: Size
    public var frame: CGRect
    /// The thread's name sits at the bottom of this.
    public var nameFrame: CGRect
    public var plates: [Plate]
    /// Things with no picture of their own here, named on one line.
    public var also: [CanvasThing]
    public var alsoFrame: CGRect
  }

  public var blocks: [Block]
  public var size: CGSize

  public static let aspect: CGFloat = 1.6
  static let medium: CGFloat = 640, gap: CGFloat = 20, gutter: CGFloat = 130, blockGap: CGFloat = 72, head: CGFloat = 176, caption: CGFloat = 46
  static let small = (medium - gap) / 2, large = medium * 2 + gutter
  /// A thread this long whose main thing took this much of it is drawn over two columns.
  static let largeSeconds = 5400.0, largeThingSeconds = 3600.0
  /// A shorter thread is a half-width block.
  static let mediumSeconds = 480.0
  /// What was only passed through gets a picture from this long.
  static let restSeconds = 180.0

  public init(_ day: CanvasDay, fitting viewport: CGSize) {
    let drafts = day.threads.map(Self.block)
    guard !drafts.isEmpty else {
      blocks = []
      size = .zero
      return
    }
    let least = drafts.map(\.span).max() ?? 1
    var best: (layout: CanvasLayout, zoom: CGFloat)?
    for columns in least...9 {
      let layout = Self.pack(drafts, columns: columns)
      let zoom = min(max(viewport.width, 1) / layout.size.width, max(viewport.height, 1) / layout.size.height)
      if best.map({ zoom > $0.zoom + 0.0001 }) ?? true { best = (layout, zoom) }
    }
    self = best!.layout
  }

  private init(blocks: [Block], size: CGSize) {
    self.blocks = blocks
    self.size = size
  }

  public static func pictureHeight(_ width: CGFloat) -> CGFloat { (width / aspect).rounded() }

  private static func captionHeight(_ width: CGFloat) -> CGFloat { width > 1000 ? 92 : width == medium ? 70 : caption }

  private struct Draft {
    var block: Block
    var span: Int
  }

  /// A thread's block at the origin.
  private static func block(_ thread: CanvasThread) -> Draft {
    let things = thread.things.filter { $0.kind != .rest || $0.seconds >= restSeconds || thread.things.count == 1 }
    let passed = thread.things.filter { thing in !things.contains { $0.id == thing.id } }
    let main = things[0]
    let size: Block.Size =
      thread.seconds >= largeSeconds && main.seconds >= largeThingSeconds ? .large : thread.seconds >= mediumSeconds ? .medium : .small
    let width = size == .large ? large : size == .medium ? medium : small
    var y = head
    var plates = [
      Plate(thing: main, frame: CGRect(x: 0, y: y, width: width, height: pictureHeight(width)), isSmall: size == .small, captionHeight: captionHeight(width))
    ]
    y += pictureHeight(width) + captionHeight(width)
    let perRow = size == .large ? 4 : size == .medium ? 2 : 1
    let smallWidth = (width - gap * CGFloat(perRow - 1)) / CGFloat(perRow)
    let shown = things.dropFirst().prefix(size == .large ? 8 : size == .medium ? 6 : 1)
    for (index, thing) in shown.enumerated() {
      let frame = CGRect(
        x: CGFloat(index % perRow) * (smallWidth + gap), y: y + CGFloat(index / perRow) * (pictureHeight(smallWidth) + caption),
        width: smallWidth, height: pictureHeight(smallWidth))
      plates.append(Plate(thing: thing, frame: frame, isSmall: true, captionHeight: caption))
    }
    y += CGFloat((shown.count + perRow - 1) / perRow) * (pictureHeight(smallWidth) + caption)
    let also = Array(things.dropFirst(1 + shown.count)) + passed
    var alsoFrame = CGRect.zero
    if !also.isEmpty {
      alsoFrame = CGRect(x: 0, y: y - 4, width: width, height: 20)
      y += 26
    }
    let nameWidth = width + (size == .small ? 0 : 70)
    return Draft(
      block: Block(
        thread: thread, size: size, frame: CGRect(x: 0, y: 0, width: width, height: y),
        nameFrame: CGRect(x: 0, y: 0, width: nameWidth, height: head - 16), plates: plates, also: also, alsoFrame: alsoFrame),
      span: size == .large ? 2 : 1)
  }

  /// Each block in the column that is shortest so far; two half-width blocks of like height share a column's width.
  private static func pack(_ drafts: [Draft], columns: Int) -> CanvasLayout {
    var tops = [CGFloat](repeating: 0, count: columns)
    var blocks: [Block] = []
    var half: (block: Block, column: Int)?
    for draft in drafts {
      let block = draft.block
      if block.size == .small, let left = half, abs(left.block.frame.height - block.frame.height) < 320 {
        blocks.append(block.moved(to: CGPoint(x: left.block.frame.minX + small + gap, y: left.block.frame.minY)))
        tops[left.column] = max(tops[left.column], left.block.frame.minY + block.frame.height + blockGap)
        half = nil
        continue
      }
      var column = 0
      var top = CGFloat.infinity
      for first in 0...(columns - draft.span) {
        let here = tops[first..<(first + draft.span)].max()!
        if here < top - 1 { (column, top) = (first, here) }
      }
      let placed = block.moved(to: CGPoint(x: CGFloat(column) * (medium + gutter), y: top))
      blocks.append(placed)
      for index in column..<(column + draft.span) { tops[index] = top + block.frame.height + blockGap }
      if block.size == .small { half = (placed, column) }
    }
    let width = CGFloat(columns) * medium + CGFloat(columns - 1) * gutter
    return CanvasLayout(blocks: blocks, size: CGSize(width: width, height: tops.max()! - blockGap))
  }
}

extension CanvasLayout.Block {
  func moved(to point: CGPoint) -> Self {
    var copy = self
    copy.frame = frame.offsetBy(dx: point.x, dy: point.y)
    copy.nameFrame = nameFrame.offsetBy(dx: point.x, dy: point.y)
    copy.alsoFrame = alsoFrame.offsetBy(dx: point.x, dy: point.y)
    copy.plates = plates.map { plate in
      var plate = plate
      plate.frame = plate.frame.offsetBy(dx: point.x, dy: point.y)
      return plate
    }
    return copy
  }
}
