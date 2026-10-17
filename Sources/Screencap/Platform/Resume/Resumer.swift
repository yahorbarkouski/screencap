import AppKit
import Foundation
import ScreencapCore

/// Brings a thread's places back to the front.
///
/// Only things that are open are touched, and only ever by selecting or raising them: nothing is moved, resized,
/// closed, hidden or launched. A thread whose grouping is wrong therefore costs a Cmd-Tab, which is what makes it
/// safe to act on a guess.
@MainActor
struct Resumer {
  let database: AppDatabase
  var thresholds = ResumeThresholds()
  var now: () -> Double = { Date().timeIntervalSince1970 }

  struct Step: Sendable {
    var thing: Thing
    var score: Double
    var outcome: WindowIndex.Outcome
    var note: String?
  }

  struct Plan: Sendable {
    var thread: ActivityThread
    var scores: [ThingScore]
    /// What the person was doing when they left, from the thread's latest activity.
    var leftOff: String?
    var lastSeenAt: Double
  }

  struct Result: Sendable {
    var plan: Plan
    var steps: [Step]
    var brought: Int { steps.filter { $0.outcome == .brought }.count }
    var opened: Int { steps.filter { $0.outcome == .opened }.count }
    /// Places nothing could do anything about.
    var stuck: [Step] { steps.filter { $0.outcome != .brought && $0.outcome != .opened } }
  }

  /// What a resume of this thread would bring forward, in the order it would be shown.
  func plan(threadID: Int64) throws -> Plan? {
    guard let thread = try database.thread(id: threadID) else { return nil }
    let bindings = try database.bindings(threadID: threadID)
    let thingIDs = Array(Set(bindings.map(\.thingID)))
    let scores = ResumeRanking.scores(
      threadID: threadID, bindings: bindings, everyBinding: try database.bindings(thingIDs: thingIDs),
      things: try database.things(ids: thingIDs), now: now(), thresholds: thresholds)
    let activities = try database.activities(threadID: threadID).sorted { $0.endAt > $1.endAt }
    let latest = activities.first { $0.title?.isEmpty == false } ?? activities.first
    return Plan(
      thread: thread, scores: ResumeRanking.plan(scores, thresholds: thresholds),
      leftOff: latest?.title ?? latest?.caption, lastSeenAt: thread.lastSeenAt)
  }

  /// Brings the thread's things forward, lowest score first, so the one it is most about ends up in front and
  /// keeps the keys.
  func run(threadID: Int64) throws -> Result? {
    guard let plan = try plan(threadID: threadID) else { return nil }
    let steps = BrowserTabs.readingOnce {
      plan.scores.sorted(by: { $0.score < $1.score }).map(bring)
    }
    return Result(plan: plan, steps: steps.reversed())
  }

  /// The browsers a resume could not drive because nobody has been asked about them yet, so the person can be
  /// asked now, while they can see why.
  static func unaskedBrowsers(in result: Result) -> [String] {
    let wanted = Set(result.stuck.filter { $0.outcome == .noPermission && $0.thing.kind == .tab }
      .compactMap(\.thing.bundleID))
    return wanted.filter { AutomationAccess.state(of: $0) == .notAsked }.sorted()
  }

  func bring(_ score: ThingScore) -> Step {
    let answer = ThingDrivers.standard.bring(score.thing)
    return Step(thing: score.thing, score: score.score, outcome: answer.outcome, note: answer.note)
  }

}
