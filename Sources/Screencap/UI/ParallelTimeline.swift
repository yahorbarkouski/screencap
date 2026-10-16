import ScreencapCore
import SwiftUI

/// How the timeline is drawn; the Timeline page sets these.
struct TimelineOptions: Equatable {
  /// Points of height per minute.
  var zoom: CGFloat = 2.2
  /// Columns before the rest share one.
  var columns = 6
  /// A thread's activities closer than this draw as one block.
  var mergeMinutes: Double = 5
}

/// The day as threads side by side, time flowing down: a column for each of the day's biggest threads and one for the
/// rest. A thread's activities with less than `mergeMinutes` between them draw as one block, titled by its longest
/// activity; a thin line joins its blocks while the thread is going on (no gap over `runGap`). Threads kept up in
/// parallel show as columns busy at the same height. Breaks longer than `breakGap` fold into a short band.
/// `ParallelTimeline.Header` names the columns and stays pinned.
struct ParallelTimeline: View {
  let model: AppModel
  var options = TimelineOptions()
  @State private var width: CGFloat = 900
  @State private var pointer: CGPoint?
  /// The part of the timeline the page shows, in its own coordinates. Kept outside the view's state, so scrolling
  /// does not redraw the timeline; the hover card reads it to stay in view.
  @State private var viewport = Viewport()

  final class Viewport {
    var visible: CGRect = .zero
  }

  static let runGap: Double = 40 * 60
  static let breakGap: Double = 25 * 60
  static let foldedBreak: CGFloat = 34
  static let gutter: CGFloat = 58
  static let minColumnWidth: CGFloat = 120

  var body: some View {
    let layout = Layout(model: model, width: width, options: options)
    let hovered = pointer.flatMap { layout.activity(at: $0) }
    let lit = hovered?.threadID ?? model.hoveredThreadID
    ZStack(alignment: .topLeading) {
      Canvas { context, size in draw(layout, lit: lit, in: &context, width: size.width) }
        .frame(height: layout.height)
        .contentShape(Rectangle())
        .onContinuousHover { phase in
          switch phase {
          case .active(let point): pointer = point
          case .ended: pointer = nil
          }
        }
        .onTapGesture(coordinateSpace: .local) { location in
          if let activity = layout.activity(at: location) { model.select(activity) }
        }
      if let hovered, let pointer {
        // The screenshot on screen at the pointer's moment, from the hovered thread's own activity.
        let moment = min(max(layout.t(pointer.y), hovered.startAt), hovered.endAt)
        let capture = model.capture(of: hovered, at: moment)
        StripPreview(model: model, activity: hovered, capture: capture, at: moment, width: Self.cardWidth)
          .offset(x: min(max(0, pointer.x - Self.cardWidth / 2), max(0, width - Self.cardWidth)), y: cardY(pointer.y))
          .allowsHitTesting(false)
      }
    }
    .frame(maxWidth: .infinity, minHeight: layout.height, alignment: .topLeading)
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    .onGeometryChange(for: CGRect.self) { $0.bounds(of: .scrollView) ?? .zero } action: { viewport.visible = $0 }
  }

  static let cardWidth: CGFloat = 280
  /// The card's height at `cardWidth`: a 16:10 screenshot, the thread and time, the title, padding.
  static let cardHeight: CGFloat = (cardWidth - 16) * 10 / 16 + 70
  /// The pinned column titles cover the top of the page's view.
  static let pinnedHeader: CGFloat = 64

  /// Below the pointer when the card fits there in view, else above it, else as far in view as it goes.
  func cardY(_ pointerY: CGFloat) -> CGFloat {
    let visible = viewport.visible
    guard visible.height > 0 else { return pointerY + 16 }
    let top = visible.minY + Self.pinnedHeader, bottom = visible.maxY - 8
    let below = pointerY + 16, above = pointerY - 16 - Self.cardHeight
    if below + Self.cardHeight <= bottom { return below }
    if above >= top { return above }
    return max(top, bottom - Self.cardHeight)
  }

