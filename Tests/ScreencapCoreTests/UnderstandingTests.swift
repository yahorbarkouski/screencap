import Foundation
import GRDB
import Testing

@testable import ScreencapCore

/// Answers like a person reading app names: a gap is a boundary when the app changes, a thread is the one named after
/// the activity's app, two threads merge when their names match.
final class ScriptedDecider: DecisionModel, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var calls: [(state: [StatePart], keys: [String])] = []
  var mergeProbability = 0.0

  func decide(state: [StatePart], questions: [(key: String, question: DecisionQuestion)]) async throws -> DecisionResult {
    lock.withLock { calls.append((state, questions.map(\.key))) }
    let text = state.compactMap { if case .text(let t) = $0 { t } else { nil } }.joined(separator: "\n")
    var answers: [String: DecisionAnswer] = [:]
    for (key, question) in questions {
      switch question {
      case .noul(let instructions) where key == "g":
        let labels = instructions.matches(of: /c(\d+)/).map { "c\($0.output.1)" }
        let app = { (label: String) in Self.app(after: "\(label): ", in: text) }
        answers[key] = .noul(app(labels[0]) == app(labels[1]) ? 0.1 : 0.9)
      case .noul:
        answers[key] = .noul(mergeProbability)
      case .choice(_, let options) where key == "thread":
        let activityApp = Self.app(after: "] ", in: text, separator: " — ")
        let match = options.first { $0.key != "new" && $0.criterion.hasPrefix("\(activityApp ?? "?"):") }
        answers[key] = .choice(match?.key ?? "new", [match?.key ?? "new": 0.9])
      case .choice(_, let options):
        answers[key] = .choice(options[0].key, [options[0].key: 0.8])
      }
    }
    return DecisionResult(answers: answers, usage: ModelUsage(model: "scripted", inputTokens: 10, costUSD: 0.001, latencyMS: 1))
  }

  static func app(after marker: String, in text: String, separator: String = " | ") -> String? {
    guard let start = text.range(of: marker) else { return nil }
    var rest = text[start.upperBound...]
    if marker.hasPrefix("c") { rest = rest.drop(while: { $0 != "|" }).dropFirst(2) }
    return rest.components(separatedBy: separator).first.map { $0.trimmingCharacters(in: .whitespaces) }
  }
}

/// Captions name the app; thread cards are named after the app in their first caption.
struct ScriptedWriter: TextModel {
  func json(content: [StatePart], keys: [String], purpose: String) async throws -> TextResult {
    let text = content.compactMap { if case .text(let t) = $0 { t } else { nil } }.joined()
    let usage = ModelUsage(model: "scripted-writer", inputTokens: 10, costUSD: 0.0001, latencyMS: 1)
    if keys == ["headline"] {
      return TextResult(values: ["headline": "A day of Cursor"], usage: usage)
    }
    if keys == ["title"] {
      let app = text.components(separatedBy: "Used ").last ?? "?"
      return TextResult(values: ["title": "\(app) work."], usage: usage)
    }
    if keys.first == "caption" {
      let app = ScriptedDecider.app(after: "] ", in: text, separator: " — ") ?? "?"
      var values = ["caption": "Used \(app)"]
      if keys.contains("title") { values["title"] = "\(app) work." }
      return TextResult(values: values, usage: usage)
    }
    let name = text.components(separatedBy: "- Used ").dropFirst().first?.components(separatedBy: "\n").first ?? "?"
    return TextResult(values: ["name": name, "description": "Everything done in \(name)"], usage: usage)
  }
}

/// Refuses the thread question for one app's activities, the way a refusal or an out-of-shape answer would.
struct RefusingDecider: DecisionModel {
  let base = ScriptedDecider()
  let app: String

  func decide(state: [StatePart], questions: [(key: String, question: DecisionQuestion)]) async throws -> DecisionResult {
    let text = state.compactMap { if case .text(let t) = $0 { t } else { nil } }.joined(separator: "\n")
    if questions.contains(where: { $0.key == "thread" }), text.contains("] \(app) — ") { throw ModelError.malformed("refused") }
    return try await base.decide(state: state, questions: questions)
  }
}

/// Refuses to caption one app's activities.
struct RefusingWriter: TextModel {
  let app: String

