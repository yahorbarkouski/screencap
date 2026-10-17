import ScreencapCore
import SwiftUI

/// Wraps its children onto lines, like the chips under the search box.
struct FlowLayout: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width {
        y += line + spacing
        x = 0
        line = 0
      }
      x += size.width + spacing
      line = max(line, size.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: proposal.width ?? widest, height: y + line)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > bounds.minX, x + size.width > bounds.maxX {
        y += line + spacing
        x = bounds.minX
        line = 0
      }
      view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}

/// A day at a glance: a headline of a few words, its shape on the clock, the threads that carried it with their key
/// moments, one line for the rest, and the day in order (the timeline) on request. The day strip stays pinned while
/// the page scrolls and follows it: the thread in view lights its minutes and the moment under the pointer is marked.
struct DayView: View {
  @Bindable var model: AppModel
  /// Starts scrolled this far down (offscreen snapshots, which cannot scroll).
  var startY: CGFloat?
  @State private var position = ScrollPosition(edge: .top)
  @State private var scrolled = false
  @State private var visibleThreads: Set<Int64> = []

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
        column(header).padding(.top, 22)
        if model.timeline.items.isEmpty {
          column(UnsortedDay(model: model).padding(.top, 14))
        } else {
          Section {
            column(
              VStack(alignment: .leading, spacing: 0) {
                VStack(spacing: 10) {
                  ForEach(model.dayThreads) { thread in
                    ThreadDaySection(model: model, thread: thread)
                      .onScrollVisibilityChange(threshold: 0.6) { visible in
                        if visible { visibleThreads.insert(thread.id) } else { visibleThreads.remove(thread.id) }
                      }
                  }
                }
              }
              .padding(.top, 8))
          } header: {
            column(
              DayStrip(
                model: model, onOpen: { activity, capture in model.select(activity, capture: capture) },
                focusThreadID: scrolled ? focusedThread : nil,
                height: 18, cardWidth: 300)
                .padding(.top, 14).padding(.bottom, 14))
              .background(Theme.page)
              .overlay(alignment: .bottom) { Rectangle().fill(Theme.hairline).frame(height: 1).opacity(scrolled ? 1 : 0) }
              .zIndex(1)
          }
        }
      }
      .padding(.bottom, 44)
    }
    .scrollPosition($position)
    .scrollContentBackground(.hidden)
    .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 70 } action: { scrolled = $1 }
    .onAppear { if let startY { position.scrollTo(y: startY) } }
    .onChange(of: model.day) {
      visibleThreads = []
      position.scrollTo(edge: .top)
    }
  }

  /// The page's column: the window's width less its margins.
  func column(_ view: some View) -> some View {
    view.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 40)
  }

  /// The topmost thread section in view.
  var focusedThread: Int64? { model.dayThreads.first { visibleThreads.contains($0.id) }?.id }

  var header: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline) {
        Text(model.day.formatted(.dateTime.weekday(.wide).day().month(.wide))).font(.ui(13)).foregroundStyle(Theme.ink5)
        Spacer()
        if !model.timeline.items.isEmpty {
          Text(durationText(model.timeline.activeMinutes)).font(.mono(13)).foregroundStyle(Theme.ink4)
        }
      }
      Text(model.story?.headline ?? (model.timeline.items.isEmpty ? (model.isToday && !model.keptCaptures.isEmpty ? "The day so far" : "A quiet day") : " "))
        .font(.system(size: 30, weight: .medium)).tracking(-0.5).foregroundStyle(Theme.ink)
        .redacted(reason: model.story == nil && model.isWritingStory ? .placeholder : [])
        .contentTransition(.opacity)
      if model.isToday, let stopped = model.understanding?.stoppedNote {
        Text(stopped).font(.ui(13)).foregroundStyle(Theme.ink4).fixedSize(horizontal: false, vertical: true)
          .padding(.top, 4)
      }
    }
  }

}

/// A day with no activity yet: why, and its latest screenshots, so the first minutes after installing (or of any day)
/// show what Screencap has already taken.
struct UnsortedDay: View {
  let model: AppModel

