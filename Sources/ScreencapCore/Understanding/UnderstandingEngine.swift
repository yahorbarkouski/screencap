import CryptoKit
import Foundation

public struct UnderstandingConfig: Sendable {
  /// Seconds between timer captures; also the duration given to an activity's last capture.
  public var cadence: Double = 60
  /// A longer gap between two captures ends the activity (nobody was there, or capture was off).
  public var hardGap: Double = 600
  /// p(new) above this is a boundary. 0.45 was tuned on the experiment's two-minute days (Oct 11–12). On the app's
  /// own stream, 0.85 fit the morning it was chosen on and missed the evening's short check-ins; on a stretch held out
  /// for the comparison (2026-10-15 19:00–20:00), 0.45 with the join scored 0.593 against 0.421.
  public var boundaryThreshold = 0.45
  /// A boundary the decider drew is joined to the activity before it when p(the activity after continues the one
  /// before) is above this, on a second look at both; nil skips the second look.
  public var joinThreshold: Double? = 0.5
  /// Writes a short title for each activity, for the Day view: asked together with the caption, and on its own only
  /// for an activity captioned without one.
  public var writesTitles = true
  /// The join question sees the activity after a boundary up to its next boundary or this long, so an activity
  /// still closes within about three minutes of its boundary. On 2026-10-15, 45, 60 and 90 s joined the same
  /// boundaries; at 90 s captions and threads came 218 s after their boundary on average.
  public var joinWindowSeconds: Double = 45
  public var window = 12
  /// Captures after a gap that the boundary question waits for.
  public var lookahead = 2
  /// No screenshots in any model call.
  public var textOnly = false
  public var concurrency = 8
  public var liveThreadDays: Double = 30
  /// Model calls that fail for one item (see `isItemFailure`) before the item is settled without an answer.
  public var itemAttempts = 3
  public var clock = TimeFormatter()

  public init() {}

  /// The measured setup of the experiment's two-minute days, which the replay reproduces.
  public static var experiment: UnderstandingConfig {
    var config = UnderstandingConfig()
    config.cadence = 120
    config.boundaryThreshold = 0.45
    config.joinThreshold = nil
    config.writesTitles = false
    return config
  }
}

public struct AdvanceReport: Sendable, Equatable {
  public var boundaries = 0
  public var joins = 0
  public var closedActivities = 0
  public var captions = 0
  public var titles = 0
  public var threads = 0
  public var provisional = 0

  public var didWork: Bool { boundaries + joins + closedActivities + captions + titles + threads + provisional > 0 }
}