  func draw(_ layout: Layout, lit: Int64?, in context: inout GraphicsContext, width: CGFloat) {
    let graph = CGRect(x: Self.gutter, y: 0, width: width - Self.gutter, height: layout.height)
    for index in layout.columns.indices {
      context.fill(Path(CGRect(x: layout.columnX(index), y: 0, width: 0.5, height: layout.height)), with: .color(Theme.hairline.opacity(0.6)))
    }
    for (t, y) in layout.hourMarks {
      context.draw(Text(clockText(t)).font(.mono(11)).foregroundStyle(Theme.ink6), at: CGPoint(x: 4, y: y), anchor: .leading)
      context.fill(Path(CGRect(x: graph.minX - 6, y: y, width: graph.width + 6, height: 0.5)), with: .color(Theme.hairline))
    }
    for fold in layout.folds {
      context.fill(
        Path(roundedRect: CGRect(x: graph.minX - 6, y: fold.y + 7, width: graph.width + 6, height: Self.foldedBreak - 14), cornerRadius: 7),
        with: .color(Theme.wash))
      context.draw(
        Text("Away \(durationText(fold.minutes))").font(.ui(11)).foregroundStyle(Theme.ink5),
        at: CGPoint(x: 4, y: fold.y + Self.foldedBreak / 2), anchor: .leading)
    }
    let barWidth = max(24, layout.columnWidth - 16)
    for (index, column) in layout.columns.enumerated() {
      let x = layout.columnX(index) + (layout.columnWidth - barWidth) / 2
      // While a thread is going on: a thin line between its blocks.
      for run in column.runs where !column.isRest {
        let top = layout.y(run.start), bottom = layout.y(run.end)
        context.fill(
          Path(CGRect(x: x + barWidth / 2 - 1, y: top, width: 2, height: max(0, bottom - top))),
          with: .color(layout.color(run.threadID, lit: lit).opacity(0.3)))
      }
      for block in column.blocks {
        let rect = CGRect(x: x, y: layout.y(block.start), width: barWidth, height: max(5, layout.y(block.end) - layout.y(block.start)))
        let shape = Path(roundedRect: rect, cornerRadius: min(7, rect.height / 2))
        context.fill(shape, with: .color(layout.color(block.threadID, lit: lit)))
        // The title inside the block when it fits; the rest column also says whose block it is.
        guard rect.height >= 18 else { continue }
        var inner = context
        inner.clip(to: shape)
        let name = column.isRest ? "\(model.threadName(block.threadID)) · " : ""
        inner.draw(
          Text(name + block.main.label).font(.ui(11.5, .medium))
            .foregroundStyle(.white.opacity(lit == nil || lit == block.threadID ? 0.95 : 0.5)),
          in: rect.insetBy(dx: 7, dy: 3))
      }
    }
  }
}

extension ParallelTimeline {
  /// A thread's activities with no gap over `runGap` between them: the thread is going on.
  struct Run {
    let threadID: Int64?
    var start: Double
    var end: Double
  }

  /// A thread's activities close enough together to draw as one.
  struct Block {
    let threadID: Int64?
    var activities: [Activity]
    var start: Double { activities.first!.startAt }
    var end: Double { activities.map(\.endAt).max()! }
    /// The longest activity, which titles the block.
    var main: Activity { activities.max { $0.minutes < $1.minutes }! }
  }

  struct Column {
    /// Nil for the column of the rest.
    let threadID: Int64?
    let minutes: Double
    var blocks: [Block]
    var runs: [Run]
    var isRest: Bool { threadID == nil }
  }

  struct Fold {
    let y: CGFloat
    let minutes: Double
  }

  /// The columns, the time scale with its folded breaks, and where each activity is drawn.
  struct Layout {
    var columns: [Column] = []
    var columnWidth: CGFloat = 0
    var stops: [(t: Double, y: CGFloat)] = []
    var folds: [Fold] = []
    var height: CGFloat = 0
    let shown: Set<Int64>

