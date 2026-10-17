import Foundation
import GRDB

extension ThingKind: DatabaseValueConvertible {}

extension Thing: FetchableRecord, MutablePersistableRecord {
  public static let databaseTableName = "thing"
  public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension ThreadBinding: FetchableRecord, PersistableRecord {
  public static let databaseTableName = "binding"
}

extension AppDatabase {
  /// Adds things that are new and refreshes the ones already known, then answers with every key's id.
  ///
  /// A label improves over time (a page is titled, a session is named), so the newest label wins; a detail is only
  /// filled in, never cleared by a capture that happened not to carry one.
  public func upsertThings(_ refs: [ThingRef], firstSeen: [String: Double], lastSeen: [String: Double]) throws
    -> [String: Int64]
  {
    guard !refs.isEmpty else { return [:] }
    try writer.write { db in
      for ref in refs {
        try db.execute(
          sql: """
            INSERT INTO thing (key, kind, label, detail, bundleID, firstSeenAt, lastSeenAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              label = excluded.label,
              detail = COALESCE(excluded.detail, thing.detail),
              firstSeenAt = MIN(thing.firstSeenAt, excluded.firstSeenAt),
              lastSeenAt = MAX(thing.lastSeenAt, excluded.lastSeenAt)
            """,
          arguments: [
            ref.key, ref.kind.rawValue, ref.label, ref.detail, ref.bundleID,
            firstSeen[ref.key] ?? 0, lastSeen[ref.key] ?? 0,
          ])
      }
    }
    return try ids(ofThings: refs.map(\.key))
  }

  public func ids(ofThings keys: [String]) throws -> [String: Int64] {
    guard !keys.isEmpty else { return [:] }
    return try reader.read { db in
      var ids: [String: Int64] = [:]
      for slice in keys.chunked(900) {
        let marks = databaseQuestionMarks(count: slice.count)
        let rows = try Row.fetchAll(db, sql: "SELECT id, key FROM thing WHERE key IN (\(marks))", arguments: StatementArguments(slice))
        for row in rows { ids[row["key"]] = row["id"] }
      }
      return ids
    }
  }

  public func things(ids: [Int64]) throws -> [Int64: Thing] {
    guard !ids.isEmpty else { return [:] }
    return try reader.read { db in
      var things: [Int64: Thing] = [:]
      for slice in ids.chunked(900) {
        for thing in try Thing.fetchAll(db, keys: slice) {
          if let id = thing.id { things[id] = thing }
        }
      }
      return things
    }
  }

  public func thing(key: String) throws -> Thing? {
    try reader.read { db in try Thing.fetchOne(db, sql: "SELECT * FROM thing WHERE key = ?", arguments: [key]) }
  }

  /// Replaces every day bucket from `dayStart` on with `rows`, in one transaction.
  public func replaceBindings(_ rows: [ThreadBinding], fromDay dayStart: Double) throws {
    try writer.write { db in
      try db.execute(sql: "DELETE FROM binding WHERE dayStart >= ?", arguments: [dayStart])
      for row in rows { try row.insert(db) }
    }
  }

  /// Forgets every binding. Things stay: they are only identities, and an exclusion points at one, so deleting
  /// them would quietly undo every "not this thread" the person said.
  public func clearBindings() throws {
    try writer.write { db in try db.execute(sql: "DELETE FROM binding") }
  }

  public func bindings(threadID: Int64) throws -> [ThreadBinding] {
    try reader.read { db in
      try ThreadBinding.fetchAll(db, sql: "SELECT * FROM binding WHERE threadID = ?", arguments: [threadID])
    }
  }

  /// Every binding of the given things, across all threads: what a thing's time is shared with decides how much of
  /// it belongs to any one thread.
  public func bindings(thingIDs: [Int64]) throws -> [ThreadBinding] {
    guard !thingIDs.isEmpty else { return [] }
    return try reader.read { db in
      var rows: [ThreadBinding] = []
      for slice in thingIDs.chunked(900) {
        let marks = databaseQuestionMarks(count: slice.count)
        rows += try ThreadBinding.fetchAll(
          db, sql: "SELECT * FROM binding WHERE thingID IN (\(marks))", arguments: StatementArguments(slice))
      }
      return rows
    }
  }