/// Turns captures into activities, captions and threads by asking the decision model, one stage at a time.
///
/// Every stage reads its input from the database and writes its answers before the next stage reads them, so the
/// engine can stop at any point (no network, app quit) and continue later without asking anything twice. A call that
/// fails for one item (a refusal, an answer out of shape, a rejected request) is logged and the stage goes on with
/// the other items; after `itemAttempts` such failures the item is settled without an answer, so it never holds up
/// later work. Any other failure (no network, no key) ends the pass, and the next pass resumes.
public actor UnderstandingEngine {
  let database: AppDatabase
  let location: StoreLocation
  let decider: any DecisionModel
  let writer: any TextModel
  public private(set) var config: UnderstandingConfig
  private var isAdvancing = false
  /// Model JPEGs of recent frames, newest last. A frame is shown in two boundary questions and often a caption or
  /// thread question within minutes, and making its JPEG from the stored HEIC costs about 24 ms of CPU.
  private var modelImages: [(id: String, jpeg: Data)] = []
  static let modelImageCacheSize = 24

  public init(
    database: AppDatabase, location: StoreLocation, decider: any DecisionModel, writer: any TextModel,
    config: UnderstandingConfig
  ) {
    self.database = database
    self.location = location
    self.decider = decider
    self.writer = writer
    self.config = config
  }

  public func setTextOnly(_ value: Bool) {
    config.textOnly = value
  }

  /// Runs every stage as far as the evidence allows. Concurrent calls coalesce into the running pass.
  @discardableResult
  public func advance(now: Double) async throws -> AdvanceReport {
    guard !isAdvancing else { return AdvanceReport() }
    isAdvancing = true
    defer { isAdvancing = false }
    var report = AdvanceReport()
    report.boundaries = try await decideBoundaries(now: now)
    report.joins = try await decideJoins(now: now)
    report.closedActivities = try buildActivities(now: now)
    report.captions = try await captionClosedActivities()
    report.titles = try await titleActivities()
    report.threads = try await threadClosedActivities()
    report.provisional = try await provisionalThread(now: now)
    return report
  }

  // MARK: - Stage 1: boundaries

  struct BoundaryJob {
    let left: Capture
    let right: Capture
    let window: [CaptureEvidence]
    let windowStart: Int
    let segmentStart: Int
    let rightIndex: Int
  }

  /// Anchors get the question, over a window of the anchors before them, so the window spans the same stretch of
  /// time however many evidence frames fall between. An evidence frame continues the capture before it, unless a hard
  /// fact ends the activity there.
  func decideBoundaries(now: Double) async throws -> Int {
    guard let earliest = try database.earliestUndecidedCapture() else { return 0 }
    let pendingAll = try database.focusedCaptures(from: earliest.at)
    let previous = try database.focusedCaptures(before: earliest.at, count: 1).first
    let before = try database.focusedCaptures(before: earliest.at, count: config.window, anchorsOnly: true)
    let pending = pendingAll.filter(\.isAnchor)
    let all = before + pending
    let firstAt = min(previous?.at ?? earliest.at, before.first?.at ?? earliest.at)
    let markers = try database.markers(from: firstAt - 1, to: max(now, pendingAll.last?.at ?? earliest.at))
    let breaks = markers.filter { $0.kind.breaksActivity }.map(\.at)
    func isHardBreak(_ l: Capture, _ r: Capture) -> Bool {
      r.at - l.at > config.hardGap || breaks.contains { $0 > l.at && $0 <= r.at }
    }
    let decided = Set(try database.boundaries(rightCaptureIDs: pendingAll.map(\.id)).keys)

    var ruled: [BoundaryDecision] = []
    var left = previous
    for capture in pendingAll {
      defer { left = capture }
      guard !capture.isAnchor, !decided.contains(capture.id), let left else { continue }
      ruled.append(
        isHardBreak(left, capture)
          ? .init(rightCaptureID: capture.id, leftCaptureID: left.id, pNew: 1, isBoundary: true, source: .hardBreak, decidedAt: now)
          : .init(rightCaptureID: capture.id, leftCaptureID: left.id, pNew: 0, isBoundary: false, source: .evidence, decidedAt: now))
    }
    var jobs: [BoundaryJob] = []
    if all.count >= 2 {
      let lastAt = all.last!.at
      let lastSegmentClosed = now - lastAt > config.hardGap || breaks.contains { $0 > lastAt && $0 <= now }
      try addAnchorJobs(
        all: all, firstPending: before.count, decided: decided, lastSegmentClosed: lastSegmentClosed,
        isHardBreak: isHardBreak, now: now, ruled: &ruled, jobs: &jobs)
    }
    for decision in ruled { try database.save(decision, decision: nil) }

    try await withThrowingTaskGroup(of: Void.self) { group in
      var running = 0
      for job in jobs {
        if running >= config.concurrency {
          try await group.next()
          running -= 1
        }
        group.addTask {
          try await self.settlingItemFailures(subject: "boundary:\(job.right.id)") {
            try await self.askBoundary(job, now: now)
          } settle: {
            try self.database.save(
              BoundaryDecision(
                rightCaptureID: job.right.id, leftCaptureID: job.left.id, pNew: 0, isBoundary: false, source: .unanswered,
                decidedAt: now),
              decision: nil)
          }
        }
        running += 1
      }
      try await group.waitForAll()
    }
    return ruled.count + jobs.count
  }

  /// Rulings and questions for the undecided anchors in `all` (anchors, oldest first; the pending ones start at
  /// `firstPending`).
  private func addAnchorJobs(
    all: [Capture], firstPending: Int, decided: Set<String>, lastSegmentClosed: Bool,
    isHardBreak: (Capture, Capture) -> Bool, now: Double, ruled: inout [BoundaryDecision], jobs: inout [BoundaryJob]
  ) throws {
    var segmentStart = [Int](repeating: 0, count: all.count)
    for i in 1..<all.count { segmentStart[i] = isHardBreak(all[i - 1], all[i]) ? i : segmentStart[i - 1] }
    var segmentEnd = [Int](repeating: all.count - 1, count: all.count)
    for i in stride(from: all.count - 2, through: 0, by: -1) {
      segmentEnd[i] = segmentStart[i + 1] == i + 1 ? i : segmentEnd[i + 1]
    }
    let resolved = try database.ocrResolved(ids: all.map(\.id))
    let evidence = try database.evidence(for: all)
    for i in firstPending..<all.count where i >= 1 && !decided.contains(all[i].id) {
      let l = all[i - 1]
      let r = all[i]
      if isHardBreak(l, r) {
        ruled.append(.init(rightCaptureID: r.id, leftCaptureID: l.id, pNew: 1, isBoundary: true, source: .hardBreak, decidedAt: now))
        continue
      }
      if r.isDuplicate, r.context.key == l.context.key {
        ruled.append(.init(rightCaptureID: r.id, leftCaptureID: l.id, pNew: 0, isBoundary: false, source: .duplicate, decidedAt: now))
        continue
      }
      let hi = segmentEnd[i]
      let closed = hi < all.count - 1 || lastSegmentClosed
      guard hi - i >= config.lookahead || closed else { continue }
      let n = min(hi, i + config.lookahead)
      let first = max(segmentStart[i], n - config.window + 1)
      guard (first...n).allSatisfy({ resolved.contains(all[$0].id) }) else { continue }
      jobs.append(BoundaryJob(left: l, right: r, window: Array(evidence[first...n]), windowStart: first, segmentStart: segmentStart[i], rightIndex: i))
    }
  }

  func askBoundary(_ job: BoundaryJob, now: Double) async throws {
    let label = { (index: Int) in "c\(index - job.windowStart + 1)" }
    var lines: [String] = []
    for (offset, item) in job.window.enumerated() {
      let index = job.windowStart + offset
      let previous = index > job.segmentStart && offset > 0 ? job.window[offset - 1] : nil
      lines.append("\(label(index)): " + CaptureText.windowLine(item, previous: previous, clock: config.clock))
    }
    if job.windowStart > job.segmentStart {
      // The window starts mid-segment: the first line's new text compares against the capture just before it.
      let before = try database.evidence(
        for: try database.focusedCaptures(before: job.window[0].capture.at, count: 1, anchorsOnly: true))
      if let previous = before.first {
        lines[0] = "\(label(job.windowStart)): " + CaptureText.windowLine(job.window[0], previous: previous, clock: config.clock)
      }
    }
    var state: [StatePart] = [
      .text("Rule: \(Questions.boundaryRule)"),
      .text(Questions.capturesHeader(cadence: config.cadence) + "\n" + lines.joined(separator: "\n")),
    ]
    if !config.textOnly {
      for (capture, index) in [(job.left, job.rightIndex - 1), (job.right, job.rightIndex)] {
        if let image = try modelImage(capture) { state += [.text("Screenshot of capture \(label(index)):"), .image(image)] }
      }
    }
    let question = Questions.boundaryGap(right: label(job.rightIndex), left: label(job.rightIndex - 1))
    let result = try await decider.decide(state: state, questions: [("g", .noul(question))])
    guard let pNew = result.answers["g"]?.yesProbability else { throw ModelError.malformed("boundary answer") }
    let isBoundary = pNew > config.boundaryThreshold
    try database.save(
      BoundaryDecision(
        rightCaptureID: job.right.id, leftCaptureID: job.left.id, pNew: pNew, isBoundary: isBoundary, source: .model,
        decidedAt: now),
      decision: DecisionRecord(
        kind: "boundary", subject: job.right.id, answer: isBoundary ? "new" : "same", probability: pNew, usage: result.usage,
        at: now))
  }

  // MARK: - Stage 1b: a second look at each boundary

  struct JoinJob {
    let boundary: BoundaryDecision
    let before: [CaptureEvidence]
    let after: [CaptureEvidence]
  }

  /// Asks, for each boundary the decider drew, whether the activity after it continues the one before it, in time
  /// order so a joined activity is the "before" of the next question.
  func decideJoins(now: Double) async throws -> Int {
    guard let threshold = config.joinThreshold else { return 0 }
    var count = 0
    for boundary in try database.boundariesAwaitingJoin() {
      guard let job = try joinJob(boundary, now: now) else { break }
      try await settlingItemFailures(subject: "join:\(boundary.rightCaptureID)") {
        try await self.askJoin(job, threshold: threshold, now: now)
      } settle: {
        try self.database.record(
          DecisionRecord(
            kind: "join", subject: boundary.rightCaptureID, answer: "keep", probability: nil, model: "", inputTokens: 0,
            costUSD: 0, latencyMS: 0, createdAt: now))
      }
      count += 1
    }
    return count
  }

  /// The activity before the boundary (its last `window` anchors) and the one after it (every capture, evidence too, up
  /// to its next boundary or `joinWindowSeconds`); nil while the activity after is still shorter than that and has
  /// not ended.
  func joinJob(_ boundary: BoundaryDecision, now: Double) throws -> JoinJob? {
    guard let right = try database.capture(id: boundary.rightCaptureID) else { return nil }
    let cutAt = try database.lastBoundaryCapture(before: right.at)?.at ?? 0
    let before = try database.focusedCaptures(before: right.at, count: config.window, anchorsOnly: true)
      .filter { $0.at >= cutAt }
    guard !before.isEmpty else { return nil }
    let following = try database.focusedCaptures(from: right.at, limit: 40)
    let decided = try database.boundaries(rightCaptureIDs: following.map(\.id))
    var after = [right]
    var complete = false
    for capture in following.dropFirst() {
      if capture.at - right.at > config.joinWindowSeconds {
        complete = true
        break
      }
      guard let next = decided[capture.id] else { break }
      if next.isBoundary {
        complete = true
        break
      }
      after.append(capture)
    }
    let last = after.last!
    if !complete, now - last.at <= config.hardGap, try !database.hasBreakMarker(after: last.at, upTo: now) { return nil }
    return JoinJob(boundary: boundary, before: try database.evidence(for: before), after: try database.evidence(for: after))
  }

  func askJoin(_ job: JoinJob, threshold: Double, now: Double) async throws {
    func render(_ items: [CaptureEvidence]) -> String {
      ActivityEvidence(captures: items, cadence: config.cadence, clock: config.clock).sample(8).map { item in
        let c = item.capture
        let title = String((c.context.windowTitle ?? "").replacingOccurrences(of: "\n", with: " ").prefix(90))
        return "\(config.clock.hourMinuteSecond(c.at)) | \(c.context.appName ?? "?") | \(title) | \(c.context.urlHost ?? "-") | "
          + "text: \(CaptureText.excerpt(item.lines, limit: 160))"
      }.joined(separator: "\n")
    }
    var state: [StatePart] = [
      .text("Rule: \(Questions.joinRule)"), .text("Activity A:\n" + render(job.before)), .text("Activity B:\n" + render(job.after)),
    ]
    if !config.textOnly {
      for (label, capture) in [("activity A", job.before.last!.capture), ("activity B", job.after[job.after.count / 2].capture)] {
        if let image = try modelImage(capture) { state += [.text("Screenshot from \(label):"), .image(image)] }
      }
    }
    let result = try await decider.decide(state: state, questions: [("j", .noul(Questions.join))])
    guard let pJoin = result.answers["j"]?.yesProbability else { throw ModelError.malformed("join answer") }
    let joined = pJoin > threshold
    let record = DecisionRecord(
      kind: "join", subject: job.boundary.rightCaptureID, answer: joined ? "join" : "keep", probability: pJoin,
      usage: result.usage, at: now)
    if joined {
      var boundary = job.boundary
      boundary.isBoundary = false
      boundary.source = .joined
      try database.save(boundary, decision: record)
    } else {
      try database.record(record)
    }
  }

  // MARK: - Stage 2: activities

  func buildActivities(now: Double) throws -> Int {
    var closed = 0
    var current: Activity
    if let latest = try database.latestActivity() {
      current = latest
    } else {
      guard let first = try database.focusedCaptures(from: 0, limit: 1).first else { return 0 }
      current = try database.insert(
        Activity(firstCaptureID: first.id, lastCaptureID: first.id, startAt: first.at, endAt: first.at + config.cadence,
          captureCount: 1, isOpen: true))
    }
    guard var last = try database.capture(id: current.lastCaptureID) else { return 0 }
    while true {
      let next = try database.focusedCaptures(from: last.at + 0.000_001, limit: 500)
      if next.isEmpty { break }
      let decided = try database.boundaries(rightCaptureIDs: next.map(\.id))
      let awaitingJoin =
        config.joinThreshold == nil
        ? []
        : try database.awaitingJoin(rightCaptureIDs: decided.values.filter { $0.source == .model && $0.isBoundary }.map(\.rightCaptureID))
      var progressed = false
      for capture in next {
        guard let boundary = decided[capture.id], !awaitingJoin.contains(capture.id) else { break }
        progressed = true
        // A closed activity never grows again; whatever follows it starts a new one.
        if boundary.isBoundary || !current.isOpen {
          if current.isOpen {
            current.isOpen = false
            current.endAt = boundary.source == .hardBreak ? last.at + config.cadence : capture.at
            try database.update(current)
            closed += 1
          }
          current = try database.insert(
            Activity(firstCaptureID: capture.id, lastCaptureID: capture.id, startAt: capture.at,
              endAt: capture.at + config.cadence, captureCount: 1, isOpen: true))
        } else {
          current.lastCaptureID = capture.id
          current.endAt = capture.at + config.cadence
          current.captureCount += 1
          try database.update(current)
        }
        last = capture
      }
      if !progressed || next.count < 500 { break }
    }
    // The open activity ends when its segment does: nobody came back within the hard gap, or a break marker came.
    if current.isOpen {
      let markerAfter = try database.hasBreakMarker(after: last.at, upTo: now)
      let ended = now - last.at > config.hardGap || markerAfter
      if ended {
        current.isOpen = false
        current.endAt = last.at + config.cadence
        try database.update(current)
        closed += 1
      }
    }
    return closed
  }

  // MARK: - Stage 3: captions

  func captionClosedActivities() async throws -> Int {
    let activities = try database.closedActivitiesWithoutCaption()
    guard !activities.isEmpty else { return 0 }
    try await withThrowingTaskGroup(of: Void.self) { group in
      var running = 0
      for activity in activities {
        if running >= config.concurrency {
          try await group.next()
          running -= 1
        }
        group.addTask {
          try await self.settlingItemFailures(subject: "caption:\(activity.id ?? 0)") {
            try await self.caption(activity)
          } settle: {
            // An empty caption: the timeline says the activity has no description, and threading goes on without one.
            try self.database.setCaption("", activityID: activity.id ?? 0, lastCaptureID: activity.lastCaptureID)
          }
        }
        running += 1
      }
      try await group.waitForAll()
    }
    return activities.count
  }

  func caption(_ activity: Activity) async throws {
    guard let id = activity.id else { return }
    if let earlier = try database.decision(kind: "caption", subject: "activity:\(id)") {
      try database.setCaption(earlier.answer, activityID: id, lastCaptureID: activity.lastCaptureID)
      return
    }
    let evidence = try activityEvidence(activity)
    let question = config.writesTitles ? Questions.captionAndTitle : Questions.caption
    var content: [StatePart] = [.text(question + evidence.text(ocrLimit: 300))]
    if !config.textOnly, let image = try firstImage(of: evidence) { content.append(.image(image)) }
    let result = try await writer.json(
      content: content, keys: config.writesTitles ? ["caption", "title"] : ["caption"], purpose: "caption")
    let caption = Self.written(result.values["caption"], limit: Self.captionLimit) ?? ""
    try database.setCaption(caption, activityID: id, lastCaptureID: activity.lastCaptureID)
    try database.record(DecisionRecord(kind: "caption", subject: "activity:\(id)", answer: caption, probability: nil, usage: result.usage, at: Date().timeIntervalSince1970))
    // The title came with the caption; without one, the title stage asks for it from the caption.
    if config.writesTitles, let title = result.values["title"].map(Self.cleanTitle), !title.isEmpty {
      try database.setTitle(title, activityID: id)
    }
  }

  static func cleanTitle(_ text: String) -> String {
    (written(text, limit: nameLimit) ?? "").trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
  }

  static let captionLimit = 280
  static let nameLimit = 60

  /// Model-written text as it is stored: one line, no control characters, cut at a word within `limit`. Captions,
  /// titles and thread cards are written from screen text a page controls and are sent again in later questions for
  /// weeks, so a page cannot plant a long instruction in them.
  static func written(_ text: String?, limit: Int) -> String? {
    guard let text else { return nil }
    var line = String(String.UnicodeScalarView(text.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) ? " " : $0 }))
    line = line.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    guard line.count > limit else { return line }
    let cut = line.prefix(limit)
    return String(cut.lastIndex(of: " ").map { cut[..<$0] } ?? cut)
  }

  // MARK: - Stage 3b: titles

  func titleActivities() async throws -> Int {
    guard config.writesTitles else { return 0 }
    let activities = try database.activitiesAwaitingTitle()
    guard !activities.isEmpty else { return 0 }
    try await withThrowingTaskGroup(of: Void.self) { group in
      var running = 0
      for activity in activities {
        if running >= config.concurrency {
          try await group.next()
          running -= 1
        }
        group.addTask {
          try await self.settlingItemFailures(subject: "title:\(activity.id ?? 0)") {
            try await self.title(activity)
          } settle: {
            try self.database.setTitle("", activityID: activity.id ?? 0)
          }
        }
        running += 1
      }
      try await group.waitForAll()
    }
    return activities.count
  }

  func title(_ activity: Activity) async throws {
    guard let id = activity.id, let caption = activity.caption else { return }
    let result = try await writer.json(content: [.text(Questions.title + caption)], keys: ["title"], purpose: "title")
    let title = Self.cleanTitle(result.values["title"] ?? "")
    try database.setTitle(title, activityID: id)
    try database.record(
      DecisionRecord(kind: "title", subject: "activity:\(id)", answer: title, probability: nil, usage: result.usage, at: Date().timeIntervalSince1970))
  }

  // MARK: - Stage 4: threads

  /// In time order, so each answer sees the cards the earlier ones shaped. An activity still waiting for its caption
  /// is passed over until it has one.
  func threadClosedActivities() async throws -> Int {
    var count = 0
    for activity in try database.closedActivitiesAwaitingThread() where activity.caption != nil {
      try await settlingItemFailures(subject: "thread:\(activity.id ?? 0)") {
        try await assignThread(activity)
      } settle: {
        try database.settleWithoutThread(activityID: activity.id ?? 0)
      }
      count += 1
    }
    return count
  }

  func assignThread(_ activity: Activity) async throws {
    guard let id = activity.id, let caption = activity.caption else { return }
    let evidence = try activityEvidence(activity)
    let threads = try database.liveThreads(now: activity.startAt, days: config.liveThreadDays)
    var chosen: ActivityThread?
    var probability: Double?
    var decision: DecisionRecord?
    if !threads.isEmpty {
      var state: [StatePart] = [.text(evidence.text(ocrLimit: 200) + (caption.isEmpty ? "" : "\nSummary: \(caption)"))]
      if !config.textOnly { state += try images(of: evidence).map { .image($0) } }
      let result = try await decider.decide(state: state, questions: [("thread", .choice(Questions.thread, threadOptions(threads)))])
      guard let answer = result.answers["thread"]?.choice else { throw ModelError.malformed("thread answer") }
      probability = answer.probability
      chosen = threads.first { "t\($0.id ?? -1)" == answer.key }
      decision = DecisionRecord(kind: "thread", subject: "activity:\(id)", answer: answer.key, probability: answer.probability, usage: result.usage, at: Date().timeIntervalSince1970)
    }
    var thread =
      chosen
      ?? ActivityThread(name: "", summary: "", createdAt: activity.startAt, lastSeenAt: activity.endAt)
    if !caption.isEmpty { thread.captions = Array((thread.captions + [caption]).suffix(ThreadCard.captionMemory)) }
    thread.activityCount += 1
    var card: ActivityThread?
    if thread.activityCount <= 2 || thread.activityCount % 4 == 0, !thread.captions.isEmpty {
      try await refreshCard(&thread)
      card = thread
    }
    try database.assign(
      ThreadAssignment(
        activityID: id, threadID: chosen?.id, probability: probability, caption: caption, startAt: activity.startAt,
        endAt: activity.endAt, card: card),
      decision: decision)
  }

  /// Rewrites the thread's name (unless the user renamed it) and description from its latest captions, and asks
  /// its category again (unless the user set it).
  func refreshCard(_ thread: inout ActivityThread) async throws {
    let result = try await writer.json(content: [.text(ThreadCard.describeInput(thread))], keys: ["name", "description"], purpose: "thread-name")
    if !thread.isNameLocked { thread.name = Self.written(result.values["name"], limit: Self.nameLimit) ?? thread.name }
    thread.summary = Self.written(result.values["description"], limit: Self.captionLimit) ?? thread.summary
    try database.record(DecisionRecord(kind: "card", subject: "thread:\(thread.id.map(String.init) ?? "new")", answer: thread.name, probability: nil, usage: result.usage, at: Date().timeIntervalSince1970))
    if !thread.isCategoryLocked {
      let category = try await decider.decide(
        state: [.text(ThreadCard.categoryState(thread))], questions: [("cat", .choice(Questions.category, Questions.categoryOptions))])
      if let answer = category.answers["cat"]?.choice {
        thread.category = ActivityCategory(rawValue: answer.key) ?? .unknown
        try database.record(DecisionRecord(kind: "category", subject: "thread:\(thread.id.map(String.init) ?? "new")", answer: answer.key, probability: answer.probability, usage: category.usage, at: Date().timeIntervalSince1970))
      }
    }
  }

  /// The thread card with a fresh name, description and category.
  public func refreshedCard(_ thread: ActivityThread) async throws -> ActivityThread {
    var thread = thread
    try await refreshCard(&thread)
    return thread
  }

  /// Asks the thread question for an activity with some threads left out. Returns nil for a new thread.
  public func chooseThread(for activity: Activity, excluding excluded: [Int64]) async throws -> Int64? {
    let threads = try database.liveThreads(now: activity.startAt, days: config.liveThreadDays).filter {
      !excluded.contains($0.id ?? -1)
    }
    guard !threads.isEmpty else { return nil }
    let evidence = try activityEvidence(activity)
    var state: [StatePart] = [.text(evidence.text(ocrLimit: 200) + (activity.caption.map { $0.isEmpty ? "" : "\nSummary: \($0)" } ?? ""))]
    if !config.textOnly { state += try images(of: evidence).map { .image($0) } }
    let result = try await decider.decide(state: state, questions: [("thread", .choice(Questions.thread, threadOptions(threads)))])
    guard let answer = result.answers["thread"]?.choice else { throw ModelError.malformed("thread answer") }
    try database.record(DecisionRecord(kind: "thread-reask", subject: "activity:\(activity.id ?? 0)", answer: answer.key, probability: answer.probability, usage: result.usage, at: Date().timeIntervalSince1970))
    return threads.first { "t\($0.id ?? -1)" == answer.key }?.id
  }

  func threadOptions(_ threads: [ActivityThread]) -> [ChoiceOption] {
    threads.map { ChoiceOption(key: "t\($0.id ?? -1)", criterion: ThreadCard.option($0)) }
      + [ChoiceOption(key: Questions.newThreadKey, criterion: Questions.newThreadCriterion)]
  }

  // MARK: - Stage 5: provisional thread for the open activity

  func provisionalThread(now: Double) async throws -> Int {
    guard let open = try database.latestActivity(), open.isOpen, let id = open.id, open.captureCount >= 3,
      open.threadID == nil, try database.decision(kind: "thread-provisional", subject: "activity:\(id)") == nil
    else { return 0 }
    let threads = try database.liveThreads(now: open.startAt, days: config.liveThreadDays)
    guard !threads.isEmpty else { return 0 }
    let result: DecisionResult
    do {
      let evidence = try activityEvidence(open)
      var state: [StatePart] = [.text(evidence.text(ocrLimit: 200))]
      if !config.textOnly { state += try images(of: evidence).map { .image($0) } }
      result = try await decider.decide(state: state, questions: [("thread", .choice(Questions.thread, threadOptions(threads)))])
    } catch where Self.isItemFailure(error) {
      // The provisional label is a hint for the open activity; one failure settles it, and the final thread follows.
      try database.record(DecisionRecord(kind: "thread-provisional", subject: "activity:\(id)", answer: "error: \(error)", probability: nil, model: OpenRouter.decider, inputTokens: 0, costUSD: 0, latencyMS: 0, createdAt: now))
      return 0
    }
    guard let answer = result.answers["thread"]?.choice else { return 0 }
    try database.record(DecisionRecord(kind: "thread-provisional", subject: "activity:\(id)", answer: answer.key, probability: answer.probability, usage: result.usage, at: now))
    // Re-read: the activity may have grown or closed while the question was out.
    guard var current = try database.activity(id: id), current.isOpen, current.threadID == nil,
      let thread = threads.first(where: { "t\($0.id ?? -1)" == answer.key })
    else { return 1 }
    current.threadID = thread.id
    current.threadProbability = answer.probability
    current.isThreadProvisional = true
    try database.update(current)
    return 1
  }

  // MARK: - Nightly merge

  /// Asks, for pairs of live threads, whether they are one effort, and merges pairs above `threshold`.
  /// Online assignment sees each activity once and tends to open a second thread for an effort it already has;
  /// on the gold days this pass raised thread B-cubed F1 by 0.04–0.08. Any pair above the threshold joins its two
  /// groups: with nightly merges this scored 0.694 B-cubed F1 on the six gold days, against 0.676 for complete
  /// linkage (more precise, but it stopped joining real duplicates). Returns the number of threads absorbed.
  ///
  /// Only pairs with a card that changed since the last merge are asked: two unchanged cards got their answer that
  /// night. Every pair of live threads would grow with their square, to about 32,000 questions a night at the thread
  /// question's 254 options.
  @discardableResult
  public func mergeThreads(now: Double, threshold: Double = 0.9) async throws -> Int {
    let threads = try database.liveThreads(now: now, days: config.liveThreadDays)
    guard threads.count >= 2 else { return 0 }
    let texts = threads.map(ThreadCard.mergeText)
    let compared = try database.meta(Self.comparedCardsKey).flatMap { try? JSONDecoder().decode([String: String].self, from: Data($0.utf8)) } ?? [:]
    let changed = threads.indices.map { compared[String(threads[$0].id ?? 0)] != Self.digest(texts[$0]) }
    var questions: [(key: String, question: DecisionQuestion)] = []
    for i in 0..<threads.count {
      for j in (i + 1)..<threads.count where changed[i] || changed[j] {
        questions.append(("\(i)_\(j)", .noul(Questions.merge(a: texts[i], b: texts[j]))))
      }
    }
    let chunks = stride(from: 0, to: questions.count, by: 128).map { Array(questions[$0..<min($0 + 128, questions.count)]) }
    var answers: [String: Double] = [:]
    var cost = 0.0
    try await withThrowingTaskGroup(of: DecisionResult.self) { group in
      var running = 0
      for chunk in chunks {
        if running >= config.concurrency, let result = try await group.next() {
          running -= 1
          cost += result.usage.costUSD
          for (key, answer) in result.answers { answers[key] = answer.yesProbability }
        }
        group.addTask {
          do {
            return try await self.decider.decide(state: [.text(Questions.mergeState)], questions: chunk)
          } catch where Self.isItemFailure(error) {
            // These pairs go unanswered tonight and are asked again tomorrow.
            try self.database.record(DecisionRecord(kind: "error", subject: "merge:\(chunk.first?.key ?? "")", answer: String(describing: error), probability: nil, model: OpenRouter.decider, inputTokens: 0, costUSD: 0, latencyMS: 0, createdAt: now))
            return DecisionResult(answers: [:], usage: ModelUsage(model: OpenRouter.decider, inputTokens: 0, costUSD: 0, latencyMS: 0))
          }
        }
        running += 1
      }
      for try await result in group {
        cost += result.usage.costUSD
        for (key, answer) in result.answers { answers[key] = answer.yesProbability }
      }
    }
    var parent = Array(0..<threads.count)
    func find(_ x: Int) -> Int {
      var x = x
      while parent[x] != x {
        parent[x] = parent[parent[x]]
        x = parent[x]
      }
      return x
    }
    for (key, p) in answers.sorted(by: { $0.value > $1.value }) where p >= threshold {
      let pair = key.split(separator: "_").compactMap { Int($0) }
      let (a, b) = (find(pair[0]), find(pair[1]))
      if a != b { parent[max(a, b)] = min(a, b) }
    }
    var groups: [Int: [Int]] = [:]
    for i in threads.indices { groups[find(i), default: []].append(i) }
    var absorbed = 0
    for (root, members) in groups where members.count > 1 {
      guard let survivorID = threads[root].id,
        var survivor = try database.merge(members.filter { $0 != root }.compactMap { threads[$0].id }, into: survivorID)
      else { continue }
      try await refreshCard(&survivor)
      try database.applyCard(survivor)
      absorbed += members.count - 1
    }
    // The cards as compared tonight; a survivor's card was rewritten, so it counts as changed next time.
    let comparedTonight = Dictionary(uniqueKeysWithValues: threads.indices.map { (String(threads[$0].id ?? 0), Self.digest(texts[$0])) })
    try database.setMeta(Self.comparedCardsKey, String(decoding: try JSONEncoder().encode(comparedTonight), as: UTF8.self))
    try database.record(
      DecisionRecord(
        kind: "merge", subject: "night:\(config.clock.day(now))", answer: "\(absorbed) of \(questions.count) pairs", probability: nil,
        model: OpenRouter.decider, inputTokens: 0, costUSD: cost, latencyMS: 0, createdAt: now))
    return absorbed
  }

  static let comparedCardsKey = "merge.comparedCards"

  static func digest(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
  }

  // MARK: - Day story

  /// The day's headline and story, written from its sessions. The same sessions get the stored story back without a
  /// model call; the caller decides how often a changing day (today) asks again.
  public func dayStory(for timeline: DayTimeline, threadNames: [Int64: String]) async throws -> DayStory? {
    guard let input = Self.dayStoryInput(timeline, threadNames: threadNames, clock: config.clock) else { return nil }
    let subject = Self.dayStorySubject(input)
    if let story = try Self.storedDayStory(database, subject: subject) { return story }
    let result = try await writer.json(content: [.text(Questions.dayStory + input)], keys: ["headline"], purpose: "day-story")
    let story = DayStory(headline: result.values["headline"] ?? "")
    try database.record(
      DecisionRecord(
        kind: "day-story", subject: subject, answer: String(decoding: try JSONEncoder().encode(story), as: UTF8.self),
        probability: nil, usage: result.usage, at: Date().timeIntervalSince1970))
    return story
  }

  /// What the day-story question reads: one line per session. Nil for a day with no sessions.
  static func dayStoryInput(_ timeline: DayTimeline, threadNames: [Int64: String], clock: TimeFormatter) -> String? {
    let lines = timeline.items.compactMap { item -> String? in
      guard case .session(let session) = item else { return nil }
      let name = session.threadID.flatMap { threadNames[$0] } ?? "No thread yet"
      let caption = session.activities.max { $0.minutes < $1.minutes }?.caption ?? ""
      return "\(clock.hourMinute(session.startAt))–\(clock.hourMinute(session.endAt)) · "
        + "\(Int(session.minutes.rounded())) min · \(name): \(caption)"
    }
    return lines.isEmpty ? nil : lines.joined(separator: "\n")
  }

  /// Keyed on the question as well, so a reworded question writes the story again.
  static func dayStorySubject(_ input: String) -> String { "day:\(digest(Questions.dayStory + input))" }

  static func storedDayStory(_ database: AppDatabase, subject: String) throws -> DayStory? {
    guard let earlier = try database.decision(kind: "day-story", subject: subject) else { return nil }
    return try? JSONDecoder().decode(DayStory.self, from: Data(earlier.answer.utf8))
  }

  /// The story the app wrote for this exact state of the day, without asking a model; nil when it has not written one.
  public static func storedDayStory(
    _ database: AppDatabase, timeline: DayTimeline, threadNames: [Int64: String], clock: TimeFormatter
  ) throws -> DayStory? {
    guard let input = dayStoryInput(timeline, threadNames: threadNames, clock: clock) else { return nil }
    return try storedDayStory(database, subject: dayStorySubject(input))
  }

  // MARK: - Helpers

  /// An activity's evidence. One whose captures are gone (deleted under it) is an item failure, settled like any other.
  func activityEvidence(_ activity: Activity) throws -> ActivityEvidence {
    let captures = try database.captures(of: activity)
    guard !captures.isEmpty else { throw UnderstandingError.noCaptures(activity.id ?? 0) }
    return ActivityEvidence(captures: try database.evidence(for: captures), cadence: config.cadence, clock: config.clock)
  }

  /// The JPEG the model sees for a capture (a duplicate shows the frame it repeats), or nil when no frame is left
  /// because the user deleted it.
  func modelImage(_ capture: Capture) throws -> Data? {
    var source = capture
    if source.framePath == nil, let original = source.duplicateOf, let frame = try database.capture(id: original) {
      source = frame
    }
    guard let path = source.framePath, FileManager.default.fileExists(atPath: location.url(path).path) else { return nil }
    if let cached = modelImages.first(where: { $0.id == source.id }) { return cached.jpeg }
    // A frame whose text held a key or a card number goes to no model; its masked text still does.
    if try database.ocrLines(captureID: source.id).contains(where: { SecretScrubber.hadSecret($0.text) }) { return nil }
    let jpeg = try FrameEncoder.modelJPEG(from: location.url(path))
    modelImages.append((source.id, jpeg))
    if modelImages.count > Self.modelImageCacheSize { modelImages.removeFirst() }
    return jpeg
  }

  func images(of evidence: ActivityEvidence) throws -> [Data] {
    try evidence.imageCaptures.compactMap { try modelImage($0.capture) }
  }

  func firstImage(of evidence: ActivityEvidence) throws -> Data? {
    for item in evidence.imageCaptures {
      if let image = try modelImage(item.capture) { return image }
    }
    return nil
  }

  /// A failure that belongs to this item's input and would repeat on the next pass: the model refused or answered
  /// out of shape, the request was rejected, or a frame could not be read. Missing keys, rate limits and outages are
  /// the service's failures and end the pass instead.
  static func isItemFailure(_ error: Error) -> Bool {
    switch error {
    case ModelError.malformed: true
    // 404 (no endpoint serves the model under the data policy) and 413 (a request grown too large) would fail every
    // item alike, so they end the pass and show in Settings instead of settling items empty.
    case ModelError.http(let status, _): (400..<500).contains(status) && ![401, 402, 403, 404, 408, 413, 429].contains(status)
    case is FrameEncoderError, is UnderstandingError: true
    default: false
    }
  }

  /// Runs `work`; an item failure is logged, and once the item has failed `itemAttempts` times, `settle` records it
  /// without an answer. Other failures propagate.
  func settlingItemFailures(
    subject: String, _ work: @Sendable () async throws -> Void, settle: @Sendable () throws -> Void
  ) async throws {
    do {
      try await work()
    } catch where Self.isItemFailure(error) {
      try database.record(
        DecisionRecord(
          kind: "error", subject: subject, answer: String(String(describing: error).prefix(300)), probability: nil,
          model: "", inputTokens: 0, costUSD: 0, latencyMS: 0, createdAt: Date().timeIntervalSince1970))
      Log.understanding.error("\(subject, privacy: .public) failed: \(String(describing: error), privacy: .private)")
      if try database.decisionCount(kind: "error", subject: subject) >= config.itemAttempts { try settle() }
    }
  }
}

enum UnderstandingError: Error, CustomStringConvertible {
  case noCaptures(Int64)

  var description: String {
    switch self {
    case .noCaptures(let id): "activity \(id) has no captures"
    }
  }
}

extension DecisionRecord {
  init(kind: String, subject: String, answer: String, probability: Double?, usage: ModelUsage, at: Double) {
    self.init(
      kind: kind, subject: subject, answer: answer, probability: probability, model: usage.model,
      inputTokens: usage.inputTokens, costUSD: usage.costUSD, latencyMS: usage.latencyMS, createdAt: at)
  }
}
