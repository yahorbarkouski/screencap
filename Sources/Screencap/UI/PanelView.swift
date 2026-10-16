import ScreencapCore
import SwiftUI

/// The popup's search: what is typed, its results and the one the keys have chosen. The panel controller owns it, so
/// showing the panel can hand the field the keys and hiding it can start over.
@MainActor
@Observable
final class PanelSearch {
  private let model: AppModel
  var query = "" {
    didSet {
      guard query != oldValue else { return }
      selection = 0
      results = query.trimmingCharacters(in: .whitespaces).isEmpty ? [] : (try? model.search(query).results) ?? []
    }
  }
  /// Opened with the magnifier before anything is typed.
  var isOpen = false
  private(set) var results: [SearchResult] = []
  var selection = 0
  /// Bumped each time the panel shows, so the field takes the keys.
  private(set) var focusRequests = 0

  init(model: AppModel) { self.model = model }

  var isActive: Bool { isOpen || !query.isEmpty }

  func reset() {
    query = ""
    isOpen = false
  }

  func requestFocus() { focusRequests += 1 }

  /// Moves the chosen result by `offset`, staying on the grid.
  func move(_ offset: Int) {
    guard !results.isEmpty else { return }
    selection = min(max(0, selection + offset), results.count - 1)
  }
}

/// The menu-bar panel, always 372 × 376 so nothing in it is ever cut off: the headline, time on screen, search and the
/// way into the app; the day strip; and under it a stage that lists the day's threads, or shows the moment under the
/// pointer while the strip is scrubbed. Typing anywhere searches everything seen, and the results take the strip's and
/// the stage's place.
struct PanelView: View {
  @Bindable var model: AppModel
  @Bindable var search: PanelSearch
  var openMain: () -> Void
  /// Opens the main window on an activity, or on a thread's page, or on a search result.
  var openActivity: (Activity, Capture?) -> Void
  var openThread: (Int64) -> Void
  var openResult: (SearchResult) -> Void
  /// Closes the panel (Esc with nothing left to clear).
  var close: () -> Void
  /// Pins the scrubbed moment at this fraction of the strip (offscreen snapshots, which cannot hover).
  var pinnedFraction: CGFloat?

  @State private var scrubTime: Double?
  @FocusState private var fieldFocused: Bool

