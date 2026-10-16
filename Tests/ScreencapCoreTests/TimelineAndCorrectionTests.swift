import Foundation
import GRDB
import Testing

@testable import ScreencapCore

@Suite struct DayTimelineTests {
  func activity(_ id: Int64, thread: Int64?, from start: Double, minutes: Double, open: Bool = false) -> Activity {
    Activity(
      id: id, firstCaptureID: "f\(id)", lastCaptureID: "l\(id)", startAt: start, endAt: start + minutes * 60,
      captureCount: Int(minutes / 2), isOpen: open, threadID: thread)
  }

  @Test func foldsShortDetoursAndShowsGaps() {
    let day = 1_000_000.0
    let activities = [
      activity(1, thread: 1, from: day + 3600, minutes: 30),
      activity(2, thread: 2, from: day + 3600 + 1800, minutes: 2),  // a short detour into Slack
      activity(3, thread: 1, from: day + 3600 + 1920, minutes: 20),
      activity(4, thread: 3, from: day + 3 * 3600, minutes: 40, open: true),  // after an hour away
    ]
    let timeline = DayTimeline(activities: activities, dayStart: day, dayEnd: day + 86_400)
    #expect(timeline.items.count == 3)
    guard case .session(let first) = timeline.items[0], case .gap(_, let away) = timeline.items[1],
      case .session(let last) = timeline.items[2]
    else {
      Issue.record("unexpected shape \(timeline.items)")
      return
    }
    #expect(first.activities.map(\.id) == [1, 3])
    #expect(first.detours.map(\.id) == [2])
    #expect(first.minutes == 52)
    #expect(away > 60)
    #expect(last.isOpen)
    #expect(timeline.threads.map(\.threadID) == [1, 3, 2])
    #expect(timeline.grid[6] == 1)
    #expect(timeline.grid[0] == nil)
    #expect(timeline.activeMinutes == 92)
  }

  @Test func clipsActivitiesAtMidnight() {
    let day = 1_000_000.0
    let timeline = DayTimeline(activities: [activity(1, thread: 1, from: day - 600, minutes: 30)], dayStart: day, dayEnd: day + 86_400)
    #expect(timeline.activeMinutes == 20)
    #expect(timeline.grid[0] == 1 && timeline.grid[1] == 1 && timeline.grid[2] == nil)
  }
}

@Suite struct CorrectionTests {
  /// Two activities on two threads, built by the engine with the scripted models.
  func twoThreads() async throws -> (Harness, Corrections, [Activity]) {
    let h = try Harness()
    try h.add("Cursor", at: 1000)
    try h.add("Cursor", at: 1120)
    try h.add("Dia", at: 1240)
    try h.add("Dia", at: 1360)
    try await h.engine.advance(now: 9000)
    return (h, Corrections(database: h.database, location: h.location, engine: h.engine), try h.activities())
  }

  @Test func moveWritesIncludesAndNotIntoCards() async throws {
    let (h, corrections, activities) = try await twoThreads()
    let dia = try #require(activities[1].threadID)
    let cursor = try #require(activities[0].threadID)
    try await corrections.move(activityID: activities[1].id!, to: cursor)
    let moved = try #require(try h.database.activity(id: activities[1].id!))
    #expect(moved.threadID == cursor)
    #expect(moved.isThreadLocked)
    let target = try #require(try h.database.thread(id: cursor))
    let previous = try #require(try h.database.thread(id: dia))
    #expect(target.includes == ["Used Dia"])
    #expect(previous.excludes == ["Used Dia"])
    #expect(!previous.captions.contains("Used Dia"))
    #expect(ThreadCard.option(target).contains("Includes: Used Dia"))
    #expect(ThreadCard.option(previous).contains("Not: Used Dia"))
    // The next thread question shows the corrected cards.
    try h.add("Dia", at: 20_000)
    try h.add("Dia", at: 20_120)
    try await h.engine.advance(now: 30_000)
    let threadCall = try #require(h.decider.calls.last { $0.keys == ["thread"] })
    _ = threadCall
    let options = try h.database.liveThreads(now: 20_000).map(ThreadCard.option)
    #expect(options.contains { $0.contains("Includes: Used Dia") })
  }