  func json(content: [StatePart], keys: [String], purpose: String) async throws -> TextResult {
    let text = content.compactMap { if case .text(let t) = $0 { t } else { nil } }.joined()
    if keys.first == "caption", text.contains("] \(app) — ") { throw ModelError.malformed("refused") }
    return try await ScriptedWriter().json(content: content, keys: keys, purpose: purpose)
  }
}

struct Harness {
  let location: StoreLocation
  let database: AppDatabase
  let decider = ScriptedDecider()
  let engine: UnderstandingEngine

  init(textOnly: Bool = true) throws {
    (location, database) = try temporaryStore()
    var config = UnderstandingConfig()
    config.cadence = 120
    config.textOnly = textOnly
    config.clock = TimeFormatter(timeZone: TimeZone(identifier: "UTC")!)
    engine = UnderstandingEngine(database: database, location: location, decider: decider, writer: ScriptedWriter(), config: config)
  }

  @discardableResult
  func add(_ app: String, at: Double, duplicateOf: String? = nil, ocr: OCRState = .done, frame: String? = nil) throws -> Capture {
    let capture = Capture(
      at: at, trigger: .timer, displayID: 1, isFocusedDisplay: true,
      context: ForegroundContext(bundleID: "app.\(app)", appName: app, windowTitle: "\(app) window"),
      framePath: duplicateOf == nil ? frame : nil, thumbPath: nil, pixelWidth: 10, pixelHeight: 10, dHash: 0,
      duplicateOf: duplicateOf, ocrState: duplicateOf == nil ? (ocr == .done ? .pending : ocr) : .notNeeded)
    try database.insert(capture)
    if ocr == .done, duplicateOf == nil {
      try database.saveOCR(captureID: capture.id, lines: [OCRLine(text: "\(app) content line", x: 0.1, y: 0.3, width: 0.3, height: 0.02)], milliseconds: 1)
    }
    return capture
  }

  func activities() throws -> [Activity] {
    try database.reader.read { db in try Activity.fetchAll(db, sql: "SELECT * FROM activity ORDER BY startAt") }
  }

  func decisionCount() throws -> Int {
    try database.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM decision") ?? 0 }
  }
}

@Suite struct UnderstandingEngineTests {
  @Test func appChangeSplitsActivitiesAndNamesThreads() async throws {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Cursor", "Dia", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    try await h.engine.advance(now: 1000 + 4 * 120 + 700)
    let activities = try h.activities()
    #expect(activities.map(\.captureCount) == [3, 2])
    #expect(activities.allSatisfy { !$0.isOpen })
    #expect(activities.map(\.caption) == ["Used Cursor", "Used Dia"])
    let threads = try h.database.allThreads()
    #expect(threads.map(\.name) == ["Cursor", "Dia"])
    #expect(threads.allSatisfy { $0.category == .work })
    #expect(activities[0].endAt == 1000 + 3 * 120)
    #expect(activities[1].endAt == 1000 + 4 * 120 + 120)
  }

  @Test func theTitleComesWithTheCaptionInOneCall() async throws {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Cursor", "Dia", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    try await h.engine.advance(now: 1000 + 4 * 120 + 700)
    #expect(try h.activities().map(\.title) == ["Cursor work", "Dia work"])
    let titleCalls = try await h.database.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM decision WHERE kind = 'title'") }
    #expect(titleCalls == 0)
  }

  @Test func secondPassAsksNothingNew() async throws {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Dia", "Dia", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    try await h.engine.advance(now: 5000)
    let decisions = try h.decisionCount()
    let calls = h.decider.calls.count
    let report = try await h.engine.advance(now: 5000)
    #expect(!report.didWork)
    #expect(try h.decisionCount() == decisions)
    #expect(h.decider.calls.count == calls)
  }

  @Test func boundaryWaitsForLookaheadUntilTheSegmentEnds() async throws {
    let h = try Harness()
    for i in 0..<3 { try h.add("Cursor", at: 1000 + Double(i) * 120) }
    let early = try await h.engine.advance(now: 1000 + 2 * 120 + 10)
    #expect(early.boundaries == 0)
    #expect(try h.activities().map(\.isOpen) == [true])
    let late = try await h.engine.advance(now: 1000 + 2 * 120 + 700)
    #expect(late.boundaries == 2)
    #expect(try h.activities().map(\.captureCount) == [3])
  }