  static let size = CGSize(width: 372, height: 372)
  static let rowHeight: CGFloat = 36
  /// Seven thread rows, or a full-width screenshot with its thread and title.
  static let stageHeight: CGFloat = 252
  static let inner: CGFloat = size.width - 32
  /// Above the header: its round buttons then sit as far from the panel's top as from its side.
  static let topInset: CGFloat = 11

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      header.frame(height: 36)
      if !search.query.trimmingCharacters(in: .whitespaces).isEmpty {
        results
      } else if model.today.items.isEmpty {
        if model.isToday, let latest = model.keptCaptures.last {
          // Before the first activity is sorted, the latest screenshot shows that capture works.
          Text(model.unsortedNote).font(.ui(12.5)).foregroundStyle(Theme.ink6).fixedSize(horizontal: false, vertical: true)
          Screenshot(url: model.frameURL(latest), maxPixels: 900, cornerRadius: 10)
            .aspectRatio(CGFloat(latest.pixelWidth) / CGFloat(max(latest.pixelHeight, 1)), contentMode: .fit)
            .frame(width: Self.inner)
        } else {
          Text("Nothing yet today.").font(.ui(12.5)).foregroundStyle(Theme.ink6).padding(.top, 4)
        }
      } else {
        DayStrip(model: model, onOpen: openActivity, pinnedFraction: pinnedFraction, showsCard: false, pointer: .link, onScrub: { scrubTime = $0 })
          // A click on the strip puts the panel away under the pointer, so each showing starts with no moment.
          .id(search.focusRequests)
        stage.frame(height: Self.stageHeight, alignment: .top)
      }
    }
    .padding(.horizontal, 16).padding(.top, Self.topInset).padding(.bottom, 16)
    .frame(width: Self.size.width, height: Self.size.height, alignment: .top)
    .onChange(of: search.focusRequests) {
      fieldFocused = true
      scrubTime = nil
    }
    .onAppear {
      if let pinnedFraction { scrubTime = model.span.lowerBound + Double(pinnedFraction) * (model.span.upperBound - model.span.lowerBound) }
    }
  }

  // MARK: Header

  /// The summary, with the search field under it. The field always holds the keys, invisible until something is
  /// typed (or the magnifier is clicked), so typing anywhere in the panel searches.
  var header: some View {
    ZStack {
      searchField.opacity(search.isActive ? 1 : 0).allowsHitTesting(search.isActive)
      summary.opacity(search.isActive ? 0 : 1).allowsHitTesting(!search.isActive)
    }
  }

  var summary: some View {
    HStack(alignment: .center, spacing: 6) {
      // Headlines run to about 55 characters; at 14 pt two lines hold the longest beside the time and buttons.
      Text(model.story?.headline ?? "Today").font(.ui(14, .medium)).foregroundStyle(Theme.ink).lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 8)
      Text(durationText(model.today.activeMinutes)).font(.mono(12)).foregroundStyle(Theme.ink4).padding(.trailing, 2)
      if let updates = model.updates, let title = updates.actionTitle {
        RoundIconButton(systemName: "arrow.down", size: 26, dot: Theme.exact) { updates.checkOrInstall() }.help(title)
      }
      RoundIconButton(systemName: "magnifyingglass", size: 26) {
        search.isOpen = true
        fieldFocused = true
      }
      .help("Search everything you have seen")
      RoundIconButton(systemName: "arrow.up.forward.app", size: 26, action: openMain).help("Open Screencap")
    }
  }

  /// The field reads as the headline does (same size, same place), with the magnifier where the text starts and a hairline
  /// under the row while it searches.
  var searchField: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink4)
      TextField("", text: $search.query, prompt: Text("Search everything you have seen").foregroundStyle(Theme.ink6))
        .textFieldStyle(.plain)
        .font(.ui(15, .medium)).foregroundStyle(Theme.ink).tint(Theme.ink)
        .focused($fieldFocused)
        .onSubmit {
          if search.results.indices.contains(search.selection) { openResult(search.results[search.selection]) }
        }
        .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow]) { press in
          guard !search.results.isEmpty, press.modifiers.isEmpty else { return .ignored }
          switch press.key {
          case .upArrow: search.move(-2)
          case .downArrow: search.move(2)
          case .leftArrow: search.move(-1)
          default: search.move(1)
          }
          return .handled
        }
        .onExitCommand {
          if search.isActive { search.reset() } else { close() }
        }
      if search.isActive {
        RoundIconButton(systemName: "xmark", size: 26) { search.reset() }.help("Clear")
      }
    }
    .overlay(alignment: .bottom) {
      Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, -16).offset(y: 6.5)
    }
  }

  // MARK: Stage

  @ViewBuilder var stage: some View {
    if let scrubTime, let moment = model.moment(at: scrubTime) {
      VStack(alignment: .leading, spacing: 0) {
        Screenshot(url: moment.capture.flatMap(model.frameURL), maxPixels: 900, cornerRadius: 10, crop: moment.capture?.window)
          .frame(width: Self.inner, height: Self.inner * 10 / 16)
        HStack(spacing: 6) {
          ThreadMark(model: model, threadID: moment.activity.threadID, size: 16)
          Text(model.threadName(of: moment.activity)).font(.ui(12.5, .medium)).foregroundStyle(Theme.ink2).lineLimit(1)
          Spacer(minLength: 4)
          Text(clockText(moment.capture?.at ?? scrubTime)).font(.mono(11.5)).foregroundStyle(Theme.ink5)
        }
        .padding(.top, 10)
        Text(moment.activity.label).font(.ui(12.5)).foregroundStyle(Theme.ink3).lineLimit(1).padding(.top, 3)
      }
    } else {
      ScrollView {
        VStack(spacing: 0) {
          ForEach(threads) { row in
            ThreadTimeRow(model: model, row: row, maxMinutes: threads.first?.minutes ?? 1) {
              if let id = row.threadID { openThread(id) }
            }
            .frame(height: Self.rowHeight)
          }
        }
      }
      .scrollIndicators(.automatic)
      .mask { LinearGradient(stops: fadeStops, startPoint: .top, endPoint: .bottom) }
      // A row's hover wash reaches into the margin, so its mark and minutes line up with the headline and the strip.
      .padding(.horizontal, -8)
    }
  }

  /// The list's bottom edge fades while more rows wait below.
  var fadeStops: [Gradient.Stop] {
    let more: Bool = CGFloat(threads.count) * Self.rowHeight > Self.stageHeight
    let fade: Double = more ? 0.15 : 1
    return [Gradient.Stop(color: .black, location: 0), Gradient.Stop(color: .black, location: more ? 0.86 : 1), Gradient.Stop(color: .black.opacity(fade), location: 1)]
  }

  /// Today's threads, most time first.
  var threads: [DayTimeline.ThreadTime] { model.today.threads.filter { $0.threadID != nil } }

  // MARK: Results

  /// Two whole screens a row, as the main window shows them, the matched line marked; the keys' choice is outlined.
  /// (Zooming to the match lost to this: most matches are in tab titles and sidebars, so the zooms looked alike.)
  @ViewBuilder var results: some View {
    if search.results.isEmpty {
      Text("Nothing on screen matched.").font(.ui(12.5)).foregroundStyle(Theme.ink6).padding(.top, 8)
    } else {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], alignment: .leading, spacing: 14) {
            ForEach(Array(search.results.enumerated()), id: \.element.id) { index, result in
              PanelResult(model: model, result: result, query: search.query, chosen: index == search.selection)
                .id(index)
                .onHover { if $0 { search.selection = index } }
                .onTapGesture { openResult(result) }
            }
          }
          .padding(.top, 2)
        }
        .scrollIndicators(.never)
        .mask { LinearGradient(stops: [Gradient.Stop(color: .black, location: 0.88), Gradient.Stop(color: .black.opacity(0.15), location: 1)], startPoint: .top, endPoint: .bottom) }
        .onChange(of: search.selection) { _, index in proxy.scrollTo(index) }
      }
      .padding(.top, 2)
    }
  }
}

