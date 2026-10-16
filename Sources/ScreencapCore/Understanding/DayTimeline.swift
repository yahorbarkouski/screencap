import Foundation

/// What the Day view and the panel draw for one local day: sessions, time per thread, and the 10-minute grid.
public struct DayTimeline: Sendable, Equatable {
  /// A run of one thread's activities, with short detours into other threads folded in.
  public struct Session: Sendable, Equatable, Identifiable {
    public var id: Int64 { activities.first?.id ?? 0 }
    public var threadID: Int64?
    public var activities: [Activity]
    /// Detours of one short activity between two runs of this thread.
    public var detours: [Activity]
    public var startAt: Double
    public var endAt: Double
    public var minutes: Double
    public var isOpen: Bool
  }

  public enum Item: Sendable, Equatable, Identifiable {
    case session(Session)
    /// Nothing captured for this many minutes (away, asleep, paused).
    case gap(start: Double, minutes: Double)

    public var id: String {
      switch self {
      case .session(let s): "s\(s.id)"
      case .gap(let start, _): "g\(start)"
      }
    }
  }

  public struct ThreadTime: Sendable, Equatable, Identifiable {
    public var id: Int64 { threadID ?? -1 }
    public var threadID: Int64?
    public var minutes: Double
  }

  /// Oldest first; the Day view reverses for newest first.
  public var items: [Item]
  /// Most time first.
  public var threads: [ThreadTime]
  /// 144 ten-minute slots from local midnight: the thread that held most of each slot, 0 for active time whose
  /// activity has no thread yet, nil for no activity.
  public var grid: [Int64?]
  public var activeMinutes: Double
  public var activityCount: Int

  /// A detour folds into the surrounding session when it is one activity of at most this long.
  public static let detourMinutes = 4.5
  /// A larger gap between activities shows as "Away".
  public static let gapMinutes = 10.0

  public init(activities: [Activity], dayStart: Double, dayEnd: Double) {
    let sorted = activities.filter { $0.endAt > dayStart && $0.startAt < dayEnd }.sorted { $0.startAt < $1.startAt }
    func clippedMinutes(_ a: Activity) -> Double { max(0, min(a.endAt, dayEnd) - max(a.startAt, dayStart)) / 60 }

    var items: [Item] = []
    var index = 0
    while index < sorted.count {
      let activity = sorted[index]
      if case .session(var current)? = items.last, current.threadID == activity.threadID, activity.threadID != nil,
        activity.startAt - current.endAt <= Self.gapMinutes * 60
      {
        current.activities.append(activity)
        current.endAt = max(current.endAt, activity.endAt)
        current.minutes += clippedMinutes(activity)
        current.isOpen = activity.isOpen
        items[items.count - 1] = .session(current)
        index += 1
        continue
      }
      // A short single activity between two runs of the same thread is a detour inside that session.
      if case .session(var current)? = items.last, index + 1 < sorted.count,
        clippedMinutes(activity) <= Self.detourMinutes, current.threadID != nil,
        sorted[index + 1].threadID == current.threadID,
        sorted[index + 1].startAt - activity.endAt <= Self.gapMinutes * 60,
        activity.startAt - current.endAt <= Self.gapMinutes * 60
      {
        current.detours.append(activity)
        current.endAt = activity.endAt
        current.minutes += clippedMinutes(activity)
        items[items.count - 1] = .session(current)
        index += 1
        continue
      }
      if let previousEnd = items.last.flatMap({ item -> Double? in
        if case .session(let s) = item { return s.endAt }
        return nil
      }), activity.startAt - previousEnd > Self.gapMinutes * 60 {
        items.append(.gap(start: previousEnd, minutes: (activity.startAt - previousEnd) / 60))
      }
      items.append(
        .session(
          Session(
            threadID: activity.threadID, activities: [activity], detours: [], startAt: activity.startAt,
            endAt: activity.endAt, minutes: clippedMinutes(activity), isOpen: activity.isOpen)))
      index += 1
    }
    self.items = items

    var perThread: [Int64?: Double] = [:]
    for activity in sorted { perThread[activity.threadID, default: 0] += clippedMinutes(activity) }
    threads = perThread.map { ThreadTime(threadID: $0.key, minutes: $0.value) }
      .sorted { $0.minutes == $1.minutes ? ($0.threadID ?? 0) < ($1.threadID ?? 0) : $0.minutes > $1.minutes }

    var slots = [[Int64: Double]](repeating: [:], count: 144)
    for activity in sorted {
      let start = max(activity.startAt, dayStart)
      let end = min(activity.endAt, dayEnd)
      guard end > start else { continue }
      var slot = Int((start - dayStart) / 600)
      while slot < 144 {
        let slotStart = dayStart + Double(slot) * 600
        let overlap = min(end, slotStart + 600) - max(start, slotStart)
        if overlap <= 0 { break }
        slots[slot][activity.threadID ?? 0, default: 0] += overlap
        slot += 1
      }
    }
    grid = slots.map { slot in slot.max { $0.value < $1.value }?.key }
    activeMinutes = sorted.map(clippedMinutes).reduce(0, +)
    activityCount = sorted.count
  }
}

