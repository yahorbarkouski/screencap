import Foundation
import Observation
import ScreencapCore

/// Runs the backup in the app when it is turned on: every minute it queues what is due (once a day the last week's
/// day files, once a week a snapshot) and drains the outbox.
@MainActor
@Observable
final class BackupDriver {
  let database: AppDatabase
  let location: StoreLocation
  let settings: SettingsStore
  @ObservationIgnored private var timer: Timer?
  @ObservationIgnored private var isRunning = false
  /// Loaded once; a failure to load it stops the backup instead of sealing with a new key.
  @ObservationIgnored private var key: BackupKey?
  private(set) var lastError: String?
  /// When a run last finished with nothing left to upload.
  private(set) var lastBackup: Date?

  init(database: AppDatabase, location: StoreLocation, settings: SettingsStore) {
    self.database = database
    self.location = location
    self.settings = settings
    timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    timer?.tolerance = 15
  }

  func tick() {
    let backup = settings.current.backup
    guard backup.isEnabled, !isRunning, let client = S3Client(settings: backup, secret: Keychain.readString(.backupSecretKey)) else { return }
    isRunning = true
    Task {
      defer { isRunning = false }
      do {
        let key: BackupKey
        if let loaded = self.key {
          key = loaded
        } else {
          key = try await BackupKeyStore.loadOrCreate(for: client)
          self.key = key
        }
        let service = BackupService(database: database, location: location, store: client, key: key)
        try await service.scheduleNightly()
        let report = try await service.drain()
        if report.failed == 0 {
          lastError = nil
          lastBackup = Date()
        } else {
          lastError = "\(report.failed) uploads failed; they are retried later"
        }
      } catch {
        lastError = String(describing: error)
        Log.backup.error("backup failed: \(String(describing: error), privacy: .private)")
      }
    }
  }

  /// Lists the bucket with the saved settings and secret, for the check in Settings: it proves the endpoint, the
  /// region, the bucket and the keys without writing anything.
  static func check(_ backup: BackupSettings) async -> String {
    guard backup.endpointURL != nil else { return "The endpoint must start with https://." }
    guard let client = S3Client(settings: backup, secret: Keychain.readString(.backupSecretKey)) else {
      return "Fill in the bucket and both keys first."
    }
    do {
      return try await client.contains(prefix: "f1/")
        ? "Connected. The bucket holds a backup, so this Mac needs its recovery key."
        : "Connected. The bucket is empty and ready."
    } catch {
      return "Could not reach the bucket: \(error)"
    }
  }
}
