import Foundation
import GRDB

extension AppDatabase {
  /// The focused display's captures in `[start, end)`, oldest first.
  public func focusedCaptures(from start: Double, to end: Double) throws -> [Capture] {
    try reader.read { db in
      try Capture.fetchAll(
        db, sql: "SELECT * FROM capture WHERE isFocusedDisplay = 1 AND at >= ? AND at < ? ORDER BY at", arguments: [start, end])
    }
  }

  /// Every window title seen since `since`, once per place and thread, for learning what sites call themselves, and
  /// when `bundleID` was in front and for which thread.
  ///
  /// Captures and activities are walked side by side: joining them in SQL took eight seconds on two months of history.
  public func seenTitles(since: Double, momentsOf bundleID: String) throws -> (titles: [SeenTitle], moments: [(at: Double, threadID: Int64)]) {
    try reader.read { db in
      let activities = try Row.fetchAll(
        db, sql: "SELECT startAt, endAt, threadID FROM activity WHERE endAt >= ? ORDER BY startAt", arguments: [since]
      ).map { (startAt: $0["startAt"] as Double, endAt: $0["endAt"] as Double, threadID: $0["threadID"] as Int64?) }
      var counts: [SeenTitle: Int] = [:]
      var moments: [(at: Double, threadID: Int64)] = []
      var next = 0
      let rows = try Row.fetchCursor(
        db,
        sql: """
          SELECT at, bundleID, appName, urlHost, urlPath, windowTitle FROM capture
          WHERE isFocusedDisplay = 1 AND at >= ? ORDER BY at
          """,
        arguments: [since])
      while let row = try rows.next() {
        let at: Double = row[0]
        while next < activities.count, activities[next].startAt <= at { next += 1 }
        let activity = next > 0 && at < activities[next - 1].endAt ? activities[next - 1] : nil
        let bundle: String? = row[1]
        if bundle == bundleID, let thread = activity?.threadID { moments.append((at, thread)) }
        guard let title: String = row[5] else { continue }
        let seen = SeenTitle(
          bundleID: bundle, appName: row[2], host: row[3], path: row[4], title: title, threadID: activity?.threadID, count: 0)
        counts[seen, default: 0] += 1
      }
      let titles = counts.map { seen, count in
        var seen = seen
        seen.count = count
        return seen
      }
      return (titles, moments)
    }
  }

  /// Every local day with activities, newest first, with how much was captured and the threads that took most of it.
  public func canvasDays(calendar: Calendar = .current, threadsPerDay: Int = 3) throws -> [CanvasDaySummary] {
    let rows = try reader.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT a.startAt AS startAt, a.captureCount AS captures, t.name AS name
          FROM activity a LEFT JOIN thread t ON t.id = a.threadID
          """)
    }
    var captures: [Double: Int] = [:]
    var threads: [Double: [String: Int]] = [:]
    for row in rows {
      let start = ThreadBinding.dayStart(row["startAt"], calendar: calendar)
      let count: Int = row["captures"]
      captures[start, default: 0] += count
      if let name: String = row["name"] { threads[start, default: [:]][name, default: 0] += count }
    }
    return captures.keys.sorted(by: >).map { start in
      let top = (threads[start] ?? [:]).sorted { ($0.value, $1.key) > ($1.value, $0.key) }.prefix(threadsPerDay).map(\.key)
      return CanvasDaySummary(start: start, captures: captures[start] ?? 0, threads: top)
    }
  }
}