  var body: some View {
    let captures = model.keptCaptures
    VStack(alignment: .leading, spacing: 18) {
      Text(
        captures.isEmpty
          ? (model.isToday ? "Nothing captured yet today. The first activity appears a few minutes after capture starts." : "Nothing was captured on this day.")
          : model.unsortedNote
      )
      .font(.ui(13.5)).foregroundStyle(Theme.ink6)
      if !captures.isEmpty {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14, alignment: .top), count: 3), alignment: .leading, spacing: 16) {
          ForEach(captures.suffix(6).reversed(), id: \.id) { capture in
            VStack(alignment: .leading, spacing: 7) {
              Screenshot(url: model.frameURL(capture), maxPixels: 560, cornerRadius: 9)
                .aspectRatio(CGFloat(capture.pixelWidth) / CGFloat(max(capture.pixelHeight, 1)), contentMode: .fit)
              Text(clockText(capture.at)).font(.mono(12.5)).foregroundStyle(Theme.ink5)
            }
          }
        }
      }
    }
  }
}

/// The day's shape: every activity on the clock, in its thread's colour for the threads with sections, grey for the
/// rest. Hovering scrubs the day (a card shows the screenshot, thread and title at that moment); clicking opens it.
/// The page can light one thread (`focusThreadID`) and mark the moment under its pointer (`model.pointedRange`).
struct DayStrip: View {
  let model: AppModel
  /// Opens the activity at the clicked moment, with the capture closest to it.
  var onOpen: (Activity, Capture?) -> Void
  /// Pins the preview at this fraction of the strip (offscreen snapshots, which cannot hover).
  var pinnedFraction: CGFloat?
  var focusThreadID: Int64?
  var height: CGFloat = 14
  var cardWidth: CGFloat = 224
  /// Draws the floating screenshot card under the pointer; off when the page shows the moment somewhere else.
  var showsCard = true
  /// The pointer over the strip; the system's when nil.
  var pointer: PointerStyle?
  /// Told the moment under the pointer as it moves, and nil when it leaves.
  var onScrub: ((Double?) -> Void)?
  @State private var pointerX: CGFloat?
  /// The same pin for a strip deep inside a page, set by the README's frames (`ReadmeFrames`).
  @Environment(\.pinnedStripFraction) private var pinnedByPage
  private var hoverX: CGFloat? { pointerX ?? (pinnedFraction ?? pinnedByPage).map { $0 * width } }
  @State private var width: CGFloat = 1

  var body: some View {
    let span = model.span
    VStack(alignment: .leading, spacing: 6) {
      GeometryReader { geo in
        ForEach(hourMarks(span), id: \.self) { hour in
          Text(clockText(hour)).font(.mono(11)).foregroundStyle(Theme.ink6).fixedSize()
            // An hour at either end stays inside the strip.
            .position(x: min(max(clockX(hour, span, geo.size.width), 18), geo.size.width - 18), y: 6)
        }
      }
      .frame(height: 12)
      strip(span)
        .frame(height: height)
        .background(GeometryReader { geo in Color.clear.onAppear { width = geo.size.width }.onChange(of: geo.size.width) { width = $1 } })
        .overlay(alignment: .topLeading) {
          if hoverX == nil, let pointed = model.pointedRange {
            let left = clockX(pointed.lowerBound, span, width)
            Capsule().fill(Theme.ink)
              .frame(width: max(4, clockX(pointed.upperBound, span, width) - left), height: 3)
              .offset(x: left, y: height + 4)
          }
        }
        .overlay(alignment: .topLeading) {
          if let hoverX {
            Capsule().fill(Theme.ink).frame(width: 2, height: height + 8).offset(x: hoverX - 1, y: -4)
          }
        }
        .overlay(alignment: .topLeading) {
          if showsCard, let hoverX, let moment = model.moment(at: time(at: hoverX, span)) {
            StripPreview(model: model, activity: moment.activity, capture: moment.capture, at: time(at: hoverX, span), width: cardWidth)
              .offset(x: min(max(0, hoverX - cardWidth / 2), max(0, width - cardWidth)), y: height + 10)
              .allowsHitTesting(false)
          }
        }
        .contentShape(Rectangle())
        .pointerStyle(pointer)
        .onContinuousHover { phase in
          switch phase {
          case .active(let point):
            pointerX = min(max(0, point.x), width)
            onScrub?(time(at: point.x, span))
          case .ended:
            pointerX = nil
            onScrub?(nil)
          }
        }
        .onTapGesture(coordinateSpace: .local) { location in
          if let moment = model.moment(at: time(at: location.x, span)) { onOpen(moment.activity, moment.capture) }
        }
    }
  }

