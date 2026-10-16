import CryptoKit
import Foundation
import GRDB
import Testing

@testable import ScreencapCore

/// A bucket in memory, with S3's not-found behaviour.
actor MemoryBucket: ObjectStore {
  private(set) var objects: [String: Data] = [:]

  func put(_ key: String, _ data: Data) async throws { objects[key] = data }

  func get(_ key: String) async throws -> Data {
    guard let data = objects[key] else { throw S3Error.notFound(key) }
    return data
  }

  func delete(_ key: String) async throws { objects[key] = nil }
  func list(prefix: String) async throws -> [String] { objects.keys.filter { $0.hasPrefix(prefix) }.sorted() }
  func contains(prefix: String) async throws -> Bool { objects.keys.contains { $0.hasPrefix(prefix) } }
}

@Suite struct BackupServiceTests {
  /// 2026-10-14 10:00 UTC.
  static let day = ISO8601DateFormatter().date(from: "2026-10-14T10:00:00Z")!.timeIntervalSince1970
  let key = BackupKey(key: SymmetricKey(size: .bits256))

  /// A store with two closed activities in two threads, understood by the scripted models.
  func understoodStore() async throws -> Harness {
    let h = try Harness()
    for (i, app) in ["Cursor", "Cursor", "Dia", "Dia"].enumerated() { try h.add(app, at: Self.day + Double(i) * 120) }
    try await h.engine.advance(now: Self.day + 3600)
    #expect(try h.activities().allSatisfy { $0.threadID != nil })
    return h
  }

  /// Day files for the captures' day and for today, where decisions and corrections made now are filed.
  func enqueueDayFiles(_ h: Harness) throws {
    for day in Set([BackupKeys.day(Self.day), BackupKeys.day(Date().timeIntervalSince1970)]) {
      try h.database.enqueueBackup(.rows, objectKey: BackupKeys.rows(day: day))
    }
  }

  func service(_ h: Harness, _ bucket: MemoryBucket) -> BackupService {
    BackupService(database: h.database, location: h.location, store: bucket, key: key)
  }

  func restore(_ bucket: MemoryBucket) async throws -> (StoreLocation, AppDatabase, BackupRestore.Report) {
    let target = StoreLocation(root: FileManager.default.temporaryDirectory.appendingPathComponent("screencap-restore-\(UUID().uuidString)"))
    let report = try await BackupRestore(store: bucket, key: key).restore(into: target)
    return (target, try target.openDatabase(), report)
  }

  func expectSameRows(_ a: AppDatabase, _ b: AppDatabase) throws {
    for table in ["capture", "captureText", "boundary", "activity", "thread", "decision", "correction", "marker"] {
      let (left, right) = (try a.digest(of: table), try b.digest(of: table))
      #expect(left == right, "\(table): \(left.rows) vs \(right.rows) rows")
    }
  }

  @Test func restoreKeepsThreadsWhenDayFilesFollowTheSnapshot() async throws {
    let h = try await understoodStore()
    let bucket = MemoryBucket()
    let backup = service(h, bucket)
    try h.database.enqueueBackup(.snapshot, objectKey: BackupKeys.snapshot(week: BackupKeys.week(Self.day)))
    try await backup.drain()
    // After the snapshot: a rename and a new activity, carried by the day file.
    let thread = try #require(try h.database.allThreads().first?.id)
    try Corrections(database: h.database, location: h.location, engine: h.engine).rename(threadID: thread, to: "Renamed")
    try h.add("Mail", at: Self.day + 600)
    try await h.engine.advance(now: Self.day + 7200)
    try enqueueDayFiles(h)
    try await backup.drain()

    let (_, restored, report) = try await restore(bucket)
    #expect(report.dayFiles == 2)
    #expect(try restored.activities(from: 0, to: .greatestFiniteMagnitude).allSatisfy { $0.threadID != nil })
    try expectSameRows(h.database, restored)
  }

  @Test func deletedActivityStaysDeletedAfterRestoringAnOlderSnapshot() async throws {
    let h = try await understoodStore()
    let bucket = MemoryBucket()
    let backup = service(h, bucket)
    try h.database.enqueueBackup(.snapshot, objectKey: BackupKeys.snapshot(week: BackupKeys.week(Self.day)))
    try await backup.drain()
    let deleted = try #require(try h.activities().last?.id)
    try Corrections(database: h.database, location: h.location, engine: h.engine).delete(activityID: deleted)
    try enqueueDayFiles(h)
    try await backup.drain()

    let (_, restored, report) = try await restore(bucket)
    #expect(report.deletedActivities == 1)
    #expect(try restored.activity(id: deleted) == nil)
    #expect(try restored.decision(kind: "caption", subject: "activity:\(deleted)") == nil)
    try expectSameRows(h.database, restored)
  }

