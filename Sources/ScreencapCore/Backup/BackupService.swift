import CryptoKit
import Foundation
import GRDB
import ImageIO

/// The bucket operations the backup needs. `S3Client` is the real one; tests use an in-memory bucket.
public protocol ObjectStore: Sendable {
  func put(_ key: String, _ data: Data) async throws
  /// Throws `S3Error.notFound` for a missing key.
  func get(_ key: String) async throws -> Data
  /// Deleting a missing key succeeds.
  func delete(_ key: String) async throws
  func list(prefix: String) async throws -> [String]
  /// Whether any key starts with `prefix`, without listing them all.
  func contains(prefix: String) async throws -> Bool
}

extension S3Client: ObjectStore {}

/// Drains the backup outbox: seals each frame, day file and snapshot and uploads it, and deletes what the user deleted.
///
/// A restore starts from the latest snapshot and applies the day files exported after it. Every night the files of
/// the last seven UTC days are written again, so captions, merges and corrections that land after midnight reach the
/// backup within a day; changes to older days arrive with the next weekly snapshot.
public actor BackupService {
  let database: AppDatabase
  let location: StoreLocation
  let store: any ObjectStore
  let key: BackupKey
  let concurrency: Int
  /// Days of row files written each night, and kept in the bucket before the latest snapshot.
  public static let dayFileWindow = 7

  public init(database: AppDatabase, location: StoreLocation, store: any ObjectStore, key: BackupKey, concurrency: Int = 4) {
    self.database = database
    self.location = location
    self.store = store
    self.key = key
    self.concurrency = concurrency
  }

  public struct DrainReport: Sendable {
    public var uploaded = 0
    public var deleted = 0
    public var failed = 0

    public init() {}
  }

  /// Queues, once per UTC day, the day files of the last seven days, and this week's snapshot once.
  public func scheduleNightly(now: Double = Date().timeIntervalSince1970) throws {
    let today = BackupKeys.day(now)
    guard try database.meta("backup.scheduledDay") != today else { return }
    let week = BackupKeys.week(now)
    if try database.meta("backup.snapshotWeek") != week {
      try database.enqueueBackup(.snapshot, objectKey: BackupKeys.snapshot(week: week), at: now)
      try database.setMeta("backup.snapshotWeek", week)
    }
    for daysAgo in 1...Self.dayFileWindow {
      try database.enqueueBackup(.rows, objectKey: BackupKeys.rows(day: BackupKeys.day(now - Double(daysAgo) * 86_400)), at: now)
    }
    try database.setMeta("backup.scheduledDay", today)
  }

  /// Runs every due job once. A failed job backs off and is retried by a later drain; nothing is dropped.
  @discardableResult
  public func drain(limit: Int = 500) async throws -> DrainReport {
    let jobs = try database.dueBackupJobs(now: Date().timeIntervalSince1970, limit: limit)
    var outcomes: [(BackupJob, String?)] = []
    try await withThrowingTaskGroup(of: (BackupJob, String?).self) { group in
      var running = 0
      for job in jobs {
        if running >= concurrency, let outcome = try await group.next() {
          running -= 1
          outcomes.append(outcome)
        }
        group.addTask {
          do {
            try await self.run(job)
            return (job, nil)
          } catch {
            return (job, String(describing: error))
          }
        }
        running += 1
      }
      for try await outcome in group { outcomes.append(outcome) }
    }
    var report = DrainReport()
    for (job, error) in outcomes {
      if let error {
        try database.failBackupJob(job, error: error, now: Date().timeIntervalSince1970)
        report.failed += 1
      } else {
        try database.finishBackupJob(job)
        if job.kind == .delete { report.deleted += 1 } else { report.uploaded += 1 }
      }
    }
    return report
  }

  func run(_ job: BackupJob) async throws {
    switch job.kind {
    case .delete:
      try await store.delete(job.objectKey)
    case .tombstones:
      try await upload(try JSONEncoder().encode(try database.tombstones()), as: BackupKeys.tombstones)
    case .frame:
      guard let path = job.localPath, Self.isFrameFile(path) else { return }
      try await upload(try Data(contentsOf: location.url(path)), as: job.objectKey)
    case .rows:
      let file = try exportDay(BackupKeys.name(of: job.objectKey))
      defer { try? FileManager.default.removeItem(at: file) }
      try await upload(try Data(contentsOf: file), as: job.objectKey)
    case .snapshot:
      let takenAt = Date().timeIntervalSince1970
      let file = try exportSnapshot(BackupKeys.name(of: job.objectKey), takenAt: takenAt)
      defer { try? FileManager.default.removeItem(at: file) }
      try await upload(try Data(contentsOf: file), as: job.objectKey)
      try await prune(keeping: job.objectKey, takenAt: takenAt)
    }
  }

  /// Whether a frame row's path may be read and uploaded: a path inside the store without `..`, or an image file
  /// elsewhere (a replay store's frames stay in the experiment's folder). A row naming any other file, such as
  /// `~/.ssh/id_ed25519`, uploads nothing.
  static func isFrameFile(_ path: String) -> Bool {
    guard !path.split(separator: "/").contains("..") else { return false }
    if !path.hasPrefix("/") { return true }
    return ["heic", "jpg", "jpeg", "png"].contains((path as NSString).pathExtension.lowercased())
  }

  func upload(_ data: Data, as objectKey: String) async throws {
    try await store.put(objectKey, try Sealer.seal(data, objectKey: objectKey, with: key))
  }

  /// A new snapshot supersedes the older ones and the day files from before its seven-day window, which a restore
  /// would skip anyway. Deleting them also removes what the user deleted from the bucket.
  func prune(keeping snapshot: String, takenAt: Double) async throws {
    for old in try await store.list(prefix: BackupKeys.snapshotPrefix) where old != snapshot {
      try await store.delete(old)
    }
    let oldest = BackupKeys.day(takenAt - Double(Self.dayFileWindow) * 86_400)
    for file in try await store.list(prefix: BackupKeys.rowsPrefix) where BackupKeys.name(of: file) < oldest {
      try await store.delete(file)
    }
  }

  /// Writes one UTC day's rows (captures, text, boundaries, activities, decisions, markers, corrections, and every
  /// thread) into a standalone SQLite file.
  func exportDay(_ day: String) throws -> URL {
    let (start, end) = BackupKeys.bounds(ofDay: day)
    let file = location.root.appendingPathComponent("Outgoing/rows-\(day).sqlite")
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: file)
    _ = try AppDatabase(path: file.path)
    try database.exportDayRows(start: start, end: end, into: file.path, exportedAt: Date().timeIntervalSince1970)
    return file
  }

  /// A full copy of the database (`VACUUM INTO`).
  func exportSnapshot(_ week: String, takenAt: Double) throws -> URL {
    let file = location.root.appendingPathComponent("Outgoing/snapshot-\(week).sqlite")
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: file)
    try database.writeSnapshot(to: file.path, takenAt: takenAt)
    return file
  }
}

