import CryptoKit
import Foundation
import GRDB
import ScreencapCore

/// Backup from the command line, for checks and recovery:
///
///   Screencap backup-once --store DIR [--endpoint URL --bucket B --region R --access-key ID]
///   Screencap restore --to DIR [same bucket options]
///   Screencap compare-stores --store SOURCE --restored COPY
///
/// The secret comes from `SCREENCAP_BACKUP_SECRET` or the Keychain, the encryption key from
/// `SCREENCAP_BACKUP_RECOVERY_KEY` (its recovery text) or the Keychain.
enum BackupCommands {
  static func client(_ option: (String) -> String?) async throws -> (S3Client, BackupKey) {
    var settings = SettingsStore().current.backup
    if let endpoint = option("--endpoint") {
      settings.provider = .other
      settings.endpoint = endpoint
    }
    if let bucket = option("--bucket") { settings.bucket = bucket }
    if let region = option("--region") { settings.region = region }
    if let access = option("--access-key") { settings.accessKeyID = access }
    let secret = ProcessInfo.processInfo.environment["SCREENCAP_BACKUP_SECRET"] ?? Keychain.readString(.backupSecretKey)
    guard let client = S3Client(settings: settings, secret: secret) else {
      throw CocoaError(.featureUnsupported, userInfo: [NSLocalizedDescriptionKey: "backup is not configured (endpoint, bucket, access key, secret)"])
    }
    if let text = ProcessInfo.processInfo.environment["SCREENCAP_BACKUP_RECOVERY_KEY"] {
      guard let key = BackupKey(recoveryText: text) else { throw CocoaError(.coderInvalidValue) }
      return (client, key)
    }
    return (client, try await BackupKeyStore.loadOrCreate(for: client))
  }

  /// Queues a day file for every UTC day with captures and a snapshot, then drains the outbox until nothing is due.
  static func backupOnce(location: StoreLocation, option: (String) -> String?) async throws {
    let database = try location.openDatabase()
    let (client, key) = try await client(option)
    let service = BackupService(database: database, location: location, store: client, key: key)
    let days = Set(try database.focusedCaptures(from: 0).map { BackupKeys.day($0.at) }).sorted()
    for day in days { try database.enqueueBackup(.rows, objectKey: BackupKeys.rows(day: day)) }
    try database.enqueueBackup(.snapshot, objectKey: BackupKeys.snapshot(week: BackupKeys.week(Date().timeIntervalSince1970)))
    var total = BackupService.DrainReport()
    while true {
      let report = try await service.drain(limit: 500)
      total.uploaded += report.uploaded
      total.deleted += report.deleted
      total.failed += report.failed
      if report.uploaded + report.deleted + report.failed == 0 || report.failed > 0 { break }
    }
    print("backup: \(days.count) day files, uploaded \(total.uploaded), deleted \(total.deleted), failed \(total.failed); outbox \(try database.backupCounts())")
  }

  static func restore(to target: StoreLocation, option: (String) -> String?) async throws {
    let (client, key) = try await client(option)
    let report = try await BackupRestore(store: client, key: key).restore(into: target)
    print(
      "restore: snapshot \(report.snapshot ?? "none"), \(report.dayFiles) day files applied, \(report.skippedDayFiles) older than the snapshot, "
        + "\(report.frames) frames, \(report.missingFrames) never uploaded, \(report.deletedCaptures) deleted captures and "
        + "\(report.deletedActivities) deleted activities dropped")
  }

  /// The restore check: every table holds the same rows, and every frame's bytes hash the same.
  static func compare(source: StoreLocation, restored: StoreLocation) throws -> Bool {
    let a = try source.openDatabase()
    let b = try restored.openDatabase()
    var ok = true
    // Frame paths are compared through the frames' bytes below; a tombstone's time is when this store learned of it.
    let ignored: [String: Set<String>] = ["capture": ["framePath", "thumbPath"], "tombstone": ["at"]]
    for table in ["capture", "captureText", "boundary", "activity", "thread", "decision", "correction", "marker", "tombstone"] {
      let left = try a.digest(of: table, ignoring: ignored[table] ?? [])
      let right = try b.digest(of: table, ignoring: ignored[table] ?? [])
      let same = left == right
      print("\(table): \(left.rows) vs \(right.rows) rows, \(same ? "identical" : "CONTENT DIFFERS")")
      ok = ok && same
    }
    var frames = 0, mismatched = 0
    for capture in try a.capturesWithFrames() {
      guard let restoredCapture = try b.capture(id: capture.id), let path = capture.framePath, let copy = restoredCapture.framePath else {
        mismatched += 1
        continue
      }
      let original = try Data(contentsOf: source.url(path))
      let restoredBytes = try Data(contentsOf: restored.url(copy))
      if SHA256.hash(data: original) != SHA256.hash(data: restoredBytes) { mismatched += 1 }
      frames += 1
    }
    print("frames: \(frames) compared, \(mismatched) mismatched")
    return ok && mismatched == 0
  }
}
