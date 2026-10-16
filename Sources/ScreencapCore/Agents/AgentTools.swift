import CoreGraphics
import Foundation
import GRDB
import ImageIO
import UniformTypeIdentifiers

/// The tools agents read the person's history with, over a store opened read-only. Results are JSON shaped for a
/// model's context window: compact, paged, and with times in the person's time zone (`AgentTime`).
public struct AgentTools: Sendable {
  public let database: AppDatabase
  public let location: StoreLocation
  public let time: AgentTime
  let now: @Sendable () -> Double

  public init(
    database: AppDatabase, location: StoreLocation, time: AgentTime = AgentTime(),
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 }
  ) {
    self.database = database
    self.location = location
    self.time = time
    self.now = now
  }

  public struct Output: Sendable {
    public var structured: JSONValue
    public var image: Image?
    /// One line for the access log: what was read.
    public var summary: String
  }

  public struct Image: Sendable {
    public var data: Data
    public var mimeType: String
  }

  /// A call the agent can correct (a date it wrote wrong, an id that does not exist), answered as a tool result with
  /// `isError` and this message.
  public struct Problem: Error, Sendable, Equatable {
    public var message: String
    public init(_ message: String) { self.message = message }
  }

  public func call(_ name: String, arguments: JSONValue) throws -> Output {
    guard let definition = Self.definitions.first(where: { $0.name == name }) else { throw Problem("There is no tool named \(name).") }
    let args = try Arguments(arguments, definition: definition, time: time)
    switch name {
    case "search": return try search(args)
    case "day": return try day(args)
    case "threads": return try threads(args)
    case "thread": return try thread(args)
    case "activity": return try activity(args)
    case "now": return try current()
    default: return try screenshot(args)
    }
  }

  // MARK: - search

  /// Screens ranked per search; enough for any page an agent reads, and a bound on the work per call.
  static let searchScreens = 500

  struct Hit {
    var capture: Capture
    var rank: Double
    var text: String?
  }

  func search(_ args: Arguments) throws -> Output {
    let query = try args.requiredString("query")
    guard let pattern = FTS5Pattern(matchingAllPrefixesIn: query) else {
      throw Problem("The query has no words to search for. Use words that were on screen.")
    }
    let range = try args.range(now: now(), defaultFrom: nil)
    let app = try args.string("app")?.trimmingCharacters(in: .whitespaces)
    let sort = try args.choice("sort", ["relevance", "newest", "oldest"], default: "relevance")
    let (limit, offset) = try args.page(default: 10, max: 25)

    var sql = """
      SELECT c.*, bm25(captureSearch, 0, 4.0, 2.0, 1.0) AS rank, snippet(captureSearch, 3, '«', '»', '…', 20) AS snip
      FROM captureSearch JOIN capture c ON c.id = captureSearch.captureID
      WHERE captureSearch MATCH ? AND c.isFocusedDisplay = 1 AND c.at >= ? AND c.at < ?
      """
    var arguments: [any DatabaseValueConvertible] = [pattern, range.from, range.to]
    if let app, !app.isEmpty {
      sql += " AND (c.appName LIKE ? OR c.urlHost LIKE ?)"
      arguments += ["%\(app)%", "%\(app)%"]
    }
    sql += " ORDER BY rank LIMIT \(Self.searchScreens)"
    let hits = try database.reader.read { db in
      try Row.fetchAll(db, sql: sql, arguments: StatementArguments(arguments)).map { row in
        let snip: String = row["snip"]
        return Hit(capture: Capture(row: row), rank: row["rank"], text: snip.contains("«") ? snip : nil)
      }
    }

    let activities = ActivityIndex(try database.activities(
      from: (hits.map(\.capture.at).min() ?? 0) - 1, to: (hits.map(\.capture.at).max() ?? 0) + 1))
    let names = try threadNames()
    struct Group {
      var best: Hit
      var earliest: Double
      var latest: Double
      var screens: Int
      var activity: Activity?
    }
    var groups: [String: Group] = [:]
    var order: [String] = []
    for hit in hits {
      let activity = activities.containing(hit.capture.at)
      let key = activity?.id.map { "a\($0)" } ?? "p\(hit.capture.context.key)|\(time.date(hit.capture.at))"
      if var group = groups[key] {
        group.screens += 1
        group.earliest = min(group.earliest, hit.capture.at)
        group.latest = max(group.latest, hit.capture.at)
        if hit.rank < group.best.rank { group.best = hit }
        groups[key] = group
      } else {
        groups[key] = Group(best: hit, earliest: hit.capture.at, latest: hit.capture.at, screens: 1, activity: activity)
        order.append(key)
      }
    }
    var ranked = order.compactMap { groups[$0] }
    switch sort {
    case "newest": ranked.sort { $0.latest > $1.latest }
    case "oldest": ranked.sort { $0.earliest < $1.earliest }
    default: break
    }
    let page = Array(ranked.dropFirst(offset).prefix(limit))

    let results = page.map { group -> JSONValue in
      let c = group.best.capture
      let a = group.activity
      return .fields([
        ("activity", a?.id.map { .number(Double($0)) }),
        ("title", a.flatMap(Self.title)),
        ("caption", a.flatMap(Self.caption)),
        ("thread", a?.threadID.flatMap { id in names[id].map { ["id": .number(Double(id)), "name": .string($0)] } }),
        ("when", .string(a.map { time.span($0.startAt, $0.endAt) } ?? time.minute(c.at))),
        ("screens", .number(Double(group.screens))),
        (
          "match",
          .fields([
            ("at", .string(time.moment(c.at))),
            ("app", c.context.appName.map(JSONValue.string)),
            ("window", Self.window(c)),
            ("url", Self.url(c)),
            ("text", group.best.text.map(JSONValue.string)),
          ])
        ),
      ])
    }
    var fields: [(String, JSONValue?)] = [
      ("query", .string(query)),
      ("from", range.fromText.map(JSONValue.string)),
      ("to", range.toText.map(JSONValue.string)),
      ("total", .number(Double(ranked.count))),
      ("matched_screens", .number(Double(hits.count))),
      ("results", .array(results)),
    ]
    fields += Self.paging(total: ranked.count, offset: offset, shown: page.count)
    if hits.isEmpty {
      fields.append(
        ("hint", "No screen held every word. Try fewer or other words that would have been visible, or a wider time range."))
    }
    return Output(
      structured: .fields(fields), image: nil,
      summary: "searched “\(query)”\(app.map { " in \($0)" } ?? "") · \(ranked.count) result\(ranked.count == 1 ? "" : "s")")
  }

  /// Activities in time order, found by the moment a capture falls in.
  struct ActivityIndex {
    let sorted: [Activity]

    init(_ activities: [Activity]) { sorted = activities.sorted { $0.startAt < $1.startAt } }

    func containing(_ at: Double) -> Activity? {
      var low = 0
      var high = sorted.count
      while low < high {
        let mid = (low + high) / 2
        if sorted[mid].startAt <= at { low = mid + 1 } else { high = mid }
      }
      guard low > 0 else { return nil }
      let candidate = sorted[low - 1]
      return at < candidate.endAt ? candidate : nil
    }
  }

  // MARK: - day

  func day(_ args: Arguments) throws -> Output {
    let text = try args.string("date") ?? "today"
    guard time.isDay(text), let start = time.moment(text, now: now()) else {
      throw Problem("Could not read date “\(text)”. Use today, yesterday or YYYY-MM-DD.")
    }
    let end = time.startOfNextDay(start)
    let activities = try database.activities(from: start, to: end)
    let threads = try allThreads()
    let timeline = DayTimeline(activities: activities, dayStart: start, dayEnd: end)
    let liveNames = threads.values.filter { $0.mergedInto == nil }.reduce(into: [Int64: String]()) { $0[$1.id ?? 0] = $1.name }
    let headline = try UnderstandingEngine.storedDayStory(
      database, timeline: timeline, threadNames: liveNames, clock: TimeFormatter(timeZone: time.timeZone))?.headline
    let captures = try database.focusedCaptures(from: start).filter { $0.at < end }
    let (previous, next) = try database.reader.read { db in
      (
        try Double.fetchOne(db, sql: "SELECT MAX(at) FROM capture WHERE isFocusedDisplay = 1 AND at < ?", arguments: [start]),
        try Double.fetchOne(db, sql: "SELECT MIN(at) FROM capture WHERE isFocusedDisplay = 1 AND at >= ?", arguments: [end])
      )
    }

    func clipped(_ a: Activity) -> Double { max(0, min(a.endAt, end) - max(a.startAt, start)) / 60 }
    let threadRows = timeline.threads.compactMap { entry -> JSONValue? in
      guard let id = entry.threadID, let thread = threads[id], entry.minutes >= 1 else { return nil }
      let own = activities.filter { $0.threadID == id }
      return [
        "id": .number(Double(id)), "name": .string(thread.name), "category": .string(thread.category.rawValue),
        "minutes": .number(entry.minutes.rounded()),
        "when": .string(Self.runs(own, gap: DayTimeline.gapMinutes * 60).map { time.span(max($0.0, start), min($0.1, end), withDate: false) }.joined(separator: ", ")),
      ]
    }
    let activityRows = activities.sorted { $0.startAt < $1.startAt }.map { a -> JSONValue in
      .fields([
        ("id", a.id.map { .number(Double($0)) }),
        ("when", .string(time.span(a.startAt, a.endAt, withDate: false))),
        ("title", Self.title(a)),
        ("thread", a.threadID.flatMap { threads[$0]?.id }.map { .number(Double($0)) }),
        ("open", a.isOpen ? .bool(true) : nil),
      ])
    }
    let places = Self.places(captures, until: min(end, now())).prefix(10).map { place -> JSONValue in
      ["place": .string(place.name), "minutes": .number(place.minutes.rounded())]
    }

    var fields: [(String, JSONValue?)] = [
      ("date", .string(time.date(start))),
      ("weekday", .string(time.weekday(start))),
      ("headline", headline.flatMap { $0.isEmpty ? nil : .string($0) }),
    ]
    if let first = activities.map(\.startAt).min(), let last = activities.map(\.endAt).max() {
      fields += [
        ("active_minutes", .number(activities.map(clipped).reduce(0, +).rounded())),
        ("span", .string(time.span(max(first, start), min(last, end), withDate: false))),
      ]
    }
    fields += [
      ("threads", .array(threadRows)),
      ("activities", .array(activityRows)),
      ("places", .array(Array(places))),
      ("previous_day", previous.map { .string(time.date($0)) }),
      ("next_day", next.map { .string(time.date($0)) }),
    ]
    if captures.isEmpty {
      let note: String
      if previous == nil, let next {
        note = "Nothing was captured on this day. The history begins on \(time.date(next))."
      } else if previous == nil {
        note = "Nothing was captured on this day, nor on any day before it."
      } else if next == nil {
        note = "Nothing was captured on this day. previous_day is the latest day with history."
      } else {
        note = "Nothing was captured on this day. previous_day and next_day are the nearest days with history."
      }
      fields.append(("note", .string(note)))
    } else if activities.isEmpty {
      fields.append(("note", "Screencap has not sorted this day into activities yet; places show where the time went."))
    }
    return Output(structured: .fields(fields), image: nil, summary: "day \(time.date(start)) · \(activities.count) activities")
  }

  /// Runs of activities with at most `gap` seconds between one's end and the next one's start.
  static func runs(_ activities: [Activity], gap: Double) -> [(Double, Double)] {
    var runs: [(Double, Double)] = []
    for a in activities.sorted(by: { $0.startAt < $1.startAt }) {
      if let last = runs.last, a.startAt - last.1 <= gap {
        runs[runs.count - 1].1 = max(last.1, a.endAt)
      } else {
        runs.append((a.startAt, a.endAt))
      }
    }
    return runs
  }

  struct Place {
    var name: String
    var minutes: Double
  }

  /// Minutes per site (else app) over focused captures: each capture holds the screen until the next one, at most
  /// two minutes, so a break never counts.
  static func places(_ captures: [Capture], until end: Double) -> [Place] {
    var minutes: [String: Double] = [:]
    for (index, capture) in captures.enumerated() {
      guard let name = capture.context.urlHost ?? capture.context.appName, capture.context.bundleID != Moments.ownBundleID else { continue }
      let next = index + 1 < captures.count ? captures[index + 1].at : end
      minutes[name, default: 0] += max(0, min(next - capture.at, 120)) / 60
    }
    return minutes.filter { $0.value >= 1 }.map { Place(name: $0.key, minutes: $0.value) }
      .sorted { $0.minutes == $1.minutes ? $0.name < $1.name : $0.minutes > $1.minutes }
  }

  // MARK: - threads

  func threads(_ args: Arguments) throws -> Output {
    let query = try args.string("query")?.trimmingCharacters(in: .whitespaces)
    let hasQuery = !(query ?? "").isEmpty
    let t = now()
    let range = try args.range(now: t, defaultFrom: hasQuery ? nil : time.days(before: t, 6))
    let category = try args.string("category").map { text -> ActivityCategory in
      guard let match = ActivityCategory.allCases.first(where: { $0.rawValue.lowercased() == text.lowercased() }) else {
        throw Problem("Unknown category “\(text)”. Use one of \(ActivityCategory.allCases.map(\.rawValue).joined(separator: ", ")).")
      }
      return match
    }
    let (limit, offset) = try args.page(default: 20, max: 50)
    let threads = try allThreads()
    let activities = try database.activities(from: range.from, to: range.to)

    struct Tally {
      var minutes = 0.0
      var days = Set<String>()
      var lastSeen = 0.0
    }
    var tallies: [Int64: Tally] = [:]
    for a in activities {
      guard let id = a.threadID else { continue }
      tallies[id, default: Tally()].minutes += max(0, min(a.endAt, range.to) - max(a.startAt, range.from)) / 60
      tallies[id, default: Tally()].days.insert(time.date(a.startAt))
      tallies[id, default: Tally()].lastSeen = max(tallies[id, default: Tally()].lastSeen, a.endAt)
    }
    let words = (query ?? "").lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    let rows = tallies.compactMap { id, tally -> (ActivityThread, Tally)? in
      guard let thread = threads[id], category == nil || thread.category == category else { return nil }
      if !words.isEmpty {
        let haystack = ([thread.name, thread.summary] + thread.captions + thread.includes).joined(separator: " ")
        guard words.allSatisfy({ haystack.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) != nil }) else { return nil }
      }
      return (thread, tally)
    }
    .sorted { $0.1.minutes == $1.1.minutes ? ($0.0.id ?? 0) < ($1.0.id ?? 0) : $0.1.minutes > $1.1.minutes }
    let page = Array(rows.dropFirst(offset).prefix(limit))
    var fields: [(String, JSONValue?)] = [
      ("from", range.fromText.map(JSONValue.string) ?? (hasQuery ? "all time" : nil)),
      ("to", .string(range.toText ?? time.minute(t))),
      ("query", query.flatMap { $0.isEmpty ? nil : .string($0) }),
      ("total", .number(Double(rows.count))),
      (
        "threads",
        .array(
          page.map { thread, tally in
            [
              "id": .number(Double(thread.id ?? 0)), "name": .string(thread.name), "category": .string(thread.category.rawValue),
              "summary": .string(thread.summary), "minutes": .number(tally.minutes.rounded()),
              "days": .number(Double(tally.days.count)), "last_seen": .string(time.minute(tally.lastSeen)),
            ]
          })
      ),
    ]
    fields += Self.paging(total: rows.count, offset: offset, shown: page.count)
    if rows.isEmpty {
      fields.append(("hint", hasQuery ? "No thread matched every word. Try fewer words or a wider range." : "No thread had time in this range."))
    }
    return Output(
      structured: .fields(fields), image: nil,
      summary: "threads\(hasQuery ? " “\(query!)”" : "") · \(rows.count) found")
  }

  // MARK: - thread

  func thread(_ args: Arguments) throws -> Output {
    let id = try args.requiredInt("id")
    let threads = try allThreads()
    guard var thread = threads[Int64(id)] else {
      throw Problem("There is no thread \(id). `threads` lists threads with their ids.")
    }
    var hops = 0
    while let survivor = thread.mergedInto.flatMap({ threads[$0] }), hops < 32 {
      thread = survivor
      hops += 1
    }
    let (limit, offset) = try args.page(default: 20, max: 100)
    let activities = try database.activities(threadID: thread.id ?? 0)
    var perDay: [String: Double] = [:]
    for a in activities { perDay[time.date(a.startAt), default: 0] += a.minutes }
    let newestFirst = activities.reversed()
    let page = Array(newestFirst.dropFirst(offset).prefix(limit))
    var fields: [(String, JSONValue?)] = [
      ("id", .number(Double(thread.id ?? 0))),
      ("merged_from", thread.id == Int64(id) ? nil : .number(Double(id))),
      ("name", .string(thread.name)),
      ("category", .string(thread.category.rawValue)),
      ("summary", .string(thread.summary)),
      ("first_seen", activities.first.map { .string(time.minute($0.startAt)) }),
      ("last_seen", activities.last.map { .string(time.minute($0.endAt)) }),
      ("minutes", .number(activities.map(\.minutes).reduce(0, +).rounded())),
      ("activity_count", .number(Double(activities.count))),
      (
        "days",
        .array(perDay.sorted { $0.key > $1.key }.prefix(14).map { ["date": .string($0.key), "minutes": .number($0.value.rounded())] })
      ),
      (
        "activities",
        .array(
          page.map { a in
            .fields([
              ("id", a.id.map { .number(Double($0)) }),
              ("when", .string(time.span(a.startAt, a.endAt))),
              ("title", Self.title(a)),
              ("caption", Self.caption(a)),
            ])
          })
      ),
    ]
    fields += Self.paging(total: activities.count, offset: offset, shown: page.count)
    return Output(structured: .fields(fields), image: nil, summary: "thread \(thread.id ?? 0) “\(thread.name)”")
  }

  // MARK: - activity

  func activity(_ args: Arguments) throws -> Output {
    let id = try args.requiredInt("id")
    let textLimit = try args.int("text_limit", default: 3000, range: 500...20_000)
    guard let activity = try database.activity(id: Int64(id)) else {
      throw Problem("There is no activity \(id). `search`, `day` and `thread` list activities with their ids.")
    }
    let captures = try database.captures(of: activity)
    let thread = try activity.threadID.flatMap { try database.thread(id: $0) }

    struct Seen {
      var capture: Capture
      var screens: Int
    }
    var places: [String: Seen] = [:]
    var placeOrder: [String] = []
    for capture in captures where capture.context.bundleID != Moments.ownBundleID {
      let key = capture.context.key
      if places[key] == nil {
        places[key] = Seen(capture: capture, screens: 0)
        placeOrder.append(key)
      }
      places[key]?.screens += 1
    }
    let placeRows = placeOrder.prefix(20).compactMap { places[$0] }.map { seen -> JSONValue in
      .fields([
        ("app", seen.capture.context.appName.map(JSONValue.string)),
        ("window", Self.window(seen.capture)),
        ("url", Self.url(seen.capture)),
        ("at", .string(time.moment(seen.capture.at))),
        ("screens", .number(Double(seen.screens))),
      ])
    }

    var lines: [String] = []
    var seenLines = Set<String>()
    let read = captures.filter { !$0.isDuplicate && $0.ocrState == .done && $0.context.bundleID != Moments.ownBundleID }
    for capture in read {
      for line in CaptureText.readingOrder(try database.ocrLines(captureID: capture.id)) {
        let key = line.lowercased()
        if seenLines.insert(key).inserted { lines.append(line) }
      }
    }
    let fullText = lines.joined(separator: "\n")
    let text = String(fullText.prefix(textLimit))

    let fields: [(String, JSONValue?)] = [
      ("id", .number(Double(id))),
      ("when", .string(time.span(activity.startAt, activity.endAt))),
      ("minutes", .number(activity.minutes.rounded())),
      ("open", activity.isOpen ? .bool(true) : nil),
      ("title", Self.title(activity)),
      ("caption", Self.caption(activity)),
      ("thread", thread.map { ["id": .number(Double($0.id ?? 0)), "name": .string($0.name)] }),
      ("places", .array(placeRows)),
      ("more_places", placeOrder.count > 20 ? .number(Double(placeOrder.count - 20)) : nil),
      ("screenshot_at", Moments.representative(among: captures).map { .string(time.moment($0.at)) }),
      ("screen_text", .string(text)),
      ("text_truncated", text.count < fullText.count ? .bool(true) : nil),
    ]
    return Output(
      structured: .fields(fields), image: nil,
      summary: "activity \(id)\(activity.title.map { " “\($0)”" } ?? "")")
  }

  // MARK: - now

  func current() throws -> Output {
    let t = now()
    let latest = try database.focusedCaptures(before: .greatestFiniteMagnitude, count: 1).last
    let marker = try latest.flatMap { try database.markers(from: $0.at, to: .greatestFiniteMagnitude).last }
    let open = try database.latestActivity().flatMap { $0.isOpen ? $0 : nil }
    let threads = try allThreads()
    let earlier = try database.activities(from: time.startOfDay(t), to: t).filter { !$0.isOpen }.suffix(5).reversed()
    let first = try database.reader.read { db in
      try Double.fetchOne(db, sql: "SELECT MIN(at) FROM capture WHERE isFocusedDisplay = 1")
    }

    var screen: JSONValue?
    if let latest {
      let lines = try database.ocrLines(captureID: latest.id)
      screen = .fields([
        ("at", .string(time.moment(latest.at))),
        ("app", latest.context.appName.map(JSONValue.string)),
        ("window", Self.window(latest)),
        ("url", Self.url(latest)),
        ("text", lines.isEmpty ? nil : .string(CaptureText.excerpt(lines, limit: 1000))),
      ])
    }
    let fields: [(String, JSONValue?)] = [
      ("now", .string(time.minute(t))),
      ("time_zone", .string(time.zoneName(at: t))),
      ("capture", .string(Self.captureState(latest: latest, marker: marker, now: t))),
      ("history_since", first.map { .string(time.minute($0)) }),
      ("screen", screen),
      (
        "activity",
        open.map { a in
          .fields([
            ("id", a.id.map { .number(Double($0)) }),
            ("since", .string(time.minute(a.startAt))),
            ("thread", a.threadID.flatMap { id in threads[id].map { ["id": .number(Double(id)), "name": .string($0.name)] } }),
          ])
        }
      ),
      (
        "earlier_today",
        .array(
          earlier.map { a in
            .fields([
              ("id", a.id.map { .number(Double($0)) }),
              ("when", .string(time.span(a.startAt, a.endAt, withDate: false))),
              ("title", Self.title(a)),
              ("thread", a.threadID.flatMap { id in threads[id].map { ["id": .number(Double(id)), "name": .string($0.name)] } }),
            ])
          })
      ),
    ]
    return Output(structured: .fields(fields), image: nil, summary: "what is on screen now")
  }

  static func captureState(latest: Capture?, marker: Marker?, now: Double) -> String {
    guard let latest else { return "nothing captured yet" }
    switch marker?.kind {
    case .paused: return "paused by the person"
    case .quit: return "Screencap is not running"
    case .sleep: return "away: the Mac is asleep"
    case .screenLocked: return "away: the screen is locked"
    case .idle: return "away: no input for a while"
    case .secureInput: return "paused while a password field has focus"
    case .excluded: return "an excluded app or a private window is in front"
    case .permissionLost: return "stopped: Screen Recording permission is off"
    default:
      let minutes = Int(((now - latest.at) / 60).rounded())
      return minutes <= 2 ? "capturing" : "no screen captured for \(minutes) min; Screencap may not be running"
    }
  }

  // MARK: - screenshot

  /// The longer side of a returned screenshot: the size Claude reads without scaling it down, about 2,000 image tokens.
  static let screenshotPixels = 1568

  func screenshot(_ args: Arguments) throws -> Output {
    let text = try args.requiredString("at")
    let cropToWindow = try args.choice("crop", ["window", "screen"], default: "window") == "window"
    let t: Double
    if text.trimmingCharacters(in: .whitespaces).lowercased() == "now" {
      t = .greatestFiniteMagnitude
    } else {
      guard let parsed = time.moment(text, now: now()) else {
        throw Problem("Could not read “\(text)”. Use now or a moment such as 2026-10-15 14:05:12.")
      }
      t = parsed
    }
    guard let capture = try database.focusedCaptures(before: t == .greatestFiniteMagnitude ? t : t + 1, count: 1).last else {
      throw Problem("No screenshot was taken at or before \(t == .greatestFiniteMagnitude ? "now" : time.moment(t)).")
    }
    if t != .greatestFiniteMagnitude, t - capture.at > 600 {
      throw Problem(
        "No screenshot in the 10 minutes before \(time.moment(t)); the person was away or capture was off. The latest one before it is at \(time.moment(capture.at)).")
    }
    var frame = capture
    if frame.framePath == nil, let original = frame.duplicateOf, let source = try database.capture(id: original) { frame = source }
    guard let path = frame.framePath, FileManager.default.fileExists(atPath: location.url(path).path) else {
      throw Problem("The screenshot at \(time.moment(capture.at)) is no longer on this Mac.")
    }
    let crop = cropToWindow ? frame.window.flatMap { $0.isWorthCropping ? $0 : nil } : nil
    var cropNote: String?
    if cropToWindow, crop == nil {
      if let window = frame.window {
        cropNote =
          window.width * window.height >= 0.995
          ? "The window filled the display, so this is the whole display."
          : "The window covered too little of the display to show alone, so this is the whole display."
      } else {
        cropNote = "Screencap did not record where the window was, so this is the whole display."
      }
    }
    guard let image = FrameEncoder.image(at: location.url(path), maxPixels: Self.screenshotPixels, crop: crop),
      let jpeg = Self.jpeg(image)
    else { throw Problem("The screenshot at \(time.moment(capture.at)) could not be read.") }
    let fields: [(String, JSONValue?)] = [
      ("at", .string(time.moment(capture.at))),
      ("app", capture.context.appName.map(JSONValue.string)),
      ("window", Self.window(capture)),
      ("url", Self.url(capture)),
      ("crop", .string(crop == nil ? "screen" : "window")),
      ("crop_note", cropNote.map(JSONValue.string)),
      ("width", .number(Double(image.width))),
      ("height", .number(Double(image.height))),
    ]
    return Output(
      structured: .fields(fields), image: Image(data: jpeg, mimeType: "image/jpeg"),
      summary: "screenshot \(time.moment(capture.at))\(capture.context.appName.map { " (\($0))" } ?? "")")
  }

  static func jpeg(_ image: CGImage) -> Data? {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
  }

  // MARK: - Shared

  /// Every thread by id, merged ones included, since an id an agent holds may have been merged away since.
  func allThreads() throws -> [Int64: ActivityThread] {
    try database.reader.read { db in
      try ActivityThread.fetchAll(db, sql: "SELECT * FROM thread").reduce(into: [:]) { $0[$1.id ?? 0] = $1 }
    }
  }

  func threadNames() throws -> [Int64: String] { try allThreads().mapValues(\.name) }

  static func title(_ a: Activity) -> JSONValue? {
    guard let title = a.title, !title.isEmpty else { return nil }
    return .string(title)
  }

  static func caption(_ a: Activity) -> JSONValue? {
    guard let caption = a.caption, !caption.isEmpty else { return nil }
    return .string(caption)
  }

  static func window(_ c: Capture) -> JSONValue? {
    guard let title = c.context.windowTitle?.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces),
      !title.isEmpty
    else { return nil }
    return .string(String(title.prefix(150)))
  }

  /// `github.com/apple/swift-collections`: the page without its query, which Screencap never records.
  static func url(_ c: Capture) -> JSONValue? {
    guard let host = c.context.urlHost, !host.isEmpty else { return nil }
    let path = c.context.urlPath ?? ""
    return .string(String((path == "/" || path.isEmpty ? host : host + path).prefix(150)))
  }

  static func paging(total: Int, offset: Int, shown: Int) -> [(String, JSONValue?)] {
    let more = offset + shown < total
    return [("more", .bool(more)), ("next_offset", more ? .number(Double(offset + shown)) : nil)]
  }
}