/// The day in order as chapters: stretches where one thread led, with short visits elsewhere folded in, so a day of
/// ~90 activities reads as ~25 rows. A visit shorter than `shortMinutes` joins the chapter it interrupted (listed in
/// `also`); two stretches of one thread around such a visit are one chapter; `awayMinutes` without activity ends one.
public struct DayChapters: Sendable, Equatable {
  public struct Chapter: Sendable, Equatable, Identifiable {
    public var id: Int64 { activities.first?.id ?? 0 }
    /// The thread with the most minutes in the chapter.
    public var threadID: Int64?
    /// Every activity in the chapter, oldest first.
    public var activities: [Activity]
    public var startAt: Double
    public var endAt: Double

    public var minutes: Double { activities.map(\.minutes).reduce(0, +) }
    /// The other threads visited, most minutes first.
    public var also: [Int64] {
      var minutes: [Int64: Double] = [:]
      for activity in activities { if let id = activity.threadID, id != threadID { minutes[id, default: 0] += activity.minutes } }
      return minutes.sorted { $0.value > $1.value }.map(\.key)
    }
    /// The chapter's longest activity of its own thread, the one it is named after.
    public var main: Activity? { activities.filter { $0.threadID == threadID }.max { $0.minutes < $1.minutes } }
  }

  public static let shortMinutes = 6.0
  public static let awayMinutes = 20.0

  /// Oldest first.
  public var chapters: [Chapter]

  public init(activities: [Activity]) {
    var runs: [Chapter] = []
    for activity in activities.sorted(by: { $0.startAt < $1.startAt }) {
      if var last = runs.last, last.threadID == activity.threadID, activity.startAt - last.endAt <= Self.awayMinutes * 60 {
        last.activities.append(activity)
        last.endAt = max(last.endAt, activity.endAt)
        runs[runs.count - 1] = last
      } else {
        runs.append(Chapter(threadID: activity.threadID, activities: [activity], startAt: activity.startAt, endAt: activity.endAt))
      }
    }
    // Fold short runs: between two runs of one thread they join them; otherwise they join the run before.
    var index = 0
    while index < runs.count {
      let run = runs[index]
      let isShort = (run.endAt - run.startAt) / 60 < Self.shortMinutes
      let before = index > 0 ? runs[index - 1] : nil
      let after = index + 1 < runs.count ? runs[index + 1] : nil
      guard isShort, let before, run.startAt - before.endAt <= Self.awayMinutes * 60 else {
        index += 1
        continue
      }
      var merged = before
      merged.activities += run.activities
      merged.endAt = max(merged.endAt, run.endAt)
      if let after, after.threadID == before.threadID, after.startAt - run.endAt <= Self.awayMinutes * 60 {
        merged.activities += after.activities
        merged.endAt = max(merged.endAt, after.endAt)
        runs.replaceSubrange((index - 1)...(index + 1), with: [merged])
      } else {
        runs.replaceSubrange((index - 1)...index, with: [merged])
      }
      index = max(index - 1, 1)
    }
    chapters = runs.map { chapter in
      var chapter = chapter
      var minutes: [Int64?: Double] = [:]
      for activity in chapter.activities { minutes[activity.threadID, default: 0] += activity.minutes }
      chapter.threadID = minutes.max { $0.value < $1.value }?.key ?? chapter.threadID
      return chapter
    }
  }
}