    @MainActor init(model: AppModel, width: CGFloat, options: TimelineOptions) {
      let activities = model.timeline.items.flatMap { item -> [Activity] in
        if case .session(let s) = item { return s.activities + s.detours }
        return []
      }
      .filter { $0.endAt > model.span.lowerBound }
      .sorted { $0.startAt < $1.startAt }
      let fit = max(1, Int((width - ParallelTimeline.gutter) / ParallelTimeline.minColumnWidth))
      // The day's biggest threads get columns; the rest share the last one.
      var minutes: [Int64: Double] = [:]
      for activity in activities { if let id = activity.threadID { minutes[id, default: 0] += activity.minutes } }
      let ranked = minutes.sorted { $0.value > $1.value }
      let limit = min(options.columns, fit)
      let restExists = activities.contains { $0.threadID == nil } || ranked.count > limit
      let named = Array(ranked.prefix(max(1, limit - (restExists ? 1 : 0))))
      shown = Set(named.map(\.key))
      let merge = options.mergeMinutes * 60
      columns = named.map { entry in
        let own = activities.filter { $0.threadID == entry.key }
        return Column(threadID: entry.key, minutes: entry.value, blocks: Self.blocks(of: own, merge: merge), runs: Self.runs(of: own))
      }
      let rest = activities.filter { $0.threadID.map { !shown.contains($0) } ?? true }
      if !rest.isEmpty {
        columns.append(Column(threadID: nil, minutes: rest.map(\.minutes).reduce(0, +), blocks: Self.blocks(of: rest, merge: merge), runs: []))
      }
      columnWidth = columns.isEmpty ? 0 : (width - ParallelTimeline.gutter) / CGFloat(columns.count)
      buildScale(activities, zoom: options.zoom)
      height = (stops.last?.y ?? 0) + 20
    }

    /// Neighbouring activities of one thread with at most `merge` seconds between them become one block.
    static func blocks(of activities: [Activity], merge: Double) -> [Block] {
      var blocks: [Block] = []
      for activity in activities {
        if let last = blocks.last, last.threadID == activity.threadID, activity.startAt - last.end <= merge {
          blocks[blocks.count - 1].activities.append(activity)
        } else {
          blocks.append(Block(threadID: activity.threadID, activities: [activity]))
        }
      }
      return blocks
    }

    static func runs(of activities: [Activity]) -> [Run] {
      var runs: [Run] = []
      for activity in activities {
        if let last = runs.last, activity.startAt - last.end <= ParallelTimeline.runGap {
          runs[runs.count - 1].end = max(last.end, activity.endAt)
        } else {
          runs.append(Run(threadID: activity.threadID, start: activity.startAt, end: activity.endAt))
        }
      }
      return runs
    }

    mutating func buildScale(_ activities: [Activity], zoom: CGFloat) {
      var busy: [(Double, Double)] = []
      for activity in activities {
        if let last = busy.last, activity.startAt - last.1 <= ParallelTimeline.breakGap {
          busy[busy.count - 1].1 = max(last.1, activity.endAt)
        } else {
          busy.append((activity.startAt, activity.endAt))
        }
      }
      var y: CGFloat = 12
      for (index, stretch) in busy.enumerated() {
        if index > 0 {
          folds.append(Fold(y: y, minutes: (stretch.0 - busy[index - 1].1) / 60))
          y += ParallelTimeline.foldedBreak
        }
        stops.append((stretch.0, y))
        y += CGFloat((stretch.1 - stretch.0) / 60) * zoom
        stops.append((stretch.1, y))
      }
    }

    func y(_ t: Double) -> CGFloat {
      guard let first = stops.first else { return 0 }
      if t <= first.t { return first.y }
      for (a, b) in zip(stops, stops.dropFirst()) where t <= b.t {
        if b.t <= a.t { return b.y }
        return a.y + CGFloat((t - a.t) / (b.t - a.t)) * (b.y - a.y)
      }
      return stops.last!.y
    }

