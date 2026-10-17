import Foundation

/// What the screen has shown since the understanding last settled an activity, put to use before it is sorted.
///
/// An activity gets its thread only once the boundary after it is decided, which waits for two more screenshots and
/// took about four minutes on average (up to eight) on 17 October 2026. Until then the screenshots of the last few
/// minutes belong to no thread, so a thread you were in a minute ago looked as if you had left it where its last
/// sorted activity ended, eighteen minutes earlier. A screenshot of a page or window that already clearly belongs to
/// one thread says which thread was in front, without waiting: this credits each such screenshot to that thread.
public enum ResumeFreshness {
  /// The thread each place belongs to: the one holding more than `minShare` of the place's time across all threads,
  /// counted as the ranking counts it. A place shared more evenly has no owner, so it credits nobody.
  public static func owners(
    bindings: [ThreadBinding], now: Double, halfLifeDays: Double = ResumeThresholds().halfLifeDays,
    minShare: Double = 0.5
  ) -> [Int64: Int64] {
    var byPlace: [Int64: [Int64: Double]] = [:]
    for row in bindings {
      let weight = ResumeRanking.decayed(seconds: row.seconds, dayStart: row.dayStart, now: now, halfLifeDays: halfLifeDays)
      byPlace[row.thingID, default: [:]][row.threadID, default: 0] += weight
    }
    var owners: [Int64: Int64] = [:]
    for (thing, threads) in byPlace {
      let total = threads.values.reduce(0, +)
      guard total > 0, let best = threads.max(by: { $0.value < $1.value }), best.value / total > minShare else { continue }
      owners[thing] = best.key
    }
    return owners
  }

  /// One screenshot not yet in a settled activity: when it was taken, and the place it showed when that place is
  /// known.
  public struct Seen: Sendable, Equatable {
    public var at: Double
    public var thingID: Int64?

    public init(at: Double, thingID: Int64?) {
      self.at = at
      self.thingID = thingID
    }
  }

  /// The last moment each thread was on screen, from the screenshots of the unsorted minutes.
  public static func lastSeen(_ seen: [Seen], owners: [Int64: Int64]) -> [Int64: Double] {
    var last: [Int64: Double] = [:]
    for item in seen {
      guard let thing = item.thingID, let thread = owners[thing] else { continue }
      last[thread] = max(last[thread] ?? 0, item.at)
    }
    return last
  }

  /// The thread in front now: the owner of the place in the newest screenshot, when it was taken within `within`
  /// seconds. Nil when no thread owns that place, such as a page never seen before or a Claude window several threads
  /// share: an older screenshot says which thread you left, which is the one you may want back.
  public static func current(_ seen: [Seen], owners: [Int64: Int64], now: Double, within: Double = 600) -> Int64? {
    guard let newest = seen.max(by: { $0.at < $1.at }), now - newest.at < within, let thing = newest.thingID else {
      return nil
    }
    return owners[thing]
  }
}
