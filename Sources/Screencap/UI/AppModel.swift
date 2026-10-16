import AppKit
import Observation
import ScreencapCore
import SwiftUI

enum MainSection: String, CaseIterable {
  case day = "Day"
  case timeline = "Timeline"
  case threads = "Threads"
}

/// A thread tile in the Threads view: its time over the week ending on the selected day, and its activities on the
/// latest day it was active, placed on that day's clock.
struct ThreadTile: Identifiable, Equatable {
  var id: Int64 { thread.id ?? 0 }
  let thread: ActivityThread
  let weekMinutes: Double
  let laneDay: Date
  let lane: [Activity]
  /// That day's span: its first activity's start to its last activity's end, over every thread.
  let laneSpan: ClosedRange<Double>
  let lastSeenAt: Double
  /// A screenshot from its latest activity.
  let cover: Capture?
}

/// One of the threads that carried a day: its activities that day, where it happened, and its key moments.
struct DayThread: Identifiable, Equatable {
  var id: Int64 { thread.id ?? 0 }
  let thread: ActivityThread
  /// The day's activities of this thread, oldest first.
  let activities: [Activity]
  let minutes: Double
  /// Up to three of its longest activities that day, oldest first, each with a representative capture.
  let moments: [Moment]
  /// A thread with a quarter of an hour or more gets a full section; a shorter one is a row.
  var isMajor: Bool { minutes >= 15 }
}

struct Moment: Identifiable, Equatable {
  var id: Int64 { activity.id ?? 0 }
  let activity: Activity
  let capture: Capture?
}

/// One search result: the matching moment and the activity it belongs to.
struct SearchResult: Identifiable, Equatable {
  var id: String { capture.id }
  let capture: Capture
  let activity: Activity?
}

/// Everything the panel and the main window show, loaded from the store.
@MainActor
@Observable
final class AppModel {
  let database: AppDatabase
  let location: StoreLocation
  let settings: SettingsStore
  var corrections: Corrections?
  let icons = PlaceIcons()
  var captureEngine: CaptureEngine?
  var understanding: UnderstandingDriver?
  var backup: BackupDriver?

  // Navigation
  var day: Date = Calendar.current.startOfDay(for: Date())
  var section: MainSection = .day
  var query = ""
  var selectedActivityID: Int64?
  var selectedCaptureID: String?
  /// The selected activity's screenshot shown over the whole main window, by capture; nil when none is.
  var expandedCaptureID: String?
  var openThreadID: Int64?
  var categoryFilter: ActivityCategory?
  /// Treat this day as "today" in the panel (snapshots of a replayed store, whose days are in the past).
  var todayOverride: Date?

  // Data
  private(set) var timeline = DayTimeline(activities: [], dayStart: 0, dayEnd: 0)
  private(set) var today = DayTimeline(activities: [], dayStart: 0, dayEnd: 0)
  private(set) var threads: [Int64: ActivityThread] = [:]
  private(set) var dayCaptures: [Capture] = []
  /// Whether a key for the models is set; without one, screenshots are kept and searchable but never sorted.
  private(set) var hasModelKey = false
  private(set) var capturesByActivity: [Int64: [Capture]] = [:]
  private(set) var tiles: [ThreadTile] = []
  private(set) var threadActivities: [Activity] = []
  private(set) var searchResults: [SearchResult] = []
  private(set) var searchCount = 0
  private(set) var current: Activity?
  private(set) var lastRefresh = Date.distantPast
  /// Every thread of the shown day with a minute or more, most time first.
  private(set) var dayThreads: [DayThread] = []
  /// The shown day in order, as chapters.
  private(set) var chapters: [DayChapters.Chapter] = []
  /// From the day's first activity after its last long break (a night) to its last.
  private(set) var span: ClosedRange<Double> = 0...1
  private(set) var story: DayStory?
  private(set) var isWritingStory = false
  @ObservationIgnored private var storyAsked: (day: Date, at: Date)?
  @ObservationIgnored private var places: [Int64: (place: Place, app: String?)?] = [:]
  /// The thread under the pointer in the Day view; the day strip lights its minutes and dims the rest.
  var hoveredThreadID: Int64?
  /// Covers the decision model picked for the Threads page, by thread.
  private(set) var covers: [Int64: Capture] = [:]
  @ObservationIgnored private var coverTask: Task<Void, Never>?
  @ObservationIgnored private var coverAskedAt: [Int64: Date] = [:]
  /// The open page's large title has scrolled under the title bar, which then shows it inline.
  var titleScrolledAway = false
  /// The stretch of the day under the pointer (a moment or a timeline row); the day strip marks it.
  private(set) var pointedRange: ClosedRange<Double>?