  func strip(_ span: ClosedRange<Double>) -> some View {
    let shown = Set(model.dayThreads.map(\.id))
    let activities = model.timeline.items.flatMap { item -> [Activity] in
      if case .session(let s) = item { return s.activities + s.detours }
      return []
    }
    let lit = model.hoveredThreadID ?? focusThreadID
    return Canvas { context, size in
      context.fill(Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: size.height / 2), with: .color(Theme.wash))
      for activity in activities where activity.endAt > span.lowerBound {
        let left = clockX(activity.startAt, span, size.width)
        let width = max(1.5, clockX(activity.endAt, span, size.width) - left)
        var color = activity.threadID.map { shown.contains($0) } == true ? Theme.mark(activity.threadID).foreground : Theme.ink6.opacity(0.45)
        if let lit, activity.threadID != lit { color = color.opacity(0.2) }
        context.fill(Path(CGRect(x: left, y: 0, width: width, height: size.height)), with: .color(color))
      }
    }
    .clipShape(Capsule())
  }

  func time(at x: CGFloat, _ span: ClosedRange<Double>) -> Double {
    span.lowerBound + Double(min(max(0, x), width) / max(width, 1)) * (span.upperBound - span.lowerBound)
  }

  func hourMarks(_ span: ClosedRange<Double>) -> [Double] {
    let step: Double = span.upperBound - span.lowerBound > 8 * 3600 ? 7200 : 3600
    var marks: [Double] = []
    var hour = (span.lowerBound / step).rounded(.up) * step
    while hour <= span.upperBound - step / 4 {
      marks.append(hour)
      hour += step
    }
    return marks
  }
}

/// What the strip shows under the pointer: the screenshot closest to that moment, the thread, the time and the title.
struct StripPreview: View {
  let model: AppModel
  let activity: Activity
  let capture: Capture?
  let at: Double
  let width: CGFloat

  var body: some View {
    let inner = width - 16
    VStack(alignment: .leading, spacing: 0) {
      Screenshot(url: capture.flatMap(model.frameURL), maxPixels: 560, cornerRadius: 9, crop: capture?.window)
        .frame(width: inner, height: inner * 10 / 16)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
      HStack(spacing: 6) {
        ThreadMark(model: model, threadID: activity.threadID, size: 16)
        Text(model.threadName(of: activity)).font(.ui(12, .medium)).foregroundStyle(Theme.ink2).lineLimit(1)
        Spacer(minLength: 4)
        Text(clockText(capture?.at ?? at)).font(.mono(11)).foregroundStyle(Theme.ink5)
      }
      .padding(.top, 8)
      Text(activity.label).font(.ui(12.5)).foregroundStyle(Theme.ink3).lineLimit(1).padding(.top, 2)
    }
    .padding(8)
    .frame(width: width, alignment: .leading)
    .fixedSize(horizontal: false, vertical: true)
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.page))
    .shadow(color: .black.opacity(0.16), radius: 14, y: 6)
    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline))
  }
}

private struct PinnedStripFraction: EnvironmentKey {
  static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
  /// Pins the preview of every day strip below at this fraction (offscreen snapshots, which cannot hover).
  var pinnedStripFraction: CGFloat? {
    get { self[PinnedStripFraction.self] }
    set { self[PinnedStripFraction.self] = newValue }
  }
}

