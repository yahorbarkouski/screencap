import Foundation
import GRDB
import SQLite3

/// The app's SQLite database (WAL, one writer, concurrent readers) and its schema.
public final class AppDatabase: Sendable {
  public let writer: DatabasePool

  public init(path: String) throws {
    var config = Configuration()
    config.foreignKeysEnabled = true
    config.prepareDatabase { db in
      try db.execute(sql: "PRAGMA synchronous = NORMAL")
      // Deleted rows are overwritten with zeros, so a deleted moment's text does not linger in free pages.
      try db.execute(sql: "PRAGMA secure_delete = ON")
      // The -wal and -shm files stay when the app quits: a read-only connection (`Screencap mcp`) cannot create
      // them, so without them it could not open the store while the app is closed.
      var persist: Int32 = 1
      sqlite3_file_control(db.sqliteConnection, nil, SQLITE_FCNTL_PERSIST_WAL, &persist)
    }
    writer = try DatabasePool(path: path, configuration: config)
    try Self.migrator.migrate(writer)
  }

  /// Opens a store only to read it: SQLite refuses every write on these connections, and no migration runs. Throws
  /// `StoreNeedsUpdate` when the store lacks a migration this build knows, which the app applies on its next launch.
  public init(readingAt path: String) throws {
    var config = Configuration()
    config.readonly = true
    writer = try DatabasePool(path: path, configuration: config)
    guard try writer.read({ try Self.migrator.hasCompletedMigrations($0) }) else { throw StoreNeedsUpdate() }
  }

  public struct StoreNeedsUpdate: Error {}

  public var reader: any DatabaseReader { writer }

  static var migrator: DatabaseMigrator {
    var migrator = DatabaseMigrator()
    migrator.registerMigration("v1") { db in
      try db.create(table: "capture") { t in
        t.primaryKey("id", .text)
        t.column("at", .double).notNull().indexed()
        t.column("trigger", .text).notNull()
        t.column("displayID", .integer).notNull()
        t.column("isFocusedDisplay", .boolean).notNull()
        t.column("bundleID", .text)
        t.column("appName", .text)
        t.column("windowTitle", .text)
        t.column("urlHost", .text)
        t.column("urlPath", .text)
        t.column("framePath", .text)
        t.column("thumbPath", .text)
        t.column("pixelWidth", .integer).notNull()
        t.column("pixelHeight", .integer).notNull()
        t.column("dHash", .integer).notNull()
        t.column("duplicateOf", .text).references("capture", onDelete: .setNull)
        t.column("ocrState", .text).notNull().indexed()
      }
      try db.create(index: "capture_focused_at", on: "capture", columns: ["isFocusedDisplay", "at"])

      try db.create(table: "captureText") { t in
        t.primaryKey("captureID", .text).references("capture", onDelete: .cascade)
        t.column("lines", .jsonText).notNull()
        t.column("ocrMS", .integer).notNull()
      }
      try db.create(virtualTable: "captureSearch", using: FTS5()) { t in
        t.tokenizer = .unicode61(diacritics: .remove)
        t.column("captureID").notIndexed()
        t.column("title")
        t.column("host")
        t.column("body")
      }

      try db.create(table: "marker") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("at", .double).notNull().indexed()
        t.column("kind", .text).notNull()
      }

      try db.create(table: "boundary") { t in
        t.primaryKey("rightCaptureID", .text).references("capture", onDelete: .cascade)
        t.column("leftCaptureID", .text).notNull()
        t.column("pNew", .double).notNull()
        t.column("isBoundary", .boolean).notNull()
        t.column("source", .text).notNull()
        t.column("decidedAt", .double).notNull()
      }

      try db.create(table: "thread") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("name", .text).notNull()
        t.column("summary", .text).notNull()
        t.column("category", .text).notNull()
        t.column("isNameLocked", .boolean).notNull()
        t.column("isCategoryLocked", .boolean).notNull()
        t.column("createdAt", .double).notNull()
        t.column("lastSeenAt", .double).notNull().indexed()
        t.column("activityCount", .integer).notNull()
        t.column("captions", .jsonText).notNull()
        t.column("includes", .jsonText).notNull()
        t.column("excludes", .jsonText).notNull()
        t.column("mergedInto", .integer).references("thread", onDelete: .setNull)
      }

