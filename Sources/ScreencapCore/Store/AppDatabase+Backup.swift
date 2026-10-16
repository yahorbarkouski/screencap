import CryptoKit
import Foundation
import GRDB

/// What an outbox row asks the uploader to do.
public enum BackupJobKind: String, Codable, Sendable {
  /// Upload a kept frame.
  case frame
  /// Write one UTC day's row file and upload it. The file is written when the job runs, so it is never stale.
  case rows
  /// Write a full snapshot of the database and upload it, then prune what it supersedes.
  case snapshot
  /// Delete an object the user deleted locally.
  case delete
  /// Upload the list of everything the user deleted.
  case tombstones
}

public enum BackupJobState: String, Codable, Sendable {
  case pending, done, failed
}

/// One unit of backup work, drained by the uploader. Object keys are deterministic, so a retried job is idempotent.
public struct BackupJob: Codable, Sendable, Hashable {
  public var id: Int64?
  public var kind: BackupJobKind
  public var objectKey: String
  /// The frame's path relative to the store root; nil for the other kinds.
  public var localPath: String?
  public var state: BackupJobState
  public var attempts: Int
  public var nextAttemptAt: Double
  public var lastError: String?
  public var createdAt: Double
}

extension BackupJob: FetchableRecord, MutablePersistableRecord {
  public static let databaseTableName = "backupOutbox"
  public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

/// Object names in the bucket. `f1` is the backup format version. Days and weeks are UTC, so an object's key is the
/// same whatever time zone the Mac is in when it uploads, restores or deletes it.
public enum BackupKeys {
  public static let rowsPrefix = "f1/rows/"
  public static let snapshotPrefix = "f1/db/"
  public static let tombstones = "f1/tombstones.json.enc"
  static let utc = TimeZone(identifier: "UTC")!

  public static func frame(capture: Capture) -> String {
    "f1/frames/\(day(capture.at).replacingOccurrences(of: "-", with: "/"))/\(capture.id).heic.enc"
  }

  public static func rows(day: String) -> String { "\(rowsPrefix)\(day).sqlite.enc" }
  public static func snapshot(week: String) -> String { "\(snapshotPrefix)\(week).sqlite.enc" }

  /// The day or week a rows or snapshot key names.
  public static func name(of key: String) -> String {
    (key as NSString).lastPathComponent.replacingOccurrences(of: ".sqlite.enc", with: "")
  }

  /// `2026-10-15`, the UTC day of a moment.
  public static func day(_ at: Double) -> String { TimeFormatter(timeZone: utc).day(at) }

  /// `2026-W42`, the ISO week of a moment in UTC.
  public static func week(_ at: Double) -> String {
    var calendar = Calendar(identifier: .iso8601)
    calendar.timeZone = utc
    let parts = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: Date(timeIntervalSince1970: at))
    return String(format: "%04d-W%02d", parts.yearForWeekOfYear ?? 0, parts.weekOfYear ?? 0)
  }

  /// The start and end of a UTC day named like `2026-10-15`.
  public static func bounds(ofDay day: String) -> (start: Double, end: Double) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    let parts = day.split(separator: "-").compactMap { Int($0) }
    let start = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))!
    return (start.timeIntervalSince1970, calendar.date(byAdding: .day, value: 1, to: start)!.timeIntervalSince1970)
  }
}

extension AppDatabase {
  public func enqueueBackup(_ kind: BackupJobKind, objectKey: String, localPath: String? = nil, at: Double = Date().timeIntervalSince1970) throws {
    try writer.write { db in try Self.enqueueBackup(db, kind, objectKey: objectKey, localPath: localPath, at: at) }
  }

