import Foundation
import ScreencapCore

/// `Screencap replay --data experiments/data --store DIR --export DIR`: runs the understanding engine over the
/// experiment's six days, one day at a time with the nightly merge between days, and writes `seg.json` and
/// `threads.json` for the experiment's scorers. Responses are cached under the store, so a rerun is free.
enum ReplayCommand {
  static func run(data: URL, location: StoreLocation, export: URL) async throws {
    let database = try location.openDatabase()
    let clock = TimeFormatter()
    let client = OpenRouter(key: { OpenRouter.storedKey() }, cache: ResponseCache(directory: location.root.appendingPathComponent("response-cache")))
    var config = UnderstandingConfig.experiment
    config.concurrency = 12
    config.clock = clock
    let engine = UnderstandingEngine(
      database: database, location: location, decider: OpenRouterDecider(client: client), writer: OpenRouterWriter(client: client),
      config: config)
    for (day, captures) in try Replay.loadExperiment(dataDirectory: data, clock: clock) {
      try Replay.insert(captures, into: database)
      let night = captures.last!.capture.at + config.hardGap + 1
      var passes = 0
      while try await engine.advance(now: night).didWork, passes < 5 { passes += 1 }
      // A resumed replay must not merge an earlier night again against threads from later days.
      var merged = 0
      if try database.meta("replay.merged.\(day)") == nil {
        merged = try await engine.mergeThreads(now: night)
        try database.setMeta("replay.merged.\(day)", "\(merged)")
      }
      let threads = try database.liveThreads(now: night).count
      print("\(day): \(captures.count) captures, \(passes) passes, merged \(merged), live threads \(threads)")
    }
    try FileManager.default.createDirectory(at: export, withIntermediateDirectories: true)
    try Replay.segmentationJSON(try Replay.exportSegmentation(database, clock: clock)).data
      .write(to: export.appendingPathComponent("seg.json"))
    try Replay.exportThreads(database, clock: clock).data.write(to: export.appendingPathComponent("threads.json"))
    let totals = try await database.reader.read { db in
      try String.fetchAll(
        db, sql: "SELECT kind || ' ' || COUNT(*) || ' calls $' || printf('%.4f', SUM(costUSD)) FROM decision GROUP BY kind")
    }
    print("decisions: \(totals.joined(separator: "; "))")
    print("wrote \(export.path)/seg.json and threads.json")
  }
}