/// Where moment `t` falls across `width` points showing `span`.
func clockX(_ t: Double, _ span: ClosedRange<Double>, _ width: CGFloat) -> CGFloat {
  CGFloat((min(max(t, span.lowerBound), span.upperBound) - span.lowerBound) / (span.upperBound - span.lowerBound)) * width
}

/// One thread of the day: where it happened, when (its marks on the day's clock), and its key moments.
struct ThreadDaySection: View {
  let model: AppModel
  let thread: DayThread
  @State private var hovering = false

  var body: some View {
    let color = Theme.mark(thread.thread.id).foreground
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 10) {
        Circle().fill(color).frame(width: 8, height: 8)
        ThreadMark(model: model, threadID: thread.thread.id, size: 22)
        Text(thread.thread.name).font(.ui(thread.isMajor ? 15 : 14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
        Spacer(minLength: 12)
        if !thread.isMajor {
          // A shorter thread is one row: its moments as small screenshots beside its time.
          ForEach(thread.moments) { moment in
            Screenshot(url: moment.capture.flatMap(model.frameURL), maxPixels: 240, cornerRadius: 6, crop: moment.capture?.window)
              .frame(width: 72, height: 45)
              .onTapGesture { model.select(moment.activity, capture: moment.capture) }
          }
        }
        Text(durationText(thread.minutes)).font(.mono(12.5)).foregroundStyle(Theme.ink3)
      }
      .contentShape(Rectangle())
      .onTapGesture {
        model.section = .threads
        model.openThreadID = thread.thread.id
        model.refresh()
      }
      Canvas { context, size in
        context.fill(Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 4), with: .color(Theme.wash))
        for activity in thread.activities where activity.endAt > model.span.lowerBound {
          let left = clockX(activity.startAt, model.span, size.width)
          let width = max(3, clockX(activity.endAt, model.span, size.width) - left)
          context.fill(Path(roundedRect: CGRect(x: left, y: 0, width: width, height: size.height), cornerRadius: 2.5), with: .color(color))
        }
      }
      .frame(height: thread.isMajor ? 7 : 5).padding(.top, thread.isMajor ? 12 : 10)
      if thread.isMajor {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 3), alignment: .leading, spacing: 12) {
          ForEach(thread.moments) { moment in MomentView(model: model, moment: moment) }
        }
        .padding(.top, 14)
      }
    }
    .padding(thread.isMajor ? 16 : 12)
    .background(RoundedRectangle(cornerRadius: thread.isMajor ? 20 : 16, style: .continuous).fill(hovering ? Theme.washHover : Theme.wash))
    .animation(Theme.hover, value: hovering)
    .onHover { inside in
      hovering = inside
      if inside { model.hoveredThreadID = thread.thread.id } else if model.hoveredThreadID == thread.thread.id { model.hoveredThreadID = nil }
    }
  }
}

/// A key moment: its screenshot, when, and what happened. Selecting it opens the inspector.
struct MomentView: View {
  let model: AppModel
  let moment: Moment

  var body: some View {
    let selected = model.selectedActivityID == moment.activity.id
    VStack(alignment: .leading, spacing: 0) {
      Color.clear.aspectRatio(16 / 10, contentMode: .fit)
        .overlay(Screenshot(url: moment.capture.flatMap(model.frameURL), maxPixels: 760, cornerRadius: 10, crop: moment.capture?.window).frame(maxWidth: .infinity, maxHeight: .infinity))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(selected ? Theme.ink : .clear, lineWidth: 1.5))
      HStack(alignment: .firstTextBaseline, spacing: 7) {
        Text(clockText(moment.activity.startAt)).font(.mono(11.5)).foregroundStyle(Theme.ink5)
        Text(moment.activity.label).font(.ui(13, .medium)).foregroundStyle(Theme.ink2).lineLimit(1)
      }
      .padding(.top, 8)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
    .onHover { inside in model.point(at: moment.activity.startAt...moment.activity.endAt, inside) }
    .onTapGesture { model.select(moment.activity, capture: moment.capture) }
  }
}
