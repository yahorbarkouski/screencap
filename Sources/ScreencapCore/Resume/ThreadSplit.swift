import Foundation

public struct ThreadSplitThresholds: Sendable {
  /// Each side of a split has to be a real part of the thread's time.
  public var minGroupShare = 0.25
  /// How much of the thread's time may sit in things both sides use before they are not two pieces of work.
  public var maxSharedShare = 0.2
  /// A thread nobody has worked in much yet says too little to split.
  public var minActivities = 6
  /// One stretch of work is not a side of its own: a side has to be something you came back to. Measured against
  /// a real store, requiring two dropped three of four candidates, and the one left (a second project inside a
  /// thread of similar work) was the only one worth acting on.
  public var minGroupActivities = 2
  /// Time in one activity under this is a glance: it makes no link between activities and no side of its own.
  public var minSecondsInActivity: Double = 30

  public init() {}
}

/// One side of a split.
public struct ThreadSplitGroup: Sendable {
  public var activityIDs: [Int64]
  /// Things the side spent time in, longest first, with their seconds inside it.
  public var things: [(key: String, label: String, kind: ThingKind, seconds: Double)]
  public var seconds: Double
  /// The side's part of the thread's time.
  public var share: Double
}

/// A thread that holds two pieces of work.
public struct ThreadSplitCandidate: Sendable {
  public var threadID: Int64
  /// The two biggest sides, largest first.
  public var groups: [ThreadSplitGroup]
  /// Activities in neither side: short stretches that share nothing with either. They stay where they are.
  public var otherActivities: [Int64]
  public var activityCount: Int
  /// Places in activities that used both sides, and those activities' part of the thread's time. The smaller this
  /// is, the more clearly the thread is two things.
  public var sharedThings: [String]
  public var sharedShare: Double
}

/// Finds threads that hold two pieces of work.
///
/// Screencap decides what a thread is from what the screen looked like, which merges work that reads alike:
/// contributions to two different open-source projects can land in one thread. The places the work happened in
/// say otherwise — different repository, different issue, different plan — and they never appear together. So
/// the things bound to a thread can push back on the boundary that made it.
///
/// The grouping runs over activities rather than things: an activity is a stretch with one intent, so two
/// activities that share nothing at all are two pieces of work, and one thing present throughout a thread ties the
/// whole thread together, which is exactly when it should not be split.
public enum ThreadSplit {
  public static func candidate(
    threadID: Int64, activityTimes: [Int64: [String: Double]], labels: [String: ThingRef],
    thresholds: ThreadSplitThresholds = ThreadSplitThresholds()
  ) -> ThreadSplitCandidate? {
    let kept = activityTimes.mapValues { times in times.filter { $0.value >= thresholds.minSecondsInActivity } }
      .filter { !$0.value.isEmpty }
    guard kept.count >= thresholds.minActivities else { return nil }

    // Activities sharing a thing are the same piece of work, through whatever chain of shared things links them.
    var activitiesOf: [String: [Int64]] = [:]
    for (activityID, times) in kept {
      for key in times.keys { activitiesOf[key, default: []].append(activityID) }
    }
    var groupOf: [Int64: Int] = [:]
    var groups: [[Int64]] = []
    for activityID in kept.keys.sorted() where groupOf[activityID] == nil {
      var members: [Int64] = []
      var queue = [activityID]
      groupOf[activityID] = groups.count
      while let current = queue.popLast() {
        members.append(current)
        for key in kept[current]?.keys ?? [:].keys {
          for neighbour in activitiesOf[key] ?? [] where groupOf[neighbour] == nil {
            groupOf[neighbour] = groups.count
            queue.append(neighbour)
          }
        }
      }
      groups.append(members.sorted())
    }
    guard groups.count > 1 else { return nil }

    func seconds(_ members: [Int64]) -> Double {
      members.reduce(0) { total, id in total + (kept[id]?.values.reduce(0, +) ?? 0) }
    }
    let ordered = groups.sorted { seconds($0) > seconds($1) }
    let total = seconds(Array(kept.keys))
    guard total > 0 else { return nil }

    func group(_ members: [Int64]) -> ThreadSplitGroup {
      var times: [String: Double] = [:]
      for id in members {
        for (key, value) in kept[id] ?? [:] { times[key, default: 0] += value }
      }
      let things = times.sorted { $0.value > $1.value }
        .map { key, value in
          (key: key, label: labels[key]?.label ?? key, kind: labels[key]?.kind ?? .app, seconds: value)
        }
      let own = seconds(members)
      return ThreadSplitGroup(activityIDs: members, things: things, seconds: own, share: own / total)
    }
    let first = group(ordered[0])
    let second = group(ordered[1])
    guard first.share >= thresholds.minGroupShare, second.share >= thresholds.minGroupShare,
      first.activityIDs.count >= thresholds.minGroupActivities,
      second.activityIDs.count >= thresholds.minGroupActivities
    else { return nil }

    // The evidence against a split is an activity that used both sides' places. The grouping cannot put a place
    // that was really used in both sides, but it ignores glances, so an activity on one side may still have touched
    // the other side's page for a few seconds; and an activity that was all glances belongs to neither. Every such
    // activity counts against the split by all the time it spent in either side's places.
    let firstKeys = Set(first.things.map(\.key))
    let secondKeys = Set(second.things.map(\.key))
    let everything = activityTimes.values.reduce(0) { $0 + $1.values.reduce(0, +) }
    var shared: Set<String> = []
    var sharedSeconds: Double = 0
    for times in activityTimes.values {
      let keys = Set(times.keys)
      guard !keys.isDisjoint(with: firstKeys), !keys.isDisjoint(with: secondKeys) else { continue }
      for (key, value) in times where firstKeys.contains(key) || secondKeys.contains(key) {
        shared.insert(key)
        sharedSeconds += value
      }
    }
    let sharedShare = everything > 0 ? sharedSeconds / everything : 0
    guard sharedShare <= thresholds.maxSharedShare else { return nil }

    let others = Set(activityTimes.keys).subtracting(ordered[0]).subtracting(ordered[1])
    return ThreadSplitCandidate(
      threadID: threadID, groups: [first, second], otherActivities: others.sorted(),
      activityCount: activityTimes.count, sharedThings: shared.sorted(), sharedShare: sharedShare)
  }

  /// Seconds each of a thread's activities spent in each thing.
  public static func activityTimes(
    captures: [BindingCapture], readers: ThingReaders, builder: BindingBuilder = BindingBuilder()
  ) -> (times: [Int64: [String: Double]], labels: [String: ThingRef]) {
    var times: [Int64: [String: Double]] = [:]
    var labels: [String: ThingRef] = [:]
    for (index, capture) in captures.enumerated() {
      var span = builder.cadence
      if index + 1 < captures.count, captures[index + 1].activityID == capture.activityID {
        span = min(builder.cadence, max(0, captures[index + 1].at - capture.at))
      }
      span = min(span, max(0, capture.activityEnd - capture.at))
      guard span > 0, let ref = readers.ref(context: capture.context, at: capture.at) else { continue }
      times[capture.activityID, default: [:]][ref.key, default: 0] += span
      labels[ref.key] = ref
    }
    return (times, labels)
  }
}