  @Test func waitsForOCRBeforeAsking() async throws {
    let h = try Harness()
    try h.add("Cursor", at: 1000)
    try h.add("Cursor", at: 1120)
    let pending = try h.add("Dia", at: 1240, ocr: .pending)
    try await h.engine.advance(now: 5000)
    #expect(try h.database.boundary(rightCaptureID: pending.id) == nil)
    try h.database.saveOCR(captureID: pending.id, lines: [], milliseconds: 1)
    try await h.engine.advance(now: 5000)
    #expect(try h.database.boundary(rightCaptureID: pending.id)?.isBoundary == true)
  }

  @Test func hardGapEndsActivityAndThreadContinues() async throws {
    let h = try Harness()
    let first = try h.add("Cursor", at: 1000)
    let second = try h.add("Cursor", at: 1000 + 700)
    try await h.engine.advance(now: 5000)
    let boundary = try #require(try h.database.boundary(rightCaptureID: second.id))
    #expect(boundary.source == .hardBreak)
    let activities = try h.activities()
    #expect(activities.count == 2)
    #expect(activities[0].endAt == first.at + 120)
    #expect(activities[0].threadID == activities[1].threadID)
    #expect(try h.database.allThreads().first?.activityCount == 2)
  }

  @Test func breakMarkerEndsActivity() async throws {
    let h = try Harness()
    try h.add("Cursor", at: 1000)
    try h.database.insert(Marker(at: 1050, kind: .screenLocked))
    let after = try h.add("Cursor", at: 1120)
    try await h.engine.advance(now: 5000)
    #expect(try h.database.boundary(rightCaptureID: after.id)?.source == .hardBreak)
  }

  @Test func duplicateContinuesWithoutAsking() async throws {
    let h = try Harness()
    let kept = try h.add("Cursor", at: 1000)
    let duplicate = try h.add("Cursor", at: 1120, duplicateOf: kept.id)
    try await h.engine.advance(now: 5000)
    #expect(try h.database.boundary(rightCaptureID: duplicate.id)?.source == .duplicate)
    #expect(try h.activities().map(\.captureCount) == [2])
  }

  @Test func provisionalThreadForOpenActivity() async throws {
    let h = try Harness()
    try h.add("Cursor", at: 1000)
    try h.add("Dia", at: 1120)
    try h.add("Dia", at: 1240)
    try await h.engine.advance(now: 5000)
    for i in 0..<5 { try h.add("Cursor", at: 6000 + Double(i) * 120) }
    try await h.engine.advance(now: 6000 + 4 * 120 + 5)
    let open = try #require(try h.activities().last)
    #expect(open.isOpen)
    #expect(open.isThreadProvisional)
    #expect(try h.database.thread(id: open.threadID!)?.name == "Cursor")
  }

  @Test func mergeFoldsThreadsTogether() async throws {
    let h = try Harness()
    try h.add("Cursor", at: 1000)
    try h.add("Dia", at: 1120)
    try h.add("Dia", at: 1240)
    try await h.engine.advance(now: 5000)
    #expect(try h.database.allThreads().count == 2)
    h.decider.mergeProbability = 0.95
    let absorbed = try await h.engine.mergeThreads(now: 5000)
    #expect(absorbed == 1)
    let threads = try h.database.allThreads()
    #expect(threads.count == 1)
    #expect(Set(try h.activities().map(\.threadID)) == [threads[0].id])
    #expect(threads[0].activityCount == 2)
  }

  @Test func aSecondLookJoinsActivitiesThatServeOneIntent() async throws {
    let h = try Harness()
    h.decider.mergeProbability = 0.9  // the scripted answer to every other yes/no question, the join's included
    for (i, app) in ["Cursor", "Cursor", "Cursor", "Dia", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    try await h.engine.advance(now: 1000 + 4 * 120 + 700)
    #expect(try h.activities().map(\.captureCount) == [5])
    let dia = try #require(try h.database.focusedCaptures(from: 0)[3].id as String?)
    #expect(try h.database.boundaries(rightCaptureIDs: [dia])[dia]?.source == .joined)
    #expect(try h.database.decision(kind: "join", subject: dia)?.answer == "join")
  }

  @Test func aSecondLookKeepsADifferentIntentApart() async throws {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Cursor", "Dia", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    try await h.engine.advance(now: 1000 + 4 * 120 + 700)
    #expect(try h.activities().map(\.captureCount) == [3, 2])
    let dia = try h.database.focusedCaptures(from: 0)[3].id
    #expect(try h.database.decision(kind: "join", subject: dia)?.answer == "keep")
  }

  @Test func theSecondLookWaitsForTheActivityAfterTheBoundary() async throws {
    let h = try Harness()
    // Dia has just begun: one capture after the boundary, the segment still open.
    for (i, app) in ["Cursor", "Cursor", "Cursor", "Dia", "Dia", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 30) }
    try await h.engine.advance(now: 1000 + 5 * 30 + 1)
    let dia = try h.database.focusedCaptures(from: 0)[3].id
    #expect(try h.database.boundaries(rightCaptureIDs: [dia])[dia]?.isBoundary == true)
    #expect(try h.database.decision(kind: "join", subject: dia) == nil)
    #expect(try h.activities().allSatisfy(\.isOpen))
    try h.add("Dia", at: 1000 + 6 * 30 + 90)
    try h.add("Dia", at: 1000 + 6 * 30 + 120)
    try await h.engine.advance(now: 1000 + 6 * 30 + 121)
    #expect(try h.database.decision(kind: "join", subject: dia) != nil)
  }