  /// Queues a job, or turns the job already queued on the same key into this one, due now.
  static func enqueueBackup(_ db: Database, _ kind: BackupJobKind, objectKey: String, localPath: String?, at: Double) throws {
    try db.execute(
      sql: """
        INSERT INTO backupOutbox (kind, objectKey, localPath, state, attempts, nextAttemptAt, createdAt)
        VALUES (?, ?, ?, 'pending', 0, ?, ?)
        ON CONFLICT(objectKey) DO UPDATE SET kind = excluded.kind, localPath = excluded.localPath,
          state = 'pending', attempts = 0, nextAttemptAt = excluded.nextAttemptAt, lastError = NULL
        """,
      arguments: [kind.rawValue, objectKey, localPath, at, at])
  }

  public func dueBackupJobs(now: Double, limit: Int) throws -> [BackupJob] {
    try reader.read { db in
      try BackupJob.fetchAll(
        db,
        sql: "SELECT * FROM backupOutbox WHERE state = 'pending' AND nextAttemptAt <= ? ORDER BY id LIMIT ?",
        arguments: [now, limit])
    }
  }

  /// Marks a job done, unless its row was queued again while it ran (a delete after an upload, or a fresh day file):
  /// every enqueue and every failure moves `nextAttemptAt`, so a changed row stays pending for the next drain.
  public func finishBackupJob(_ job: BackupJob) throws {
    try writer.write { db in
      try db.execute(
        sql: "UPDATE backupOutbox SET state = 'done', lastError = NULL WHERE id = ? AND kind = ? AND nextAttemptAt = ?",
        arguments: [job.id, job.kind.rawValue, job.nextAttemptAt])
    }
  }

  /// Transport failures back off exponentially from 30 s to 6 h; jobs are never dropped. A row queued again while the
  /// job ran keeps its new schedule.
  public func failBackupJob(_ job: BackupJob, error: String, now: Double) throws {
    try writer.write { db in
      let attempts = job.attempts + 1
      let delay = min(30 * pow(2, Double(attempts - 1)), 6 * 3600)
      try db.execute(
        sql: "UPDATE backupOutbox SET attempts = ?, nextAttemptAt = ?, lastError = ? WHERE id = ? AND kind = ? AND nextAttemptAt = ?",
        arguments: [attempts, now + delay, error, job.id, job.kind.rawValue, job.nextAttemptAt])
    }
  }

  public func backupCounts() throws -> [String: Int] {
    try reader.read { db in
      Dictionary(
        uniqueKeysWithValues: try Row.fetchAll(db, sql: "SELECT state, COUNT(*) AS n FROM backupOutbox GROUP BY state")
          .map { ($0["state"] as String, $0["n"] as Int) })
    }
  }
}

// MARK: - Tombstones

/// The ids the user deleted. A restore deletes them from the snapshot and day files it applies.
public struct Tombstones: Codable, Sendable, Equatable {
  public var captures: [String] = []
  public var activities: [Int64] = []

  public init(captures: [String] = [], activities: [Int64] = []) {
    self.captures = captures
    self.activities = activities
  }
}

extension AppDatabase {
  static func addTombstone(_ db: Database, kind: String, id: String, at: Double) throws {
    try db.execute(sql: "INSERT OR IGNORE INTO tombstone (kind, id, at) VALUES (?, ?, ?)", arguments: [kind, id, at])
  }

  public func tombstones() throws -> Tombstones {
    try reader.read { db in
      Tombstones(
        captures: try String.fetchAll(db, sql: "SELECT id FROM tombstone WHERE kind = 'capture' ORDER BY id"),
        activities: try String.fetchAll(db, sql: "SELECT id FROM tombstone WHERE kind = 'activity'").compactMap { Int64($0) }.sorted())
    }
  }