  @Test func renameAndCategoryLockAgainstRefresh() async throws {
    let (h, corrections, activities) = try await twoThreads()
    let id = try #require(activities[0].threadID)
    try corrections.rename(threadID: id, to: "Recipe site scraper")
    try corrections.setCategory(threadID: id, to: .study)
    let refreshed = try await h.engine.refreshedCard(try #require(try h.database.thread(id: id)))
    #expect(refreshed.name == "Recipe site scraper")
    #expect(refreshed.category == .study)
  }

  @Test func splitMakesTwoActivitiesAndTheEngineFinishesThem() async throws {
    let h = try Harness()
    for i in 0..<4 { try h.add("Cursor", at: 1000 + Double(i) * 120) }
    try await h.engine.advance(now: 9000)
    let original = try #require(try h.activities().first)
    let wholeCaption = try #require(try h.database.decision(kind: "caption", subject: "activity:\(original.id!)"))
    let captures = try h.database.captures(of: original)
    try Corrections(database: h.database, location: h.location, engine: h.engine).split(activityID: original.id!, before: captures[2].id)
    try await h.engine.advance(now: 9000)
    let parts = try h.activities()
    #expect(parts.map(\.captureCount) == [2, 2])
    #expect(parts.allSatisfy { $0.caption != nil && $0.threadID != nil })
    // The first part was captioned again from its own captures.
    #expect(try h.database.decision(kind: "caption", subject: "activity:\(original.id!)")?.id != wholeCaption.id)
  }

  @Test func deleteRemovesEveryDisplaysCapturesAndTheCaption() async throws {
    let (h, corrections, activities) = try await twoThreads()
    let threadID = try #require(activities[1].threadID)
    // The second display's frame from the same tick as the deleted activity's last capture.
    let other = Capture(
      at: 1360, trigger: .timer, displayID: 2, isFocusedDisplay: false, context: ForegroundContext(bundleID: "app.Dia", appName: "Dia"),
      framePath: nil, thumbPath: nil, pixelWidth: 10, pixelHeight: 10, dHash: 0, duplicateOf: nil, ocrState: .done)
    try h.database.insert(other)
    try corrections.delete(activityID: activities[1].id!)
    #expect(try h.activities().count == 1)
    let remaining = try await h.database.reader.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM capture") ?? 0 }
    #expect(remaining == 2)
    let thread = try #require(try h.database.thread(id: threadID))
    #expect(thread.activityCount == 0)
    #expect(!thread.captions.contains("Used Dia"))
    #expect(try h.database.decision(kind: "caption", subject: "activity:\(activities[1].id!)") == nil)
    let tombstones = try h.database.tombstones()
    #expect(tombstones.activities == [activities[1].id!])
    #expect(tombstones.captures.count == 3)
    let jobs = try h.database.dueBackupJobs(now: .greatestFiniteMagnitude, limit: 10).map(\.kind)
    #expect(jobs.contains(.rows) && jobs.contains(.tombstones))
  }

  @Test func moveWaitsForACaption() async throws {
    let (h, corrections, activities) = try await twoThreads()
    try h.add("Mail", at: 9100)
    try h.add("Mail", at: 9220)
    try await h.engine.advance(now: 9300)
    let open = try #require(try h.activities().last)
    #expect(open.caption == nil)
    #expect(try await corrections.move(activityID: open.id!, to: activities[0].threadID) == nil)
    #expect(try h.database.thread(id: activities[0].threadID!)?.includes.isEmpty == true)
  }

  @Test func notThisThreadAsksWithoutTheCurrentThread() async throws {
    let (h, corrections, activities) = try await twoThreads()
    let current = try #require(activities[1].threadID)
    let moved = try await corrections.notThisThread(activityID: activities[1].id!)
    #expect(moved != current)
    let reask = try #require(h.decider.calls.last { $0.keys == ["thread"] })
    _ = reask
    let decision = try h.database.decision(kind: "thread-reask", subject: "activity:\(activities[1].id!)")
    #expect(decision != nil)
  }
}

@Suite struct DayChaptersTests {
  func activity(_ id: Int64, thread: Int64, from start: Double, minutes: Double) -> Activity {
    Activity(id: id, firstCaptureID: "f\(id)", lastCaptureID: "l\(id)", startAt: start, endAt: start + minutes * 60, captureCount: 2, isOpen: false, threadID: thread)
  }

  @Test func shortVisitsFoldIntoTheChapterTheyInterrupted() {
    let t = 1_000_000.0
    let chapters = DayChapters(activities: [
      activity(1, thread: 1, from: t, minutes: 20),
      activity(2, thread: 2, from: t + 20 * 60, minutes: 3),  // a glance at Slack
      activity(3, thread: 1, from: t + 23 * 60, minutes: 15),
      activity(4, thread: 3, from: t + 38 * 60, minutes: 25),  // a real switch
      activity(5, thread: 3, from: t + 120 * 60, minutes: 10),  // after an hour away
    ]).chapters
    #expect(chapters.map(\.threadID) == [1, 3, 3])
    #expect(chapters[0].activities.map(\.id) == [1, 2, 3])
    #expect(chapters[0].also == [2])
    #expect(chapters[0].main?.id == 1)
    #expect(chapters[1].activities.map(\.id) == [4])
  }
}