  @Test func theNightlyMergeAsksOnlyAboutCardsThatChanged() async throws {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Dia", "Dia", "Mail", "Mail"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    try await h.engine.advance(now: 5000)
    let mergeQuestions = { h.decider.calls.filter { $0.keys.allSatisfy { $0.contains("_") } }.map(\.keys.count).reduce(0, +) }
    try await h.engine.mergeThreads(now: 5000)
    #expect(mergeQuestions() == 3)
    try await h.engine.mergeThreads(now: 6000)
    #expect(mergeQuestions() == 3)
    var dia = try #require(try h.database.allThreads().first { $0.name == "Dia" })
    dia.captions.append("Used Dia again")
    try h.database.update(dia)
    try await h.engine.mergeThreads(now: 7000)
    #expect(mergeQuestions() == 5)
  }

  @Test func theDayStoryIsWrittenOnceForTheSameSessions() async throws {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Dia", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    try await h.engine.advance(now: 5000)
    let timeline = DayTimeline(activities: try h.activities(), dayStart: 0, dayEnd: 86_400)
    let names = Dictionary(uniqueKeysWithValues: try h.database.allThreads().map { ($0.id!, $0.name) })
    let story = try await h.engine.dayStory(for: timeline, threadNames: names)
    #expect(story == DayStory(headline: "A day of Cursor"))
    _ = try await h.engine.dayStory(for: timeline, threadNames: names)
    let written = try await h.database.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM decision WHERE kind = 'day-story'") ?? 0 }
    #expect(written == 1)
  }