  /// Marks `range` while the pointer is inside the view showing it, and clears it when the pointer leaves (unless it
  /// has already moved on to another).
  func point(at range: ClosedRange<Double>, _ inside: Bool) {
    if inside { pointedRange = range } else if pointedRange == range { pointedRange = nil }
  }

  init(database: AppDatabase, location: StoreLocation, settings: SettingsStore) {
    self.database = database
    self.location = location
    self.settings = settings
  }

  var dayStart: Double { day.timeIntervalSince1970 }
  var dayEnd: Double { Calendar.current.date(byAdding: .day, value: 1, to: day)!.timeIntervalSince1970 }

  var isToday: Bool { Calendar.current.isDateInToday(day) }

  /// The shown day's screenshots that kept a frame, oldest first: what a day shows before any activity is sorted.
  var keptCaptures: [Capture] { dayCaptures.filter { $0.framePath != nil } }

  /// What a day with screenshots but no activity yet says about them.
  var unsortedNote: String {
    let count = keptCaptures.count
    let shots = count == 1 ? "1 screenshot" : "\(count) screenshots"
    guard isToday else { return "\(shots), not sorted into activities." }
    return hasModelKey
      ? "\(shots) so far. The first activity appears a few minutes after you start working."
      : "\(shots) so far. Add an OpenRouter key in Settings to sort them into activities."
  }

  func thread(_ id: Int64?) -> ActivityThread? { id.flatMap { threads[$0] } }

  func threadName(_ id: Int64?) -> String {
    guard let id else { return "Finding its thread…" }
    return threads[id]?.name ?? "Thread"
  }

  /// An activity's thread name; one whose thread question kept failing is settled without a thread.
  func threadName(of activity: Activity) -> String {
    activity.threadID == nil && activity.isThreadLocked ? "No thread" : threadName(activity.threadID)
  }

  // MARK: Loading

  func refresh() {
    do {
      threads = Dictionary(uniqueKeysWithValues: try database.allThreads().compactMap { t in t.id.map { ($0, t) } })
      let activities = try database.activities(from: dayStart, to: dayEnd)
      timeline = DayTimeline(activities: activities, dayStart: dayStart, dayEnd: dayEnd)
      dayCaptures = try database.focusedCaptures(from: dayStart).filter { $0.at < dayEnd }
      hasModelKey = OpenRouter.storedKey() != nil
      capturesByActivity = group(activities, dayCaptures)
      dayThreads = buildDayThreads(activities)
      chapters = DayChapters(activities: activities).chapters
      span = activeSpan(activities)
      let todayStart = Calendar.current.startOfDay(for: todayOverride ?? Date()).timeIntervalSince1970
      today =
        isToday || todayOverride.map({ Calendar.current.isDate($0, inSameDayAs: day) }) == true
        ? timeline
        : DayTimeline(activities: try database.activities(from: todayStart, to: todayStart + 86_400), dayStart: todayStart, dayEnd: todayStart + 86_400)
      current = try database.latestActivity().flatMap { $0.isOpen ? $0 : nil }
      tiles = try loadTiles()
      if section == .threads { loadCovers() }
      if let openThreadID { threadActivities = try database.activities(threadID: openThreadID).reversed() }
      if !query.isEmpty { try runSearch() }
      lastRefresh = Date()
      loadStory()
    } catch {
      Log.ui.error("refresh failed: \(String(describing: error), privacy: .public)")
    }
  }

  private func buildDayThreads(_ activities: [Activity]) -> [DayThread] {
    var byThread: [Int64: [Activity]] = [:]
    for activity in activities { if let id = activity.threadID { byThread[id, default: []].append(activity) } }
    return byThread.compactMap { id, items -> DayThread? in
      guard let thread = threads[id] else { return nil }
      let minutes = items.map(\.minutes).reduce(0, +)
      guard minutes >= 1 else { return nil }
      let moments = items.sorted { $0.minutes > $1.minutes }.prefix(3).sorted { $0.startAt < $1.startAt }.map { activity in
        Moment(activity: activity, capture: representative(of: activity))
      }
      return DayThread(thread: thread, activities: items, minutes: minutes, moments: moments)
    }
    .sorted { $0.minutes > $1.minutes }
  }

