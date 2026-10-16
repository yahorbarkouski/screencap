import AppKit
import ScreencapCore

// Screencap runs as the menu-bar app with no arguments; the subcommands are for measured runs and maintenance.
//
//   Screencap [--store DIR] [--view-only]       the app; view-only shows a store without capturing into it
//   Screencap headless --minutes N [--store DIR]  capture and understand without UI, then print a report
//   Screencap replay --data DIR --store DIR [--export DIR]  run understanding over imported captures
//   Screencap backup-once [--store DIR]          drain the backup outbox once
//   Screencap restore --to DIR [--store DIR]     restore a backup into an empty store
//   Screencap understand --store DIR [--from-scratch] [--boundary-threshold P] [--decider MODEL]   run understanding over a store's captures (a copy, from scratch)
//   Screencap delete-activity --id N [--store DIR]   the inspector's Delete
//   Screencap not-this-thread --id N [--store DIR]   the inspector's "Not this thread", printing both threads' cards
//   Screencap demo-store --store DIR --pages DIR  a made-up yesterday on captured public pages, for the README's screenshots
//   Screencap probe-windows --out FILE            what the private-window scanner sees in each browser window, without titles
//   Screencap mcp [install|uninstall CLIENT|status]  the MCP server agents read the history through, and connecting them

// Writing to an OCR helper that has exited must fail with EPIPE, not end the app.
signal(SIGPIPE, SIG_IGN)
// Every file and folder Screencap creates (database, frames, exports, caches) is readable by this user alone.
umask(0o077)

let arguments = Array(CommandLine.arguments.dropFirst())
let command = arguments.first ?? "app"

func option(_ name: String) -> String? {
  guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
  return arguments[index + 1]
}

func storeLocation() -> StoreLocation {
  option("--store").map { StoreLocation(root: URL(fileURLWithPath: $0, isDirectory: true)) } ?? .standard
}

/// The inspector's corrections, with the stored OpenRouter key for the ones that ask a model.
func makeCorrections(at location: StoreLocation) throws -> (AppDatabase, Corrections) {
  let database = try location.openDatabase()
  let client = OpenRouter(key: { OpenRouter.storedKey() })
  let engine = UnderstandingEngine(
    database: database, location: location, decider: OpenRouterDecider(client: client),
    writer: OpenRouterWriter(client: client), config: UnderstandingConfig())
  return (database, Corrections(database: database, location: location, engine: engine))
}