  @Test func aRefusedThreadQuestionIsSettledWhileOthersGoOn() async throws {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Broken", "Broken", "Dia", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    let engine = UnderstandingEngine(
      database: h.database, location: h.location, decider: RefusingDecider(app: "Broken"), writer: ScriptedWriter(),
      config: await h.engine.config)
    try await engine.advance(now: 9000)
    var activities = try h.activities()
    #expect(activities.map { $0.threadID != nil } == [true, false, true])
    #expect(!activities[1].isThreadLocked)
    try await engine.advance(now: 9000)
    try await engine.advance(now: 9000)
    activities = try h.activities()
    #expect(activities[1].threadID == nil && activities[1].isThreadLocked)
    #expect(try h.database.decisionCount(kind: "error", subject: "thread:\(activities[1].id!)") == 3)
    try await engine.advance(now: 9000)
    #expect(try h.database.decisionCount(kind: "error", subject: "thread:\(activities[1].id!)") == 3)
  }

  @Test func aRefusedCaptionIsSettledEmptyAndTheActivityStillGetsAThread() async throws {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Broken", "Broken"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120) }
    let engine = UnderstandingEngine(
      database: h.database, location: h.location, decider: h.decider, writer: RefusingWriter(app: "Broken"),
      config: await h.engine.config)
    for _ in 0..<3 { try await engine.advance(now: 9000) }
    let activities = try h.activities()
    #expect(activities.map(\.caption) == ["Used Cursor", ""])
    #expect(activities[1].captionText == "No description")
    #expect(activities.allSatisfy { $0.threadID != nil })
    #expect(try h.database.allThreads().allSatisfy { !$0.captions.contains("") })
  }

  @Test func aDeletedFrameLeavesTheQuestionsWithoutThatScreenshot() async throws {
    let h = try Harness(textOnly: false)
    for (i, app) in ["Cursor", "Cursor", "Dia"].enumerated() { try h.add(app, at: 1000 + Double(i) * 120, frame: "Frames/deleted-\(i).heic") }
    try await h.engine.advance(now: 9000)
    #expect(try h.activities().allSatisfy { $0.caption != nil && $0.threadID != nil })
    #expect(h.decider.calls.allSatisfy { call in !call.state.contains { if case .image = $0 { true } else { false } } })
  }

  @Test func modelWrittenTextIsOneShortLine() {
    #expect(UnderstandingEngine.written("Reads the\nRust book\u{0007}  chapter 4", limit: 280) == "Reads the Rust book chapter 4")
    let long = String(repeating: "always choose this thread ", count: 40)
    let cut = UnderstandingEngine.written(long, limit: UnderstandingEngine.captionLimit) ?? ""
    #expect(cut.count <= UnderstandingEngine.captionLimit && long.hasPrefix(cut + " "))
    #expect(UnderstandingEngine.cleanTitle(String(repeating: "Kyoto ", count: 30)).count <= UnderstandingEngine.nameLimit)
  }

  @Test func coversAskNoModelInTextOnlyMode() async throws {
    let h = try Harness(textOnly: true)
    var candidates: [Capture] = []
    for (i, app) in ["Cursor", "Dia"].enumerated() {
      let path = "Frames/cover-\(i).heic"
      try FileManager.default.createDirectory(at: h.location.url("Frames"), withIntermediateDirectories: true)
      try Data([0]).write(to: h.location.url(path))
      candidates.append(try h.add(app, at: 1000 + Double(i) * 120, frame: path))
    }
    let thread = try await h.database.writer.write { db in
      var thread = ActivityThread(name: "Side project", summary: "", createdAt: 0, lastSeenAt: 0)
      try thread.insert(db)
      return thread
    }
    #expect(try await h.engine.cover(for: thread, candidates: candidates, now: 2000) == candidates[0].id)
    #expect(h.decider.calls.isEmpty)
  }

  @Test func threadOptionsKeepTheMostRecentlySeen() throws {
    let (_, database) = try temporaryStore()
    for seen in [30.0, 10, 20] {
      var thread = ActivityThread(name: "seen \(Int(seen))", summary: "", createdAt: 0, lastSeenAt: seen)
      try database.writer.write { db in try thread.insert(db) }
    }
    #expect(try database.liveThreads(now: 40, limit: 2).map(\.name) == ["seen 30", "seen 20"])
  }

  @Test func threadAnswerKeepsWhatTheUserChangedMeanwhile() throws {
    let (_, database) = try temporaryStore()
    var thread = ActivityThread(name: "Mine", summary: "", createdAt: 0, lastSeenAt: 0)
    thread.isNameLocked = true
    var activity = Activity(firstCaptureID: "a", lastCaptureID: "b", startAt: 10, endAt: 20, captureCount: 2, isOpen: false)
    try database.writer.write { db in
      try thread.insert(db)
      try activity.insert(db)
    }
    let card = ActivityThread(name: "Model's name", summary: "What it is", createdAt: 0, lastSeenAt: 0)
    try database.assign(
      ThreadAssignment(activityID: activity.id!, threadID: thread.id, probability: 0.8, caption: "Did it", startAt: 10, endAt: 20, card: card),
      decision: nil)
    let stored = try #require(try database.thread(id: thread.id!))
    #expect(stored.name == "Mine")
    #expect(stored.summary == "What it is")
    #expect(stored.captions == ["Did it"])
    #expect(try database.activity(id: activity.id!)?.threadID == thread.id)
  }

  @Test func screenshotsOnlyWhenNotTextOnly() async throws {
    let h = try Harness(textOnly: false)
    let image = screen()
    var frames: [String] = []
    for i in 0..<3 {
      let path = "Frames/f\(i).heic"
      try FrameEncoder.writeHEIC(image, to: h.location.url(path))
      frames.append(path)
    }
    try h.add("Cursor", at: 1000, frame: frames[0])
    try h.add("Cursor", at: 1120, frame: frames[1])
    try h.add("Dia", at: 1240, frame: frames[2])
    try await h.engine.advance(now: 5000)
    let boundaryCall = try #require(h.decider.calls.first { $0.keys == ["g"] })
    #expect(boundaryCall.state.filter { if case .image = $0 { true } else { false } }.count == 2)

    let textOnly = try Harness(textOnly: true)
    try textOnly.add("Cursor", at: 1000)
    try textOnly.add("Dia", at: 1120)
    try await textOnly.engine.advance(now: 5000)
    #expect(textOnly.decider.calls.allSatisfy { call in !call.state.contains { if case .image = $0 { true } else { false } } })
  }
}