  private func activeSpan(_ activities: [Activity]) -> ClosedRange<Double> {
    let sorted = activities.sorted { $0.startAt < $1.startAt }
    guard var start = sorted.first?.startAt else { return dayStart...dayEnd }
    for (previous, next) in zip(sorted, sorted.dropFirst()) where next.startAt - previous.endAt > 4 * 3600 { start = next.startAt }
    let end = max(sorted.map(\.endAt).max() ?? start, isToday ? min(Date().timeIntervalSince1970, dayEnd) : 0)
    return start...max(end, start + 3600)
  }

  /// Minutes on screen on each day of the month holding `month`, keyed by the day's start.
  func minutesPerDay(inMonthOf month: Date) -> [Date: Double] {
    let calendar = Calendar.current
    guard let interval = calendar.dateInterval(of: .month, for: month),
      let activities = try? database.activities(from: interval.start.timeIntervalSince1970, to: interval.end.timeIntervalSince1970)
    else { return [:] }
    var minutes: [Date: Double] = [:]
    for activity in activities {
      minutes[calendar.startOfDay(for: Date(timeIntervalSince1970: activity.startAt)), default: 0] += activity.minutes
    }
    return minutes
  }

  /// The site or app a thread happened in most, looked up once per thread.
  func place(of threadID: Int64?) -> (place: Place, app: String?)? {
    guard let threadID else { return nil }
    if let cached = places[threadID] { return cached }
    let found = (try? database.mainPlace(threadID: threadID)).flatMap { row -> (Place, String?)? in
      if let host = row.host { return (.site(host), row.bundleID) }
      return row.bundleID.map { (.app($0), $0) }
    }
    places[threadID] = found
    return found
  }

  /// Asks for the day's story: once for a past day, and for today at most every 30 minutes as it changes.
  func loadStory() {
    guard let engine = understanding?.engine, !timeline.items.isEmpty else {
      story = nil
      return
    }
    if let asked = storyAsked, asked.day == day, !isToday || Date().timeIntervalSince(asked.at) < 1800 { return }
    if storyAsked?.day != day { story = nil }
    storyAsked = (day, Date())
    let timeline = self.timeline
    let names = threads.compactMapValues(\.name)
    let day = self.day
    isWritingStory = story == nil
    Task {
      let written = try? await engine.dayStory(for: timeline, threadNames: names)
      guard self.day == day else { return }
      // The headline arrives seconds after the page, so it fades in over the placeholder.
      withAnimation(Theme.easeOut) {
        if let written { self.story = written }
        self.isWritingStory = false
      }
    }
  }

  private func group(_ activities: [Activity], _ captures: [Capture]) -> [Int64: [Capture]] {
    var result: [Int64: [Capture]] = [:]
    let index = Dictionary(uniqueKeysWithValues: captures.enumerated().map { ($1.id, $0) })
    for activity in activities {
      guard let id = activity.id else { continue }
      let first = index[activity.firstCaptureID] ?? captures.firstIndex { $0.at >= activity.startAt } ?? 0
      let last = index[activity.lastCaptureID] ?? captures.lastIndex { $0.at <= activity.endAt } ?? -1
      if first <= last { result[id] = Array(captures[first...last]) }
    }
    return result
  }

  private func loadTiles() throws -> [ThreadTile] {
    let weekStart = dayEnd - 7 * 86_400
    let activities = try database.activities(from: weekStart, to: dayEnd)
    var perThread: [Int64: [Activity]] = [:]
    for activity in activities { if let id = activity.threadID { perThread[id, default: []].append(activity) } }
    let calendar = Calendar.current
    func day(_ activity: Activity) -> Date { calendar.startOfDay(for: Date(timeIntervalSince1970: activity.startAt)) }
    var spans: [Date: ClosedRange<Double>] = [:]
    for activity in activities {
      let key = day(activity)
      let span = spans[key] ?? activity.startAt...activity.endAt
      spans[key] = min(span.lowerBound, activity.startAt)...max(span.upperBound, activity.endAt)
    }
    return perThread.compactMap { id, items -> ThreadTile? in
      guard let thread = threads[id], let latest = items.max(by: { $0.startAt < $1.startAt }) else { return nil }
      let laneDay = day(latest)
      let span = spans[laneDay] ?? latest.startAt...latest.endAt
      // Until the model's pick arrives: the representative screenshot of the thread's longest activity.
      let cover = items.sorted { $0.minutes > $1.minutes }.lazy.compactMap { self.representative(of: $0) }.first
      return ThreadTile(
        thread: thread, weekMinutes: items.map(\.minutes).reduce(0, +), laneDay: laneDay,
        lane: items.filter { day($0) == laneDay }, laneSpan: span.lowerBound...max(span.upperBound, span.lowerBound + 60),
        lastSeenAt: items.map(\.endAt).max() ?? 0, cover: cover)
    }
    .sorted { $0.weekMinutes > $1.weekMinutes }
  }

