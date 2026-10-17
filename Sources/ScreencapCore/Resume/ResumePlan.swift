import Foundation

public struct ResumeThresholds: Sendable {
  /// Time on screen counts half as much for every half-life it is older, so a thread you have moved on from stops
  /// dragging last month's pages back.
  public var halfLifeDays: Double = 7
  /// A thing most of whose time belongs to other threads is not this thread's. This is what keeps a video watched
  /// between tasks out of a thread it was merely interleaved with.
  public var minShare: Double = 0.25
  /// A glance is not a place you were working in.
  public var minSeconds: Double = 30
  /// Somewhere you came back to, or somewhere you stayed. Without this, a thread of seven news articles offers
  /// seven finished articles, each its own address, each seen once.
  public var minActivities = 2
  /// Time that makes a place worth keeping even if it was all in one stretch.
  public var longStaySeconds: Double = 300
  /// Bringing twenty windows forward is as useless as bringing none.
  public var maxThings = 8
  /// Pages from one part of a site, such as streams, episodes or games, that stand in for each other: when this many
  /// or more belong to a thread, only the one seen last is kept. A thread of streams watched over several evenings
  /// can hold a different channel each evening, and would otherwise bring back every one.
  public var crowdSize = 3
  /// A place scoring under this share of the thread's top place is left out: a Claude session typed into for three
  /// minutes while a stream played for hours is not what coming back to the stream means.
  public var minShareOfTop = 0.1

  public init() {}
}

/// One thing in a thread, with how much of it belongs to the thread.
public struct ThingScore: Sendable, Equatable {
  public var thing: Thing
  /// Decayed seconds inside this thread.
  public var weight: Double
  /// This thread's share of the thing's decayed time across every thread.
  public var share: Double
  /// `weight × share`: time spent here, discounted by how much the thing is shared.
  public var score: Double
  public var seconds: Double
  public var captures: Int
  /// Separate stretches of work this thing appeared in, inside this thread.
  public var activities: Int
  public var lastSeenAt: Double
}

public enum ResumeRanking {
  /// A day's seconds after the half-life discount.
  public static func decayed(seconds: Double, dayStart: Double, now: Double, halfLifeDays: Double) -> Double {
    let days = max(0, (now - dayStart) / 86_400)
    return seconds * pow(0.5, days / halfLifeDays)
  }

  /// Scores every thing bound to `threadID`, highest first.
  ///
  /// `everyBinding` must hold the rows of these things across all threads, which is what makes `share` meaningful:
  /// without it a page watched all day in another thread would look like this thread's.
  public static func scores(
    threadID: Int64, bindings: [ThreadBinding], everyBinding: [ThreadBinding], things: [Int64: Thing], now: Double,
    thresholds: ResumeThresholds = ResumeThresholds()
  ) -> [ThingScore] {
    var mine: [Int64: (weight: Double, seconds: Double, captures: Int, activities: Int, last: Double)] = [:]
    for row in bindings where row.threadID == threadID {
      let weight = decayed(seconds: row.seconds, dayStart: row.dayStart, now: now, halfLifeDays: thresholds.halfLifeDays)
      var entry = mine[row.thingID] ?? (0, 0, 0, 0, 0)
      entry.weight += weight
      entry.seconds += row.seconds
      entry.captures += row.captures
      entry.activities += row.activities
      entry.last = max(entry.last, row.dayStart)
      mine[row.thingID] = entry
    }
    var totals: [Int64: Double] = [:]
    for row in everyBinding {
      totals[row.thingID, default: 0] += decayed(
        seconds: row.seconds, dayStart: row.dayStart, now: now, halfLifeDays: thresholds.halfLifeDays)
    }
    return mine.compactMap { id, entry in
      guard let thing = things[id] else { return nil }
      let total = max(totals[id] ?? entry.weight, entry.weight)
      let share = total > 0 ? entry.weight / total : 1
      return ThingScore(
        thing: thing, weight: entry.weight, share: share, score: entry.weight * share, seconds: entry.seconds,
        captures: entry.captures, activities: entry.activities, lastSeenAt: thing.lastSeenAt)
    }
    .sorted { $0.score > $1.score }
  }

  /// What a resume should bring forward: the scores that clear the thresholds, capped.
  ///
  /// Measured on a replay of three days of history (76 returns to a thread, each against the places then used):
  /// the thresholds alone brought back 177 places, 53 of them used. Keeping one page of each crowd of
  /// siblings, the floor relative to the top place, and leaving out generated frames brought back 120, 48 of them
  /// used, nearly halving the places that were not.
  ///
  /// When nothing clears them the best single thing is kept anyway, so resuming a thread that has only ever been one
  /// shared window still does something.
  public static func plan(
    _ scores: [ThingScore], excluded: Set<Int64> = [], thresholds: ResumeThresholds = ResumeThresholds()
  ) -> [ThingScore] {
    let scores = scores.filter { score in
      !excluded.contains(score.thing.id ?? -1) && !ThingKey.isGeneratedFrame(score.thing.key)
    }
    var kept = scores.filter { score in
      score.share >= thresholds.minShare && score.seconds >= thresholds.minSeconds
        && (score.activities >= thresholds.minActivities || score.seconds >= thresholds.longStaySeconds)
    }
    kept = latestOfEachCrowd(kept, size: thresholds.crowdSize)
    if let top = kept.first?.score { kept = kept.filter { $0.score >= top * thresholds.minShareOfTop } }
    if kept.isEmpty { return Array(scores.prefix(1)) }
    return Array(kept.prefix(thresholds.maxThings))
  }

  /// Of each crowd of `size` or more sibling pages, only the one seen last, in its place in the order.
  static func latestOfEachCrowd(_ scores: [ThingScore], size: Int) -> [ThingScore] {
    var crowds: [String: [ThingScore]] = [:]
    for score in scores {
      if let parent = ThingKey.parent(of: score.thing.key) { crowds[parent, default: []].append(score) }
    }
    var latest: Set<String> = []
    for crowd in crowds.values where crowd.count >= size {
      if let last = crowd.max(by: { $0.thing.lastSeenAt < $1.thing.lastSeenAt }) { latest.insert(last.thing.key) }
    }
    return scores.filter { score in
      guard let parent = ThingKey.parent(of: score.thing.key), let crowd = crowds[parent], crowd.count >= size else {
        return true
      }
      return latest.contains(score.thing.key)
    }
  }
}
