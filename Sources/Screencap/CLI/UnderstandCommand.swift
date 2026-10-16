import Foundation
import ScreencapCore

/// `Screencap understand --store DIR [--from-scratch]`: runs the understanding engine over a store's captures until
/// nothing is left to ask, as the app does, with responses cached under the store so an unchanged question costs
/// nothing the second time. `--from-scratch` first clears boundaries, activities, threads and decisions, to measure a
/// changed engine on captures already labelled; it refuses the app's own store. `--boundary-threshold` replaces the
/// app's boundary threshold and `--decider` the decision model, to compare settings on the same captures.
enum UnderstandCommand {
  static func run(location: StoreLocation, fromScratch: Bool, boundaryThreshold: Double? = nil, decider: String? = nil) async throws {
    if fromScratch, location.root.standardizedFileURL.path == StoreLocation.standard.root.standardizedFileURL.path {
      throw CocoaError(.fileWriteNoPermission, userInfo: [NSLocalizedDescriptionKey: "--from-scratch runs on a copy of a store, never the app's own"])
    }
    let database = try location.openDatabase()
    if fromScratch { try database.clearUnderstanding() }
    let client = OpenRouter(
      key: { OpenRouter.storedKey() }, cache: ResponseCache(directory: location.root.appendingPathComponent("response-cache")))
    var config = UnderstandingConfig()
    config.concurrency = 12
    if let boundaryThreshold { config.boundaryThreshold = boundaryThreshold }
    let engine = UnderstandingEngine(
      database: database, location: location, decider: OpenRouterDecider(client: client, model: decider ?? OpenRouter.decider), writer: OpenRouterWriter(client: client),
      config: config)
    let now = Date().timeIntervalSince1970
    var passes = 0
    while try await engine.advance(now: now).didWork, passes < 20 { passes += 1 }
    let totals = try await database.reader.read { db in
      try String.fetchAll(
        db, sql: "SELECT kind || ' ' || COUNT(*) || ' calls $' || printf('%.4f', SUM(costUSD)) FROM decision GROUP BY kind")
    }
    print("understand: \(passes) passes; " + totals.joined(separator: "; "))
  }
}