/// Rebuilds a store from the bucket: the latest snapshot, then the day files exported after it, then the frames,
/// minus whatever the user deleted.
public struct BackupRestore: Sendable {
  let store: any ObjectStore
  let key: BackupKey

  public init(store: any ObjectStore, key: BackupKey) {
    self.store = store
    self.key = key
  }

  public struct Report: Sendable {
    public var snapshot: String?
    public var dayFiles = 0
    /// Day files exported before the snapshot, whose rows the snapshot already holds.
    public var skippedDayFiles = 0
    public var frames = 0
    /// Frames whose upload had not finished when the backup was last written.
    public var missingFrames = 0
    public var deletedCaptures = 0
    public var deletedActivities = 0
  }

  public func restore(into location: StoreLocation) async throws -> Report {
    var report = Report()
    try location.prepare()
    guard !FileManager.default.fileExists(atPath: location.databaseURL.path) else {
      throw CocoaError(.fileWriteFileExists, userInfo: [NSFilePathErrorKey: location.databaseURL.path])
    }
    if let latest = try await store.list(prefix: BackupKeys.snapshotPrefix).sorted().last {
      try await open(latest).write(to: location.databaseURL)
      report.snapshot = latest
    }
    let database = try AppDatabase(path: location.databaseURL.path)
    let snapshotAt = try database.snapshotTakenAt()
    for dayKey in try await store.list(prefix: BackupKeys.rowsPrefix).sorted() {
      let file = location.root.appendingPathComponent("rows-\(BackupKeys.name(of: dayKey)).sqlite")
      try await open(dayKey).write(to: file)
      defer { try? FileManager.default.removeItem(at: file) }
      if try database.applyDayFile(at: file.path, ifExportedAfter: snapshotAt) {
        report.dayFiles += 1
      } else {
        report.skippedDayFiles += 1
      }
    }
    do {
      let tombstones = try JSONDecoder().decode(Tombstones.self, from: try await open(BackupKeys.tombstones))
      try database.apply(tombstones)
      report.deletedCaptures = tombstones.captures.count
      report.deletedActivities = tombstones.activities.count
    } catch S3Error.notFound {
      // Nothing was ever deleted.
    }
    for capture in try database.capturesWithFrames() {
      guard let path = capture.framePath else { continue }
      let data: Data
      do {
        data = try await open(BackupKeys.frame(capture: capture))
      } catch S3Error.notFound {
        try database.setFramePaths(captureID: capture.id, frame: nil, thumb: nil)
        report.missingFrames += 1
        continue
      }
      // Everything restored lands inside the target store, whatever path the source recorded.
      let framePath = path.hasPrefix("/")
        ? location.frameRelativePath(captureID: capture.id, at: capture.at).replacingOccurrences(of: ".heic", with: "." + (path as NSString).pathExtension)
        : path
      let thumbPath = capture.thumbPath.map { $0.hasPrefix("/") ? location.thumbRelativePath(captureID: capture.id, at: capture.at) : $0 }
      let url = location.url(framePath)
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: url)
      if let thumbPath, let source = CGImageSourceCreateWithData(data as CFData, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
      {
        try FrameEncoder.writeThumbnail(image, to: location.url(thumbPath))
      }
      if framePath != path || thumbPath != capture.thumbPath {
        try database.setFramePaths(captureID: capture.id, frame: framePath, thumb: thumbPath)
      }
      report.frames += 1
    }
    try database.rebuildSearchIndex()
    // The snapshot carries the source's outbox; everything in it is already in the bucket.
    try database.markOutboxDone()
    return report
  }

  func open(_ objectKey: String) async throws -> Data {
    try Sealer.open(try await store.get(objectKey), objectKey: objectKey, with: key)
  }
}