  /// Deletes what the tombstones name, with the caption decisions of deleted activities, and keeps the tombstones so
  /// this store's next upload of the list still names them.
  public func apply(_ tombstones: Tombstones, at: Double = Date().timeIntervalSince1970) throws {
    try writer.write { db in
      for id in tombstones.captures {
        try db.execute(sql: "DELETE FROM capture WHERE id = ?", arguments: [id])
        try Self.addTombstone(db, kind: "capture", id: id, at: at)
      }
      for id in tombstones.activities {
        try db.execute(sql: "DELETE FROM activity WHERE id = ?", arguments: [id])
        try db.execute(sql: "DELETE FROM decision WHERE subject = ?", arguments: ["activity:\(id)"])
        try Self.addTombstone(db, kind: "activity", id: String(id), at: at)
      }
    }
  }
}

// MARK: - Day files, snapshots and restore

extension AppDatabase {
  /// The tables a day file carries, in an order where every row's references come first.
  static let dayFileTables = ["capture", "captureText", "boundary", "thread", "activity", "decision", "correction", "marker"]

  /// Copies one UTC day's rows, and every thread, into the day file at `path` (which already has the schema), with
  /// the moment of export, which a restore compares with the snapshot's.
  public func exportDayRows(start: Double, end: Double, into path: String, exportedAt: Double) throws {
    try writer.writeWithoutTransaction { db in
      try db.execute(sql: "ATTACH DATABASE ? AS day", arguments: [path])
      defer { try? db.execute(sql: "DETACH DATABASE day") }
      try db.inTransaction {
        let range: StatementArguments = [start, end]
        try db.execute(sql: "INSERT INTO day.capture SELECT * FROM main.capture WHERE at >= ? AND at < ?", arguments: range)
        try db.execute(sql: "INSERT INTO day.captureText SELECT t.* FROM main.captureText t JOIN main.capture c ON c.id = t.captureID WHERE c.at >= ? AND c.at < ?", arguments: range)
        try db.execute(sql: "INSERT INTO day.boundary SELECT b.* FROM main.boundary b JOIN main.capture c ON c.id = b.rightCaptureID WHERE c.at >= ? AND c.at < ?", arguments: range)
        try db.execute(sql: "INSERT INTO day.thread SELECT * FROM main.thread")
        try db.execute(sql: "INSERT INTO day.activity SELECT * FROM main.activity WHERE startAt >= ? AND startAt < ?", arguments: range)
        try db.execute(sql: "INSERT INTO day.decision SELECT * FROM main.decision WHERE createdAt >= ? AND createdAt < ?", arguments: range)
        try db.execute(sql: "INSERT INTO day.correction SELECT * FROM main.correction WHERE at >= ? AND at < ?", arguments: range)
        try db.execute(sql: "INSERT INTO day.marker SELECT * FROM main.marker WHERE at >= ? AND at < ?", arguments: range)
        try db.execute(sql: "INSERT INTO day.meta (key, value) VALUES ('backup.exportedAt', ?)", arguments: [String(exportedAt)])
        return .commit
      }
    }
  }

  /// Writes this whole database into `path` (`VACUUM INTO`), stamped with the moment it was taken.
  public func writeSnapshot(to path: String, takenAt: Double) throws {
    try setMeta("backup.snapshotAt", String(takenAt))
    try writer.writeWithoutTransaction { db in try db.execute(sql: "VACUUM INTO ?", arguments: [path]) }
  }

  /// When the snapshot this store was restored from was taken; nil when it did not come from one.
  public func snapshotTakenAt() throws -> Double? {
    try meta("backup.snapshotAt").flatMap(Double.init)
  }