  /// Every focused capture that sits inside an activity with a thread, oldest first within each activity: the input
  /// the bindings are built from. The join is the one `mainPlace(threadID:)` uses.
  public func capturesForBindings(since: Double = 0, threadID: Int64? = nil) throws -> [BindingCapture] {
    try reader.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT a.threadID AS threadID, a.id AS activityID, a.endAt AS activityEnd, c.at AS at,
                 c.bundleID AS bundleID, c.appName AS appName, c.windowTitle AS windowTitle,
                 c.urlHost AS urlHost, c.urlPath AS urlPath, c.id AS captureID
          FROM activity a JOIN capture c
            ON c.isFocusedDisplay = 1 AND c.at >= a.startAt AND c.at < a.endAt
          WHERE a.threadID IS NOT NULL AND a.endAt >= ? AND (? IS NULL OR a.threadID = ?)
          ORDER BY a.id, c.at
          """,
        arguments: [since, threadID, threadID]
      ).map { row in
        BindingCapture(
          threadID: row["threadID"], activityID: row["activityID"], activityEnd: row["activityEnd"], at: row["at"],
          captureID: row["captureID"],
          context: ForegroundContext(
            bundleID: row["bundleID"], appName: row["appName"], windowTitle: row["windowTitle"],
            urlHost: row["urlHost"], urlPath: row["urlPath"]))
      }
    }
  }

  /// Every binding and every thing, for building the whole palette in one pass rather than a query per thread.
  public func allBindings() throws -> [ThreadBinding] {
    try reader.read { db in try ThreadBinding.fetchAll(db, sql: "SELECT * FROM binding") }
  }

  public func allThings() throws -> [Int64: Thing] {
    try reader.read { db in
      var things: [Int64: Thing] = [:]
      for thing in try Thing.fetchAll(db, sql: "SELECT * FROM thing") {
        if let id = thing.id { things[id] = thing }
      }
      return things
    }
  }

  /// What was being done when each thread was last left: the title of its latest activity, or its caption while
  /// the title is still being written.
  public func latestActivityPerThread() throws -> [Int64: (at: Double, text: String)] {
    try reader.read { db in
      var latest: [Int64: (at: Double, text: String)] = [:]
      let rows = try Row.fetchAll(
        db,
        sql: """
          SELECT a.threadID AS threadID, a.endAt AS endAt, a.title AS title, a.caption AS caption
          FROM activity a
          JOIN (SELECT threadID, MAX(endAt) AS endAt FROM activity WHERE threadID IS NOT NULL GROUP BY threadID) m
            ON m.threadID = a.threadID AND m.endAt = a.endAt
          """)
      for row in rows {
        guard let threadID = row["threadID"] as Int64? else { continue }
        let title = row["title"] as String? ?? ""
        let text = title.isEmpty ? (row["caption"] as String? ?? "") : title
        latest[threadID] = (row["endAt"] as Double? ?? 0, text)
      }
      return latest
    }
  }

  /// Says a place is not this thread's. It stays said: a rebuild replaces the bindings, never the exclusions.
  public func exclude(thingID: Int64, fromThread threadID: Int64) throws {
    try writer.write { db in
      try db.execute(
        sql: "INSERT OR REPLACE INTO thingExclusion (threadID, thingID, at) VALUES (?, ?, ?)",
        arguments: [threadID, thingID, Date().timeIntervalSince1970])
    }
  }

  public func include(thingID: Int64, inThread threadID: Int64) throws {
    try writer.write { db in
      try db.execute(
        sql: "DELETE FROM thingExclusion WHERE threadID = ? AND thingID = ?", arguments: [threadID, thingID])
    }
  }

  /// Every exclusion, by thread.
  public func exclusions() throws -> [Int64: Set<Int64>] {
    try reader.read { db in
      var excluded: [Int64: Set<Int64>] = [:]
      for row in try Row.fetchAll(db, sql: "SELECT threadID, thingID FROM thingExclusion") {
        guard let threadID = row["threadID"] as Int64?, let thingID = row["thingID"] as Int64? else { continue }
        excluded[threadID, default: []].insert(thingID)
      }
      return excluded
    }
  }

  public func exclusions(threadID: Int64) throws -> Set<Int64> {
    try exclusions()[threadID] ?? []
  }

  /// Every place said not to belong, with the thread it was taken out of, newest first: what Settings lists so a
  /// drop can be put back.
  public func excludedPlaces() throws -> [ThingExclusion] {
    try reader.read { db in
      let rows = try Row.fetchAll(
        db,
        sql: """
          SELECT thing.*, thingExclusion.threadID AS excludedFrom, thingExclusion.at AS excludedAt,
            thread.name AS threadName
          FROM thingExclusion
          JOIN thing ON thing.id = thingExclusion.thingID
          JOIN thread ON thread.id = thingExclusion.threadID
          ORDER BY thingExclusion.at DESC
          """)
      return try rows.map { row in
        ThingExclusion(
          threadID: row["excludedFrom"], threadName: row["threadName"], thing: try Thing(row: row),
          at: row["excludedAt"])
      }
    }
  }

  /// Each thread's latest stored frame: the screen as it was when the thread was last left, which the palette shows
  /// as its preview. One query for every thread, about a millisecond on a store of a few weeks; duplicates are skipped,
  /// since they point at an earlier frame.
  public func latestFramePerThread() throws -> [Int64: Capture] {
    try reader.read { db in
      let rows = try Row.fetchAll(
        db,
        sql: """
          SELECT a.threadID AS threadID, c.id AS captureID, MAX(c.at) AS at
          FROM activity a JOIN capture c
            ON c.isFocusedDisplay = 1 AND c.framePath IS NOT NULL AND c.at >= a.startAt AND c.at < a.endAt
          WHERE a.threadID IS NOT NULL
          GROUP BY a.threadID
          """)
      let byCapture = Dictionary(
        rows.compactMap { row -> (String, Int64)? in
          guard let id = row["captureID"] as String?, let thread = row["threadID"] as Int64? else { return nil }
          return (id, thread)
        }, uniquingKeysWith: { first, _ in first })
      var frames: [Int64: Capture] = [:]
      for slice in Array(byCapture.keys).chunked(900) {
        for capture in try Capture.fetchAll(db, keys: slice) {
          if let thread = byCapture[capture.id] { frames[thread] = capture }
        }
      }
      return frames
    }
  }

  /// When the latest activity whose thread is settled ended: closed, and not a provisional guess. Screenshots after
  /// it belong to no thread yet (`ResumeFreshness`).
  public func latestSettledActivityEnd() throws -> Double? {
    try reader.read { db in
      try Double.fetchOne(
        db,
        sql: "SELECT MAX(endAt) FROM activity WHERE threadID IS NOT NULL AND isOpen = 0 AND isThreadProvisional = 0")
    }
  }

  /// The newest activity that has a thread. The newest of all is usually still open and not yet given one, so it
  /// cannot say which thread is being worked in.
  public func latestThreadedActivity() throws -> Activity? {
    try reader.read { db in
      try Activity.fetchOne(
        db, sql: "SELECT * FROM activity WHERE threadID IS NOT NULL ORDER BY startAt DESC LIMIT 1")
    }
  }

  /// Threads that have any binding, newest first, for the palette's list.
  public func threadsWithBindings(limit: Int = 50) throws -> [ActivityThread] {
    try reader.read { db in
      try ActivityThread.fetchAll(
        db,
        sql: """
          SELECT t.* FROM thread t WHERE t.mergedInto IS NULL
            AND EXISTS (SELECT 1 FROM binding b WHERE b.threadID = t.id)
          ORDER BY t.lastSeenAt DESC LIMIT ?
          """,
        arguments: [limit])
    }
  }
}

/// `?, ?, ?` for an `IN` list.
func databaseQuestionMarks(count: Int) -> String {
  Array(repeating: "?", count: count).joined(separator: ", ")
}

extension Array {
  /// SQLite takes a bounded number of bound values, so long `IN` lists go in slices.
  func chunked(_ size: Int) -> [[Element]] {
    guard count > size else { return isEmpty ? [] : [Array(self)] }
    return stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
  }
}