      try db.create(table: "activity") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("firstCaptureID", .text).notNull()
        t.column("lastCaptureID", .text).notNull()
        t.column("startAt", .double).notNull().indexed()
        t.column("endAt", .double).notNull()
        t.column("captureCount", .integer).notNull()
        t.column("isOpen", .boolean).notNull()
        t.column("threadID", .integer).references("thread", onDelete: .setNull).indexed()
        t.column("threadProbability", .double)
        t.column("isThreadProvisional", .boolean).notNull()
        t.column("caption", .text)
        t.column("isThreadLocked", .boolean).notNull()
      }

      try db.create(table: "decision") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("kind", .text).notNull()
        t.column("subject", .text).notNull()
        t.column("answer", .text).notNull()
        t.column("probability", .double)
        t.column("model", .text).notNull()
        t.column("inputTokens", .integer).notNull()
        t.column("costUSD", .double).notNull()
        t.column("latencyMS", .integer).notNull()
        t.column("createdAt", .double).notNull().indexed()
      }
      try db.create(index: "decision_subject", on: "decision", columns: ["kind", "subject"])

      try db.create(table: "correction") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("kind", .text).notNull()
        t.column("payload", .text).notNull()
        t.column("at", .double).notNull()
      }

      try db.create(table: "backupOutbox") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("kind", .text).notNull()
        t.column("objectKey", .text).notNull().unique()
        t.column("localPath", .text)
        t.column("state", .text).notNull().indexed()
        t.column("attempts", .integer).notNull()
        t.column("nextAttemptAt", .double).notNull()
        t.column("lastError", .text)
        t.column("createdAt", .double).notNull()
      }

      try db.create(table: "meta") { t in
        t.primaryKey("key", .text)
        t.column("value", .text).notNull()
      }
    }
    // What the user deleted, so a restore drops it from snapshots and day files written before the delete.
    migrator.registerMigration("v2-tombstones") { db in
      try db.create(table: "tombstone") { t in
        t.column("kind", .text).notNull()
        t.column("id", .text).notNull()
        t.column("at", .double).notNull()
        t.primaryKey(["kind", "id"])
      }
    }
    // A short title per activity, for the Day view.
    migrator.registerMigration("v3-titles") { db in
      try db.alter(table: "activity") { t in t.add(column: "title", .text) }
    }
    migrator.registerMigration("v4-window") { db in
      try db.alter(table: "capture") { t in
        t.add(column: "windowX", .double)
        t.add(column: "windowY", .double)
        t.add(column: "windowWidth", .double)
        t.add(column: "windowHeight", .double)
      }
    }
    migrator.registerMigration("v5-anchors") { db in
      try db.alter(table: "capture") { t in t.add(column: "isAnchor", .boolean).notNull().defaults(to: true) }
    }
    // Places worth coming back to, and the time each was on screen while a thread was being worked on.
    migrator.registerMigration("v6-bindings") { db in
      try db.create(table: "thing") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("key", .text).notNull().unique()
        t.column("kind", .text).notNull()
        t.column("label", .text).notNull()
        t.column("detail", .text)
        t.column("bundleID", .text)
        t.column("firstSeenAt", .double).notNull()
        t.column("lastSeenAt", .double).notNull()
      }
      try db.create(table: "binding") { t in
        t.column("threadID", .integer).notNull().references("thread", onDelete: .cascade)
        t.column("thingID", .integer).notNull().references("thing", onDelete: .cascade)
        t.column("dayStart", .double).notNull()
        t.column("seconds", .double).notNull()
        t.column("captures", .integer).notNull()
        t.primaryKey(["threadID", "thingID", "dayStart"])
      }
      // How much of a thing's time belongs to other threads decides whether it is really this thread's.
      try db.create(index: "binding_thing", on: "binding", columns: ["thingID"])
    }
    // How many separate stretches of work a place appeared in: a page visited once and never again is not
    // somewhere you come back to, however long it was on screen.
    migrator.registerMigration("v7-binding-activities") { db in
      try db.alter(table: "binding") { t in t.add(column: "activities", .integer).notNull().defaults(to: 1) }
    }
    // Places the person said are not a thread's. Kept apart from `binding`, which a rebuild replaces wholesale.
    migrator.registerMigration("v8-thing-exclusions") { db in
      try db.create(table: "thingExclusion") { t in
        t.column("threadID", .integer).notNull().references("thread", onDelete: .cascade)
        t.column("thingID", .integer).notNull().references("thing", onDelete: .cascade)
        t.column("at", .double).notNull()
        t.primaryKey(["threadID", "thingID"])
      }
    }
    return migrator
  }
}