  func runSearch() throws {
    (searchResults, searchCount) = try search(query)
  }

  /// The moments whose screens matched `query`, newest first and one per activity, with how many screens matched.
  func search(_ query: String) throws -> (results: [SearchResult], count: Int) {
    let hits = try database.search(query, limit: 400)
    let captures = try database.captures(ids: hits.map(\.captureID)).sorted { $0.at > $1.at }
    var seen = Set<Int64>()
    var results: [SearchResult] = []
    for capture in captures where capture.isFocusedDisplay {
      let activity = try database.activities(from: capture.at - 0.001, to: capture.at + 0.001).first
      if let id = activity?.id { guard seen.insert(id).inserted else { continue } }
      results.append(SearchResult(capture: capture, activity: activity))
      if results.count == 120 { break }
    }
    return (results, captures.count)
  }

  /// Where `query` shows on a capture's screen: the first line with all its words (else its longest word), as
  /// fractions of the whole screen. Nil when no line has them.
  func searchMark(in capture: Capture, query: String) -> CGRect? {
    let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
    guard let longest = words.max(by: { $0.count < $1.count }), let lines = try? database.ocrLines(captureID: capture.id) else { return nil }
    func has(_ line: OCRLine, _ word: String) -> Bool { line.text.range(of: word, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
    guard let line = lines.first(where: { line in words.allSatisfy { has(line, $0) } }) ?? lines.first(where: { has($0, longest) }) else { return nil }
    return CGRect(x: CGFloat(line.x), y: CGFloat(line.y), width: CGFloat(line.width), height: CGFloat(line.height))
  }

  /// The screenshot of `activity` on screen at moment `t`: its last capture at or before `t`, else its first.
  func capture(of activity: Activity, at t: Double) -> Capture? {
    let own = captures(of: activity)
    return own.last { $0.at <= t } ?? own.first
  }

  // MARK: Frames

  /// The thumbnail of a capture, following a duplicate to the frame it repeats.
  func thumbURL(_ capture: Capture) -> URL? {
    if let path = capture.thumbPath { return location.url(path) }
    if let source = capture.duplicateOf, let original = dayCaptures.first(where: { $0.id == source }) ?? (try? database.capture(id: source)) {
      return original.thumbPath.map(location.url)
    }
    return nil
  }

  func frameURL(_ capture: Capture) -> URL? {
    if let path = capture.framePath { return location.url(path) }
    if let source = capture.duplicateOf, let original = try? database.capture(id: source) { return original.framePath.map(location.url) }
    return nil
  }

  /// The activity at moment `t` of the shown day (or the nearest one before it), with its capture closest to `t`.
  func moment(at t: Double) -> (activity: Activity, capture: Capture?)? {
    let activities = timeline.items.flatMap { item -> [Activity] in
      if case .session(let s) = item { return s.activities + s.detours }
      return []
    }
    guard let activity = activities.first(where: { $0.startAt <= t && t < $0.endAt })
      ?? activities.last(where: { $0.startAt <= t }) ?? activities.first
    else { return nil }
    let own = (capturesByActivity[activity.id ?? 0] ?? []).filter { $0.at >= activity.startAt - 1 }
    let capture = own.last { $0.at <= t } ?? own.first
    return (activity, capture)
  }

  static let ownBundleID = Moments.ownBundleID

  /// The screenshot an activity is shown by (see `Moments.representative`).
  func representative(of activity: Activity) -> Capture? { representative(among: captures(of: activity)) }

  func representative(among all: [Capture]) -> Capture? { Moments.representative(among: all) }

  /// A thread's cover candidates over `activities`: the representative screenshot of each place it happened at, the
  /// five places with the most captures.
  func coverCandidates(for activities: [Activity]) -> [Capture] {
    let all = activities.flatMap { captures(of: $0) }.filter { $0.context.bundleID != Self.ownBundleID }
    return Dictionary(grouping: all, by: \.context.placeKey).values
      .sorted { $0.count > $1.count }
      .prefix(5)
      .compactMap { representative(among: $0) }
  }

  var isLoadingCovers: Bool { coverTask != nil }

  /// Asks the decision model for the covers of the Threads page's first tiles, in the background; a thread is asked
  /// again at most every 30 minutes as its screenshots change, and each answer is kept in the decision log.
  func loadCovers() {
    guard let engine = understanding?.engine, coverTask == nil else { return }
    let weekStart = dayEnd - 7 * 86_400
    let wanted = tiles.prefix(18).map(\.thread).filter { thread in
      thread.id.map { coverAskedAt[$0].map { Date().timeIntervalSince($0) > 1800 } ?? true } ?? false
    }
    guard !wanted.isEmpty else { return }
    coverTask = Task { @MainActor in
      defer { coverTask = nil }
      for thread in wanted {
        guard let id = thread.id else { continue }
        coverAskedAt[id] = Date()
        let activities = ((try? database.activities(threadID: id)) ?? []).filter { $0.startAt >= weekStart && $0.startAt < dayEnd }
        let candidates = coverCandidates(for: activities)
        do {
          if let chosen = try await engine.cover(for: thread, candidates: candidates, now: Date().timeIntervalSince1970),
            let capture = candidates.first(where: { $0.id == chosen })
          {
            covers[id] = capture
          }
        } catch {
          Log.ui.error("cover failed: \(String(describing: error), privacy: .private)")
        }
      }
    }
  }

  /// Up to `count` captures spread over a session, preferring kept frames.
  func strip(for session: DayTimeline.Session, count: Int = 4) -> [Capture] {
    let captures = session.activities.compactMap { $0.id }.flatMap { capturesByActivity[$0] ?? [] }.filter { !$0.isDuplicate }
    guard captures.count > count else { return captures }
    return (0..<count).map { captures[$0 * (captures.count - 1) / (count - 1)] }
  }

  var selectedActivity: Activity? {
    guard let id = selectedActivityID else { return nil }
    return timeline.items.lazy.compactMap { item -> Activity? in
      if case .session(let s) = item { return (s.activities + s.detours).first { $0.id == id } }
      return nil
    }.first ?? threadActivities.first { $0.id == id } ?? (try? database.activity(id: id))
  }

  func captures(of activity: Activity) -> [Capture] {
    if let id = activity.id, let cached = capturesByActivity[id] { return cached }
    return (try? database.captures(of: activity)) ?? []
  }

  // MARK: Navigation

  func go(toDay date: Date) {
    day = Calendar.current.startOfDay(for: date)
    selectedActivityID = nil
    selectedCaptureID = nil
    expandedCaptureID = nil
    refresh()
  }

  func shiftDay(_ delta: Int) {
    go(toDay: Calendar.current.date(byAdding: .day, value: delta, to: day)!)
  }

  func select(_ activity: Activity, capture: Capture? = nil) {
    selectedActivityID = activity.id
    selectedCaptureID = capture?.id
    expandedCaptureID = nil
  }

  /// The selected activity's screenshots that can be expanded: the kept ones, in order.
  var expandableCaptures: [Capture] {
    selectedActivity.map { captures(of: $0).filter { !$0.isDuplicate && $0.framePath != nil } } ?? []
  }

  /// Expands `capture` (else the selected screenshot, else the activity's middle one) over the main window.
  func expand(_ capture: Capture? = nil) {
    let all = expandableCaptures
    guard !all.isEmpty else { return }
    expandedCaptureID = (capture ?? all.first { $0.id == selectedCaptureID } ?? all[all.count / 2]).id
  }

  /// Shows the screenshot `offset` places along in the expanded activity.
  func step(_ offset: Int) {
    let all = expandableCaptures
    guard let index = all.firstIndex(where: { $0.id == expandedCaptureID }) else { return }
    expandedCaptureID = all[min(max(0, index + offset), all.count - 1)].id
  }

  /// Closes the expanded screenshot; the inspector keeps the last one looked at.
  func collapse() {
    if let id = expandedCaptureID { selectedCaptureID = id }
    expandedCaptureID = nil
  }

  func open(result: SearchResult) {
    query = ""
    section = .day
    go(toDay: result.capture.date)
    if let activity = result.activity { select(activity, capture: result.capture) }
  }

  // MARK: Corrections

  func perform(_ action: @escaping @Sendable (Corrections) async throws -> Void) {
    guard let corrections else { return }
    Task {
      do { try await action(corrections) } catch {
        Log.ui.error("correction failed: \(String(describing: error), privacy: .public)")
      }
      refresh()
      understanding?.poke()
    }
  }
}

