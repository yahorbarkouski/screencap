import Foundation

/// One focused capture with the thread it belongs to, as the binding builder reads it.
public struct BindingCapture: Sendable {
  public var threadID: Int64
  public var activityID: Int64
  public var activityEnd: Double
  public var at: Double
  public var captureID: String
  public var context: ForegroundContext

  public init(
    threadID: Int64, activityID: Int64, activityEnd: Double, at: Double, captureID: String,
    context: ForegroundContext
  ) {
    self.threadID = threadID
    self.activityID = activityID
    self.activityEnd = activityEnd
    self.at = at
    self.captureID = captureID
    self.context = context
  }
}

public struct BindingReport: Sendable, Equatable {
  public var threads = 0
  public var things = 0
  public var rows = 0
  public var seconds: Double = 0
  /// Captures of Claude's window that the session index could name, and those it could not. The second number is
  /// how much of the biggest app on screen stays an undifferentiated blob.
  public var claudeNamed = 0
  public var claudeUnnamed = 0
}

/// Turns captures that already have a thread into time on screen per thing.
///
/// Nothing new has to be recorded for this: a capture already carries the app, the window title and the page, and
/// the activity it falls in already carries a thread. So the whole history can be built at once, and a thread that
/// changes shape later is rebuilt from the same source.
public struct BindingBuilder: Sendable {
  /// Seconds a capture stands for when nothing follows it in its activity: the capture cadence, the same value
  /// `UnderstandingEngine` gives an activity's last capture.
  public var cadence: Double
  public var calendar: Calendar

  public init(cadence: Double = 60, calendar: Calendar = .current) {
    self.cadence = cadence
    self.calendar = calendar
  }

  /// Per thread, thing and day: seconds and captures, with each thing's newest label.
  public struct Totals: Sendable {
    public var seconds: [Key: Double] = [:]
    public var captures: [Key: Int] = [:]
    /// The stretches of work each thing appeared in, per day bucket.
    public var activities: [Key: Set<Int64>] = [:]
    /// The newest reference seen for a key, which carries the label to store.
    public var refs: [String: ThingRef] = [:]
    public var refSeenAt: [String: Double] = [:]
    public var firstSeen: [String: Double] = [:]
    public var lastSeen: [String: Double] = [:]
    public var report = BindingReport()

    public struct Key: Hashable, Sendable {
      public var threadID: Int64
      public var thingKey: String
      public var dayStart: Double
    }
  }

  /// Walks the captures and adds up time, asking `readers` what place each capture was looking at.
  public func totals(for captures: [BindingCapture], readers: ThingReaders) -> Totals {
    var totals = Totals()
    var threads: Set<Int64> = []
    for (index, capture) in captures.enumerated() {
      threads.insert(capture.threadID)
      // The capture stands for the time until the next one in the same activity, capped at the cadence so a long
      // gap inside an activity does not turn into hours on one page.
      var span = cadence
      if index + 1 < captures.count, captures[index + 1].activityID == capture.activityID {
        span = min(cadence, max(0, captures[index + 1].at - capture.at))
      }
      span = min(span, max(0, capture.activityEnd - capture.at))
      guard span > 0 else { continue }

      let ref = readers.ref(context: capture.context, at: capture.at)
      if capture.context.bundleID == ClaudeSessionIndex.bundleID {
        // How much of the biggest app on screen is named by its conversation rather than left as one blob.
        if ref?.kind == .session { totals.report.claudeNamed += 1 } else { totals.report.claudeUnnamed += 1 }
      }
      guard let ref else { continue }

      let key = Totals.Key(
        threadID: capture.threadID, thingKey: ref.key, dayStart: ThreadBinding.dayStart(capture.at, calendar: calendar))
      totals.seconds[key, default: 0] += span
      totals.captures[key, default: 0] += 1
      totals.activities[key, default: []].insert(capture.activityID)
      if (totals.refSeenAt[ref.key] ?? -1) <= capture.at {
        totals.refSeenAt[ref.key] = capture.at
        totals.refs[ref.key] = ref
      }
      totals.firstSeen[ref.key] = min(totals.firstSeen[ref.key] ?? capture.at, capture.at)
      totals.lastSeen[ref.key] = max(totals.lastSeen[ref.key] ?? capture.at, capture.at)
      totals.report.seconds += span
    }
    totals.report.threads = threads.count
    totals.report.things = totals.refs.count
    totals.report.rows = totals.seconds.count
    return totals
  }

  /// Rebuilds every day bucket from the local day `since` falls in up to now, for every thread, and returns what
  /// it wrote. `since` of 0 rebuilds everything.
  ///
  /// The window is whole days, and exactly the buckets in it are replaced: a day before it is left as it was, so a
  /// pass over the last few days never erases what a thread did last week. Every thread's buckets in the window go,
  /// not only the threads seen in it, because an activity moved to another thread since leaves its time in the old
  /// one otherwise. Running it again over the same window writes the same rows.
  @discardableResult
  public func rebuild(in database: AppDatabase, since: Double = 0, readers: ThingReaders) throws
    -> BindingReport
  {
    // Everything means everything: local midnight before the epoch is negative, so 0 would leave some days out.
    let windowStart = since > 0 ? ThreadBinding.dayStart(since, calendar: calendar) : -Double.greatestFiniteMagnitude
    // An activity that ends in the window may have begun before it; its earlier captures belong to a day the
    // window does not replace, so they are left out rather than added a second time.
    let captures = try database.capturesForBindings(since: windowStart).filter { $0.at >= windowStart }
    let totals = totals(for: captures, readers: readers)
    let refs = Array(totals.refs.values)
    let ids = try database.upsertThings(refs, firstSeen: totals.firstSeen, lastSeen: totals.lastSeen)

    var rows: [ThreadBinding] = []
    rows.reserveCapacity(totals.seconds.count)
    for (key, seconds) in totals.seconds {
      guard let thingID = ids[key.thingKey] else { continue }
      rows.append(
        ThreadBinding(
          threadID: key.threadID, thingID: thingID, dayStart: key.dayStart, seconds: seconds,
          captures: totals.captures[key] ?? 0, activities: totals.activities[key]?.count ?? 1))
    }
    try database.replaceBindings(rows, fromDay: windowStart)
    var report = totals.report
    report.rows = rows.count
    return report
  }
}