  @Test func aDayFileFromAnOlderBuildStillApplies() throws {
    let (_, source) = try temporaryStore()
    let capture = Capture(
      at: 1000, trigger: .timer, displayID: 1, isFocusedDisplay: true, context: ForegroundContext(appName: "Dia"),
      framePath: nil, thumbPath: nil, pixelWidth: 10, pixelHeight: 10, dHash: 0, duplicateOf: nil, ocrState: .notNeeded,
      window: ScreenRect(x: 0.1, y: 0.1, width: 0.5, height: 0.5))
    try source.insert(capture)
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("day-\(UUID().uuidString).sqlite").path
    _ = try AppDatabase(path: file)
    try source.exportDayRows(start: 0, end: 86_400, into: file, exportedAt: 10)
    // As a build from before window frames wrote it.
    let old = try DatabaseQueue(path: file)
    try old.write { db in
      for column in ["windowX", "windowY", "windowWidth", "windowHeight"] { try db.execute(sql: "ALTER TABLE capture DROP COLUMN \(column)") }
      try db.execute(sql: "DELETE FROM grdb_migrations WHERE identifier = 'v4-window'")
    }
    try old.close()

    let (_, target) = try temporaryStore()
    #expect(try target.applyDayFile(at: file, ifExportedAfter: nil))
    let restored = try target.reader.read { db in try Capture.fetchOne(db, key: capture.id) }
    #expect(restored?.context.appName == "Dia")
    #expect(restored?.window == nil)
    #expect(try source.reader.read { db in try Capture.fetchOne(db, key: capture.id) }?.window == capture.window)
  }

  @Test func dayFileFromBeforeTheSnapshotIsSkipped() async throws {
    let h = try await understoodStore()
    let bucket = MemoryBucket()
    let backup = service(h, bucket)
    try h.database.enqueueBackup(.rows, objectKey: BackupKeys.rows(day: BackupKeys.day(Self.day)))
    try await backup.drain()
    try h.database.enqueueBackup(.snapshot, objectKey: BackupKeys.snapshot(week: BackupKeys.week(Self.day)))
    try await backup.drain()

    let (_, restored, report) = try await restore(bucket)
    #expect(report.dayFiles == 0)
    #expect(report.skippedDayFiles == 1)
    try expectSameRows(h.database, restored)
  }

  @Test func framesUploadUnderTheirUTCDayAndAMissingOneIsReported() async throws {
    let h = try Harness()
    let path = "Frames/a.heic"
    try FileManager.default.createDirectory(at: h.location.url("Frames"), withIntermediateDirectories: true)
    try Data("frame bytes".utf8).write(to: h.location.url(path))
    // 23:30 UTC: the next day in any time zone east of UTC, which must not change the key.
    let late = Self.day + 13.5 * 3600
    let kept = try h.add("Cursor", at: late, frame: path)
    _ = try h.add("Cursor", at: late + 60, frame: "Frames/never-uploaded.heic")
    #expect(BackupKeys.frame(capture: kept) == "f1/frames/2026/10/14/\(kept.id).heic.enc")
    let bucket = MemoryBucket()
    try h.database.enqueueBackup(.frame, objectKey: BackupKeys.frame(capture: kept), localPath: path)
    try h.database.enqueueBackup(.snapshot, objectKey: BackupKeys.snapshot(week: BackupKeys.week(late)))
    try await service(h, bucket).drain()

    let (location, restored, report) = try await restore(bucket)
    #expect(report.frames == 1)
    #expect(report.missingFrames == 1)
    #expect(try Data(contentsOf: location.url(path)) == Data("frame bytes".utf8))
    #expect(try restored.capturesWithFrames().map(\.id) == [kept.id])
  }

  @Test func aDeleteQueuedDuringAnUploadIsNotMarkedDone() throws {
    let (_, database) = try temporaryStore()
    try database.enqueueBackup(.frame, objectKey: "f1/frames/x", localPath: "Frames/x.heic", at: 100)
    let running = try #require(try database.dueBackupJobs(now: 200, limit: 10).first)
    try database.enqueueBackup(.delete, objectKey: "f1/frames/x", at: 150)
    try database.finishBackupJob(running)
    let pending = try database.dueBackupJobs(now: 200, limit: 10)
    #expect(pending.map(\.kind) == [.delete])
  }

  @Test func snapshotPrunesWhatItSupersedes() async throws {
    let h = try await understoodStore()
    let bucket = MemoryBucket()
    for old in ["f1/db/2026-W30.sqlite.enc", "f1/rows/2026-09-01.sqlite.enc"] { try await bucket.put(old, Data()) }
    let now = Date().timeIntervalSince1970
    let recent = BackupKeys.rows(day: BackupKeys.day(now - 2 * 86_400))
    try await bucket.put(recent, Data())
    try h.database.enqueueBackup(.snapshot, objectKey: BackupKeys.snapshot(week: BackupKeys.week(now)))
    try await service(h, bucket).drain()
    let keys = try await bucket.list(prefix: "f1/")
    #expect(keys == [BackupKeys.snapshot(week: BackupKeys.week(now)), recent].sorted())
  }

  @Test func nightlyScheduleQueuesAWeekOfDayFilesAndOneSnapshot() async throws {
    let (location, database) = try temporaryStore()
    let backup = BackupService(database: database, location: location, store: MemoryBucket(), key: key)
    try await backup.scheduleNightly(now: Self.day)
    try await backup.scheduleNightly(now: Self.day + 60)
    let jobs = try database.dueBackupJobs(now: Self.day + 120, limit: 50)
    #expect(jobs.filter { $0.kind == .snapshot }.count == 1)
    #expect(jobs.filter { $0.kind == .rows }.map(\.objectKey).sorted().first == BackupKeys.rows(day: "2026-10-07"))
    #expect(jobs.filter { $0.kind == .rows }.count == 7)
  }
}