// MARK: - Record conformances

extension Capture: FetchableRecord, PersistableRecord {
  public static let databaseTableName = "capture"

  public init(row: Row) {
    self.init(
      id: row["id"], at: row["at"], trigger: CaptureTrigger(rawValue: row["trigger"]) ?? .timer,
      displayID: UInt32(row["displayID"] as Int64), isFocusedDisplay: row["isFocusedDisplay"],
      context: ForegroundContext(
        bundleID: row["bundleID"], appName: row["appName"], windowTitle: row["windowTitle"],
        urlHost: row["urlHost"], urlPath: row["urlPath"]),
      framePath: row["framePath"], thumbPath: row["thumbPath"], pixelWidth: row["pixelWidth"],
      pixelHeight: row["pixelHeight"], dHash: row["dHash"], duplicateOf: row["duplicateOf"],
      ocrState: OCRState(rawValue: row["ocrState"]) ?? .pending,
      window: {
        guard let x = row["windowX"] as Double?, let y = row["windowY"] as Double?, let width = row["windowWidth"] as Double?,
          let height = row["windowHeight"] as Double?
        else { return nil }
        return ScreenRect(x: x, y: y, width: width, height: height)
      }(),
      isAnchor: row["isAnchor"] ?? true)
  }

  public func encode(to container: inout PersistenceContainer) {
    container["id"] = id
    container["at"] = at
    container["trigger"] = trigger.rawValue
    container["displayID"] = Int64(displayID)
    container["isFocusedDisplay"] = isFocusedDisplay
    container["bundleID"] = context.bundleID
    container["appName"] = context.appName
    container["windowTitle"] = context.windowTitle
    container["urlHost"] = context.urlHost
    container["urlPath"] = context.urlPath
    container["framePath"] = framePath
    container["thumbPath"] = thumbPath
    container["pixelWidth"] = pixelWidth
    container["pixelHeight"] = pixelHeight
    container["dHash"] = dHash
    container["duplicateOf"] = duplicateOf
    container["ocrState"] = ocrState.rawValue
    container["windowX"] = window?.x
    container["windowY"] = window?.y
    container["windowWidth"] = window?.width
    container["windowHeight"] = window?.height
    container["isAnchor"] = isAnchor
  }
}

extension Marker: FetchableRecord, MutablePersistableRecord {
  public static let databaseTableName = "marker"
  public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension BoundaryDecision: FetchableRecord, PersistableRecord {
  public static let databaseTableName = "boundary"
}

extension Activity: FetchableRecord, MutablePersistableRecord {
  public static let databaseTableName = "activity"
  public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension ActivityThread: FetchableRecord, MutablePersistableRecord {
  public static let databaseTableName = "thread"
  public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension DecisionRecord: FetchableRecord, MutablePersistableRecord {
  public static let databaseTableName = "decision"
  public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

extension Correction: FetchableRecord, MutablePersistableRecord {
  public static let databaseTableName = "correction"
  public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}
