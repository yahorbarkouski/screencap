import Foundation
import Observation
import ScreencapCore

/// Runs understanding passes in the app: after new evidence, every two minutes (so an activity closes when nobody
/// comes back), and the thread merge once a night.
@MainActor
@Observable
final class UnderstandingDriver {
  let engine: UnderstandingEngine
  let database: AppDatabase
  /// Called on the main actor after a pass that changed something.
  @ObservationIgnored var onChange: (() -> Void)?
  @ObservationIgnored private var isRunning = false
  @ObservationIgnored private var needsAnotherPass = false
  @ObservationIgnored private var timer: Timer?
  private(set) var lastError: String?

  init(engine: UnderstandingEngine, database: AppDatabase) {
    self.engine = engine
    self.database = database
  }

  /// Starts the periodic passes and runs one now.
  func start() {
    timer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.poke() }
    }
    timer?.tolerance = 20
    poke()
  }

  /// A driver when an OpenRouter key is available (Keychain, or the environment for command-line runs).
  static func makeIfConfigured(database: AppDatabase, location: StoreLocation, settings: SettingsStore) -> UnderstandingDriver? {
    guard OpenRouter.storedKey() != nil else { return nil }
    return make(database: database, location: location, settings: settings)
  }

  static func make(database: AppDatabase, location: StoreLocation, settings: SettingsStore) -> UnderstandingDriver {
    let client = OpenRouter(key: { OpenRouter.storedKey() })
    var config = UnderstandingConfig()
    config.cadence = settings.current.captureInterval
    config.textOnly = settings.current.textOnlyMode
    let engine = UnderstandingEngine(
      database: database, location: location, decider: OpenRouterDecider(client: client), writer: OpenRouterWriter(client: client),
      config: config)
    return UnderstandingDriver(engine: engine, database: database)
  }

  func poke() {
    guard OpenRouter.storedKey() != nil else {
      lastError = "Add an OpenRouter key in Settings to turn on understanding."
      return
    }
    if isRunning {
      needsAnotherPass = true
      return
    }
    isRunning = true
    Task {
      var changed = false
      repeat {
        needsAnotherPass = false
        do {
          let report = try await engine.advance(now: Date().timeIntervalSince1970)
          changed = changed || report.didWork
          if try await mergeIfDue() { changed = true }
          lastError = nil
        } catch {
          lastError = String(describing: error)
          Log.understanding.error("understanding pass failed: \(String(describing: error), privacy: .private)")
        }
      } while needsAnotherPass
      isRunning = false
      if changed { onChange?() }
    }
  }

  /// Once per calendar day, after 4:00 local time.
  private func mergeIfDue() async throws -> Bool {
    let now = Date()
    let today = TimeFormatter().day(now.timeIntervalSince1970)
    guard Calendar.current.component(.hour, from: now) >= 4, try database.meta("lastMergeDay") != today else { return false }
    let absorbed = try await engine.mergeThreads(now: now.timeIntervalSince1970)
    try database.setMeta("lastMergeDay", today)
    return absorbed > 0
  }
}