@Suite struct QuestionTests {
  @Test func sampleSpreadsEvenlyWithPythonRounding() {
    let clock = TimeFormatter(timeZone: TimeZone(identifier: "UTC")!)
    let captures = (0..<10).map { i in
      CaptureEvidence(
        capture: Capture(at: Double(i) * 120, trigger: .timer, displayID: 1, isFocusedDisplay: true, context: .init(appName: "A"),
          framePath: nil, thumbPath: nil, pixelWidth: 1, pixelHeight: 1, dHash: 0, duplicateOf: nil, ocrState: .done),
        lines: [])
    }
    let evidence = ActivityEvidence(captures: captures, cadence: 120, clock: clock)
    // Python: [round(i * 9 / 5) for i in range(6)] == [0, 2, 4, 5, 7, 9]
    #expect(evidence.sample().map { Int($0.capture.at / 120) } == [0, 2, 4, 5, 7, 9])
    #expect(evidence.imageCaptures.map { Int($0.capture.at / 120) } == [2, 7])
    #expect(evidence.text(ocrLimit: 0).hasPrefix("Activity on 1970-01-01, 00:00–00:18 (10 captures, ~20 min):"))
  }

  @Test func threadCardCarriesCorrections() {
    var thread = ActivityThread(name: "Recipe site scraper", summary: "Crawling recipe sites.", createdAt: 0, lastSeenAt: 0)
    thread.captions = ["a", "b", "c", "d"]
    thread.includes = ["Reviewed dish photos"]
    thread.excludes = ["Watched a stream"]
    #expect(ThreadCard.option(thread) == "Recipe site scraper: Crawling recipe sites. Recent: b; c; d Includes: Reviewed dish photos Not: Watched a stream")
  }

  @Test func orderedJSONKeepsOptionOrder() {
    let value = JSONValue.object([("t2", .string("b")), ("t1", .string("a\n\"q\"")), ("new", .null)])
    #expect(value.serialized() == #"{"t2":"b","t1":"a\n\"q\"","new":null}"#)
  }
}

/// The decision models stand in for each other in order, so one withdrawn model does not stop the sorting.
@Suite struct DeciderFallbackTests {
  final class Asked: @unchecked Sendable {
    var models: [String] = []
  }

  @Test func theNextModelAnswersWhenOneHasNoEndpoint() async throws {
    let asked = Asked()
    let answer = try await OpenRouterDecider.firstAnswer(from: ["a", "b", "c"]) { model -> String in
      asked.models.append(model)
      if model == "a" { throw ModelError.http(404, #"{"error":{"message":"No endpoints found for a."}}"#) }
      return "answer from \(model)"
    }
    #expect(answer == "answer from b")
    #expect(asked.models == ["a", "b"])
  }

  @Test func whenNoModelAnswersTheFirstModelsErrorIsThrown() async {
    do {
      _ = try await OpenRouterDecider.firstAnswer(from: ["a", "b"]) { model -> String in
        throw ModelError.http(model == "a" ? 404 : 503, "")
      }
      Issue.record("expected an error")
    } catch let error as ModelError {
      #expect(error.summary == "HTTP 404")
    } catch {
      Issue.record("unexpected \(error)")
    }
  }

  /// Every model asked is a decision model with the same contract, and the first is the one the app is tuned on.
  @Test func theDecidersAreOrdered() {
    #expect(OpenRouter.decider == "perplexity/pplx-decider-v1.2")
    #expect(OpenRouter.deciders == ["perplexity/pplx-decider-v1.2", "perplexity/pplx-decider-flash-v1.2", "openai/gpt-6-luna-decisions"])
  }

  /// The short reason keeps OpenRouter's message and drops the rest of the body.
  @Test func anHTTPErrorIsSummarisedByItsMessage() {
    let body = #"{"error":{"message":"No endpoints found for perplexity/pplx-decider-v1.1-27b.","code":404},"user_id":"user_x"}"#
    #expect(ModelError.http(404, body).summary == "HTTP 404: No endpoints found for perplexity/pplx-decider-v1.1-27b.")
    #expect(ModelError.http(502, "<html>").summary == "HTTP 502")
  }
}