/// One search result: the whole screen with the words marked on it, what was going on and when.
struct PanelResult: View {
  let model: AppModel
  let result: SearchResult
  let query: String
  let chosen: Bool
  @State private var mark: CGRect?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Color.clear.aspectRatio(16 / 10, contentMode: .fit)
        .overlay(Screenshot(url: model.thumbURL(result.capture), maxPixels: 520, cornerRadius: 9, mark: mark))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(chosen ? Theme.ink : .clear, lineWidth: 1.5))
      Text(result.activity?.label ?? result.capture.context.windowTitle ?? "").font(.ui(12, .medium)).foregroundStyle(Theme.ink2)
        .lineLimit(2).fixedSize(horizontal: false, vertical: true).padding(.top, 6)
      Text("\(whenText(result.capture)) · \(result.capture.context.urlHost ?? result.capture.context.appName ?? "")")
        .font(.ui(11)).foregroundStyle(Theme.ink5).lineLimit(1).padding(.top, 1)
    }
    .contentShape(Rectangle())
    .task(id: "\(result.id) \(query)") { mark = model.searchMark(in: result.capture, query: query) }
  }

  /// The time today, else the weekday (this week) or the date, with the time.
  func whenText(_ capture: Capture) -> String {
    let calendar = Calendar.current
    let date = capture.date
    if calendar.isDateInToday(date) { return clockText(capture.at) }
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: Date())).day ?? 0
    return days < 7
      ? "\(date.formatted(.dateTime.weekday(.abbreviated))) \(clockText(capture.at))"
      : "\(date.formatted(.dateTime.month(.abbreviated).day())) \(clockText(capture.at))"
  }
}

/// A thread's time today: hovering lights its minutes on the strip, clicking opens it.
struct ThreadTimeRow: View {
  let model: AppModel
  let row: DayTimeline.ThreadTime
  let maxMinutes: Double
  let open: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: 10) {
      ThreadMark(model: model, threadID: row.threadID, size: 24)
      Text(model.threadName(row.threadID)).font(.ui(13, .medium)).foregroundStyle(Theme.ink2).lineLimit(1)
      Spacer()
      Capsule().fill(Theme.wash).frame(width: 36, height: 4)
        .overlay(alignment: .leading) {
          Capsule().fill(Theme.mark(row.threadID).foreground).frame(width: 36 * min(1, row.minutes / max(maxMinutes, 1)), height: 4)
        }
      Text(durationText(row.minutes)).font(.mono(11.5)).foregroundStyle(Theme.ink4).frame(width: 52, alignment: .trailing)
    }
    .padding(.horizontal, 8)
    .frame(maxHeight: .infinity)
    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hovering ? Theme.wash : .clear))
    .animation(Theme.hover, value: hovering)
    .contentShape(Rectangle())
    .onHover { inside in
      hovering = inside
      if inside { model.hoveredThreadID = row.threadID } else if model.hoveredThreadID == row.threadID { model.hoveredThreadID = nil }
    }
    .onTapGesture(perform: open)
  }
}