switch command {
case "headless":
  let minutes = Double(option("--minutes") ?? "30") ?? 30
  MainActor.assumeIsolated { HeadlessRun.start(location: storeLocation(), minutes: minutes) }
  RunLoop.main.run()
case "replay":
  let data = URL(fileURLWithPath: option("--data") ?? "experiments/data", isDirectory: true)
  let export = URL(fileURLWithPath: option("--export") ?? "build/replay", isDirectory: true)
  let location = storeLocation()
  Task {
    do {
      try await ReplayCommand.run(data: data, location: location, export: export)
      exit(0)
    } catch {
      print("replay failed: \(error)")
      exit(1)
    }
  }
  RunLoop.main.run()
case "demo-store":
  Task { @MainActor in
    do {
      try await DemoCommand.run(
        location: storeLocation(), pages: URL(fileURLWithPath: option("--pages") ?? "build/pages", isDirectory: true))
      exit(0)
    } catch {
      print("demo-store failed: \(error)")
      exit(1)
    }
  }
  RunLoop.main.run()
case "understand":
  Task {
    do {
      try await UnderstandCommand.run(
        location: storeLocation(), fromScratch: arguments.contains("--from-scratch"),
        boundaryThreshold: option("--boundary-threshold").flatMap(Double.init), decider: option("--decider"))
      exit(0)
    } catch {
      print("understand failed: \(error)")
      exit(1)
    }
  }
  RunLoop.main.run()
case "day-story":
  // The Day view's headline and story for one local day (YYYY-MM-DD), written or read back from the store.
  Task {
    do {
      let location = storeLocation()
      let database = try location.openDatabase()
      let client = OpenRouter(key: { OpenRouter.storedKey() })
      let engine = UnderstandingEngine(
        database: database, location: location, decider: OpenRouterDecider(client: client), writer: OpenRouterWriter(client: client),
        config: UnderstandingConfig())
      let parts = (option("--day") ?? "").split(separator: "-").compactMap { Int($0) }
      guard parts.count == 3, let day = Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else {
        throw CocoaError(.formatting)
      }
      let start = day.timeIntervalSince1970
      let timeline = DayTimeline(activities: try database.activities(from: start, to: start + 86_400), dayStart: start, dayEnd: start + 86_400)
      let names = Dictionary(uniqueKeysWithValues: try database.allThreads().compactMap { t in t.id.map { ($0, t.name) } })
      if let story = try await engine.dayStory(for: timeline, threadNames: names) { print(story.headline) }
      exit(0)
    } catch {
      print("day-story failed: \(error)")
      exit(1)
    }
  }
  RunLoop.main.run()
case "delete-activity":
  // The inspector's Delete, from the command line: removes the activity's captures here and queues their deletion
  // from the backup.
  do {
    let (database, corrections) = try makeCorrections(at: storeLocation())
    guard let id = option("--id").flatMap(Int64.init) else { throw CocoaError(.featureUnsupported) }
    try corrections.delete(activityID: id)
    print("deleted activity \(id); outbox \(try database.backupCounts())")
    exit(0)
  } catch {
    print("delete-activity failed: \(error)")
    exit(1)
  }
case "not-this-thread":
  // Asks the thread question again without the activity's thread, moves it to the answer, and prints both threads
  // as the next thread question reads them, with the correction in their "Includes" and "Not" lines.
  Task {
    do {
      let (database, corrections) = try makeCorrections(at: storeLocation())
      guard let id = option("--id").flatMap(Int64.init), let activity = try database.activity(id: id) else {
        throw CocoaError(.featureUnsupported)
      }
      let target = try await corrections.notThisThread(activityID: id)
      print("activity \(id): \(activity.caption ?? "no caption")")
      for (label, threadID) in [("from", activity.threadID), ("to", target)] {
        guard let thread = try threadID.flatMap({ try database.thread(id: $0) }) else { continue }
        print("\(label) thread \(thread.id ?? 0): \(ThreadCard.option(thread))")
      }
      exit(0)
    } catch {
      print("not-this-thread failed: \(error)")
      exit(1)
    }
  }
  RunLoop.main.run()
case "mcp", "--mcp":
  // `--mcp` is how Screencap v1 registered itself with agent apps; once this app takes v1's place, those entries
  // start the server here instead of a second menu-bar app.
  let defaults = option("--defaults").flatMap { UserDefaults(suiteName: $0) } ?? .standard
  MCPCommand.run(arguments, location: storeLocation(), settings: SettingsStore(defaults: defaults))
case "probe-windows":
  Task { @MainActor in
    do {
      try await ProbeWindowsCommand.run(out: URL(fileURLWithPath: option("--out") ?? "probe-windows.txt"))
      exit(0)
    } catch {
      print("probe-windows failed: \(error)")
      exit(1)
    }
  }
  RunLoop.main.run()
case "backup-once", "restore", "compare-stores":
  let location = storeLocation()
  Task {
    do {
      switch command {
      case "backup-once": try await BackupCommands.backupOnce(location: location, option: option)
      case "restore":
        let target = StoreLocation(root: URL(fileURLWithPath: option("--to") ?? "build/restored", isDirectory: true))
        try await BackupCommands.restore(to: target, option: option)
      default:
        let restored = StoreLocation(root: URL(fileURLWithPath: option("--restored") ?? "build/restored", isDirectory: true))
        exit(try BackupCommands.compare(source: location, restored: restored) ? 0 : 2)
      }
      exit(0)
    } catch {
      print("\(command) failed: \(error)")
      exit(1)
    }
  }
  RunLoop.main.run()
default:
  let viewOnly = arguments.contains("--view-only")
  let snapshots = option("--snapshot").map { URL(fileURLWithPath: $0, isDirectory: true) }
  MainActor.assumeIsolated { AppMain.run(location: storeLocation(), viewOnly: viewOnly, snapshotDirectory: snapshots) }
}
