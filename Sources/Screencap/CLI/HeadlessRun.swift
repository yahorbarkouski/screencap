import AppKit
import GRDB
import ScreencapCore

/// Runs capture (and understanding, when a key is present) for a fixed time without UI, then prints a report with
/// the step-1 acceptance numbers: capture counts, OCR coverage, markers, CPU and memory.
@MainActor
enum HeadlessRun {
  static var engine: CaptureEngine?
  static var understanding: UnderstandingDriver?

  static func start(location: StoreLocation, minutes: Double) {
    do {
      let database = try location.openDatabase()
      let settings = SettingsStore()
      let engine = CaptureEngine(location: location, database: database, settings: settings, ocrHelper: Helpers.ocr)
      let startedAt = Date()
      let usageAtStart = ResourceUsage.now()
      let driver = UnderstandingDriver.makeIfConfigured(database: database, location: location, settings: settings)
      engine.onEvidence = { driver?.poke() }
      engine.start()
      driver?.start()
      Self.engine = engine
      Self.understanding = driver
      print("headless: capturing for \(minutes) min into \(location.root.path); understanding \(driver == nil ? "off (no key)" : "on")")
      Timer.scheduledTimer(withTimeInterval: minutes * 60, repeats: false) { _ in
        MainActor.assumeIsolated {
          engine.runOCR()
          Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { _ in
            Task { @MainActor in
              await engine.stopOCRHelper()
              engine.stop()
              report(database: database, location: location, since: startedAt, usageAtStart: usageAtStart)
              exit(0)
            }
          }
        }
      }
    } catch {
      print("headless: \(error)")
      exit(1)
    }
  }

  static func report(database: AppDatabase, location: StoreLocation, since: Date, usageAtStart: ResourceUsage) {
    let start = since.timeIntervalSince1970
    let elapsed = Date().timeIntervalSince(since)
    let usage = ResourceUsage.now() - usageAtStart
    do {
      let stats = try database.reader.read { db -> Row? in
        try Row.fetchOne(
          db,
          sql: """
            SELECT COUNT(*) AS captures,
              SUM(duplicateOf IS NOT NULL) AS duplicates,
              SUM(framePath IS NOT NULL) AS kept,
              SUM(ocrState = 'done') AS ocrDone,
              SUM(ocrState = 'pending') AS ocrPending,
              SUM(ocrState = 'failed') AS ocrFailed,
              SUM(ocrState = 'skipped') AS ocrSkipped,
              SUM(trigger = 'switch') AS switches,
              SUM(isFocusedDisplay) AS focused,
              SUM(isFocusedDisplay AND isAnchor) AS anchors
            FROM capture WHERE at >= ?
            """, arguments: [start])
      }
      let triggers = try database.reader.read { db in
        try Row.fetchAll(db, sql: "SELECT trigger, COUNT(*) AS n FROM capture WHERE at >= ? GROUP BY trigger ORDER BY n DESC", arguments: [start])
          .map { "\($0["trigger"] as String)=\($0["n"] as Int)" }
      }
      let markers = try database.reader.read { db in
        try Row.fetchAll(db, sql: "SELECT kind, COUNT(*) AS n FROM marker WHERE at >= ? GROUP BY kind", arguments: [start])
          .map { "\($0["kind"] as String)=\($0["n"] as Int)" }
      }
      let bytes = try database.reader.read { db in
        try String.fetchAll(db, sql: "SELECT framePath FROM capture WHERE at >= ? AND framePath IS NOT NULL", arguments: [start])
      }.reduce(0) { total, path in
        let frame = (try? FileManager.default.attributesOfItem(atPath: location.url(path).path)[.size] as? Int) ?? 0
        let thumb = (try? FileManager.default.attributesOfItem(atPath: location.url(path.replacingOccurrences(of: "Frames/", with: "Thumbs/")).path)[.size] as? Int) ?? 0
        return total + frame + thumb
      }
      let kept = stats?["kept"] as Int? ?? 0
      print("--- headless report ---")
      print("elapsed: \(Int(elapsed)) s")
      print("captures: \(stats?["captures"] as Int? ?? 0) (switch \(stats?["switches"] as Int? ?? 0), focused \(stats?["focused"] as Int? ?? 0)), kept \(kept), duplicates \(stats?["duplicates"] as Int? ?? 0)")
      print("by trigger: \(triggers.joined(separator: ", ")); anchors (focused, get a boundary question) \(stats?["anchors"] as Int? ?? 0)")
      print("ocr: done \(stats?["ocrDone"] as Int? ?? 0), pending \(stats?["ocrPending"] as Int? ?? 0), failed \(stats?["ocrFailed"] as Int? ?? 0), kept as pictures \(stats?["ocrSkipped"] as Int? ?? 0)")
      print("markers: \(markers.joined(separator: ", "))")
      print(String(format: "disk per kept frame (frame + thumbnail): %.0f KB", kept > 0 ? Double(bytes) / Double(kept) / 1024 : 0))
      print(String(format: "cpu: app %.2f%% of one core, OCR helper %.2f%%, total %.2f%%",
        usage.selfCPU / elapsed * 100, usage.childCPU / elapsed * 100, (usage.selfCPU + usage.childCPU) / elapsed * 100))
      print(String(format: "memory: footprint now %.1f MB (Activity Monitor's figure), resident now %.1f MB, peak resident %.1f MB", ResourceUsage.footprintMB(), ResourceUsage.residentMB(), usage.peakResidentMB))
      let cost = try database.reader.read { db in
        try Double.fetchOne(db, sql: "SELECT COALESCE(SUM(costUSD), 0) FROM decision WHERE createdAt >= ?", arguments: [start]) ?? 0
      }
      print(String(format: "model cost: $%.4f", cost))
    } catch {
      print("report failed: \(error)")
    }
  }
}

/// CPU seconds of this process and of its finished children (the OCR helper), and peak memory.
struct ResourceUsage {
  var selfCPU: Double
  var childCPU: Double
  var peakResidentMB: Double

  static func now() -> ResourceUsage {
    var own = rusage()
    var children = rusage()
    getrusage(RUSAGE_SELF, &own)
    getrusage(RUSAGE_CHILDREN, &children)
    func seconds(_ u: rusage) -> Double {
      Double(u.ru_utime.tv_sec + u.ru_stime.tv_sec) + Double(u.ru_utime.tv_usec + u.ru_stime.tv_usec) / 1e6
    }
    return ResourceUsage(selfCPU: seconds(own), childCPU: seconds(children), peakResidentMB: Double(own.ru_maxrss) / 1_048_576)
  }

  static func - (a: ResourceUsage, b: ResourceUsage) -> ResourceUsage {
    ResourceUsage(selfCPU: a.selfCPU - b.selfCPU, childCPU: a.childCPU - b.childCPU, peakResidentMB: a.peakResidentMB)
  }

  /// Physical footprint: private memory the process is charged for, without shared framework pages.
  static func footprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
  }

  static func residentMB() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count) }
    }
    return result == KERN_SUCCESS ? Double(info.resident_size) / 1_048_576 : 0
  }
}

enum Helpers {
  /// The OCR helper inside the app bundle, or next to the executable in a development build.
  static var ocr: URL {
    let bundled = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/screencap-ocr")
    if FileManager.default.isExecutableFile(atPath: bundled.path) { return bundled }
    return Bundle.main.executableURL!.deletingLastPathComponent().appendingPathComponent("screencap-ocr")
  }
}