  /// Applies a day file exported after `snapshotAt` and returns true; an older file is already in the snapshot and
  /// would undo changes made after it, so it is skipped. Rows are updated in place (`INSERT OR REPLACE` would delete
  /// them first, and `ON DELETE SET NULL` would clear every activity's thread), with foreign keys checked at commit.
  public func applyDayFile(at path: String, ifExportedAfter snapshotAt: Double?) throws -> Bool {
    // A day file written by an older build gains this build's columns (empty) before its rows are copied.
    _ = try AppDatabase(path: path)
    return try writer.writeWithoutTransaction { db in
      try db.execute(sql: "ATTACH DATABASE ? AS day", arguments: [path])
      defer { try? db.execute(sql: "DETACH DATABASE day") }
      let exportedAt = try String.fetchOne(db, sql: "SELECT value FROM day.meta WHERE key = 'backup.exportedAt'").flatMap(Double.init) ?? 0
      if let snapshotAt, exportedAt <= snapshotAt { return false }
      try db.inTransaction {
        try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
        for table in Self.dayFileTables { try Self.upsertRows(db, table: table, from: "day") }
        return .commit
      }
      return true
    }
  }

  /// Inserts every row of `source.table` into `main.table`, updating rows that already exist.
  static func upsertRows(_ db: Database, table: String, from source: String) throws {
    let columns = try Row.fetchAll(db, sql: "PRAGMA main.table_info(\(table))")
    let names = columns.map { "\"\($0["name"] as String)\"" }
    let keys = columns.filter { ($0["pk"] as Int) > 0 }.map { "\"\($0["name"] as String)\"" }
    let updates = names.filter { !keys.contains($0) }.map { "\($0) = excluded.\($0)" }
    let list = names.joined(separator: ", ")
    try db.execute(
      sql: """
        INSERT INTO main.\(table) (\(list)) SELECT \(list) FROM \(source).\(table) WHERE true
        ON CONFLICT(\(keys.joined(separator: ", "))) DO UPDATE SET \(updates.joined(separator: ", "))
        """)
  }

  public func capturesWithFrames() throws -> [Capture] {
    try reader.read { db in try Capture.fetchAll(db, sql: "SELECT * FROM capture WHERE framePath IS NOT NULL ORDER BY at") }
  }

  public func setFramePaths(captureID: String, frame: String?, thumb: String?) throws {
    try writer.write { db in
      try db.execute(sql: "UPDATE capture SET framePath = ?, thumbPath = ? WHERE id = ?", arguments: [frame, thumb, captureID])
    }
  }

  /// Rebuilds the full-text index from capture rows and their stored text.
  public func rebuildSearchIndex() throws {
    try writer.write { db in
      try db.execute(sql: "DELETE FROM captureSearch")
      try db.execute(sql: """
        INSERT INTO captureSearch (rowid, captureID, title, host, body)
        SELECT c.rowid, c.id, COALESCE(c.windowTitle, ''), COALESCE(c.urlHost, ''),
          COALESCE((SELECT group_concat(json_extract(value, '$.text'), ' ') FROM captureText t, json_each(t.lines) WHERE t.captureID = c.id), '')
        FROM capture c
        """)
    }
  }

  public func markOutboxDone() throws {
    try writer.write { db in try db.execute(sql: "UPDATE backupOutbox SET state = 'done', lastError = NULL") }
  }

  /// A digest of every row of `table` in primary-key order, for checking that a restore matches its source.
  /// `ignoring` names columns allowed to differ (a restore moves frames recorded at absolute paths into the store).
  public func digest(of table: String, ignoring: Set<String> = []) throws -> (rows: Int, digest: String) {
    try reader.read { db in
      let columns = try Row.fetchAll(db, sql: "PRAGMA table_info(\(table))")
      let names = columns.map { $0["name"] as String }.filter { !ignoring.contains($0) }
      let keys = columns.filter { ($0["pk"] as Int) > 0 }.map { "\"\($0["name"] as String)\"" }
      let rows = try Row.fetchAll(
        db, sql: "SELECT \(names.map { "quote(\"\($0)\")" }.joined(separator: " || '|' || ")) AS line FROM \(table) ORDER BY \(keys.joined(separator: ", "))")
      var hash = SHA256()
      for row in rows { hash.update(data: Data((row["line"] as String + "\n").utf8)) }
      return (rows.count, hash.finalize().map { String(format: "%02x", $0) }.joined())
    }
  }
}