    /// The moment drawn at height `y`.
    func t(_ y: CGFloat) -> Double {
      guard let first = stops.first else { return 0 }
      if y <= first.y { return first.t }
      for (a, b) in zip(stops, stops.dropFirst()) where y <= b.y {
        if b.y <= a.y { return b.t }
        return a.t + Double((y - a.y) / (b.y - a.y)) * (b.t - a.t)
      }
      return stops.last!.t
    }

    func columnX(_ index: Int) -> CGFloat { ParallelTimeline.gutter + CGFloat(index) * columnWidth }

    func color(_ threadID: Int64?, lit: Int64?) -> Color {
      var color = threadID.map { shown.contains($0) } == true ? Theme.mark(threadID).foreground : Theme.ink5.opacity(0.55)
      if let lit, lit != threadID { color = color.opacity(0.22) }
      return color
    }

    /// Hours inside busy stretches: a folded break has no clock.
    var hourMarks: [(Double, CGFloat)] {
      var marks: [(Double, CGFloat)] = []
      for pair in stride(from: 0, to: stops.count - 1, by: 2) {
        let (a, b) = (stops[pair], stops[pair + 1])
        var hour = (a.t / 3600).rounded(.up) * 3600
        while hour <= b.t {
          marks.append((hour, y(hour)))
          hour += 3600
        }
      }
      return marks
    }

    /// The activity under `point`: within the block there, the one at that moment, else the block's longest.
    func activity(at point: CGPoint) -> Activity? {
      guard point.x >= ParallelTimeline.gutter, columnWidth > 0 else { return nil }
      let index = Int((point.x - ParallelTimeline.gutter) / columnWidth)
      guard columns.indices.contains(index),
        let block = columns[index].blocks.first(where: { y($0.start) - 2 <= point.y && point.y <= max(y($0.end), y($0.start) + 5) + 2 })
      else { return nil }
      let moment = t(point.y)
      return block.activities.first { $0.startAt <= moment && moment < $0.endAt } ?? block.main
    }
  }

  /// The column titles: each thread's mark, name and time on screen that day; the last column holds the rest.
  /// Hovering lights the thread, clicking opens its page.
  struct Header: View {
    let model: AppModel
    var options = TimelineOptions()
    @State private var width: CGFloat = 900

    var body: some View {
      let layout = Layout(model: model, width: width, options: options)
      HStack(spacing: 0) {
        Color.clear.frame(width: ParallelTimeline.gutter)
        ForEach(Array(layout.columns.enumerated()), id: \.offset) { _, column in
          ColumnTitle(model: model, column: column).frame(width: layout.columnWidth)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
  }

  struct ColumnTitle: View {
    let model: AppModel
    let column: Column
    @State private var hovering = false

    var body: some View {
      VStack(spacing: 4) {
        if let id = column.threadID {
          ThreadMark(model: model, threadID: id, size: 22)
        } else {
          Image(systemName: "square.stack").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.ink5).frame(height: 22)
        }
        Text(column.threadID.map { model.threadName($0) } ?? "Everything else")
          .font(.ui(12, .medium)).foregroundStyle(Theme.ink2).lineLimit(2).multilineTextAlignment(.center)
        Text(durationText(column.minutes)).font(.mono(11)).foregroundStyle(Theme.ink5)
      }
      .padding(.horizontal, 6).padding(.vertical, 6)
      .frame(maxWidth: .infinity)
      .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(hovering ? Theme.wash : .clear))
      .contentShape(Rectangle())
      .onHover { inside in
        guard let id = column.threadID else { return }
        hovering = inside
        if inside { model.hoveredThreadID = id } else if model.hoveredThreadID == id { model.hoveredThreadID = nil }
      }
      .onTapGesture {
        guard let id = column.threadID else { return }
        model.section = .threads
        model.openThreadID = id
        model.refresh()
      }
    }
  }
}
