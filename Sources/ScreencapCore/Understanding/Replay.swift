import Foundation
import GRDB

/// Runs the understanding engine over the experiment's captured days and writes its answers in the formats that
/// the design experiments' `seg_eval.py` and `thread_eval.py` score, so the app's pipeline is checked against the
/// gold. The days are the author's own captures, so they and the scorers stay private.
public enum Replay {
  struct ExperimentCapture: Decodable {
    let id: String
    let ts: Double
    let app: String?
    let bundle: String?
    let title: String?
    let host: String?
    let url: String?
  }

  struct ExperimentOCR: Decodable {
    struct Line: Decodable {
      let t: String
      let x: Double
      let y: Double
      let w: Double
      let h: Double
    }
    let id: String
    let lines: [Line]
  }

  /// One experiment capture with its OCR lines.
  public struct DayCapture: Sendable {
    public let capture: Capture
    public let lines: [OCRLine]
  }

  /// Reads `captures.jsonl` and `ocr.jsonl` from the experiment's data folder, with the 1024 px JPEGs as frames, and
  /// groups the captures by local day, oldest first.
  public static func loadExperiment(dataDirectory: URL, clock: TimeFormatter) throws -> [(day: String, captures: [DayCapture])] {
    let decoder = JSONDecoder()
    let ocr = try String(contentsOf: dataDirectory.appendingPathComponent("ocr.jsonl"), encoding: .utf8)
      .split(separator: "\n").map { try decoder.decode(ExperimentOCR.self, from: Data($0.utf8)) }
    let linesByID = Dictionary(uniqueKeysWithValues: ocr.map { ($0.id, $0.lines) })
    let records = try String(contentsOf: dataDirectory.appendingPathComponent("captures.jsonl"), encoding: .utf8)
      .split(separator: "\n").map { try decoder.decode(ExperimentCapture.self, from: Data($0.utf8)) }
    let captures = records.map { record -> DayCapture in
      let path = URL(string: record.url ?? "").map { $0.path() }
      let capture = Capture(
        id: record.id, at: record.ts / 1000, trigger: .replay, displayID: 1, isFocusedDisplay: true,
        context: ForegroundContext(
          bundleID: record.bundle, appName: record.app, windowTitle: record.title, urlHost: record.host,
          urlPath: (path?.isEmpty ?? true) ? nil : path),
        framePath: dataDirectory.appendingPathComponent("img/1024/\(record.id).jpg").path,
        thumbPath: dataDirectory.appendingPathComponent("img/512/\(record.id).jpg").path,
        pixelWidth: 1024, pixelHeight: 662, dHash: 0, duplicateOf: nil, ocrState: .pending)
      let lines = (linesByID[record.id] ?? []).map { OCRLine(text: $0.t, x: $0.x, y: $0.y, width: $0.w, height: $0.h) }
      return DayCapture(capture: capture, lines: lines)
    }
    let grouped = Dictionary(grouping: captures) { clock.day($0.capture.at) }
    return grouped.keys.sorted().map { ($0, grouped[$0]!.sorted { $0.capture.at < $1.capture.at }) }
  }

  /// Writes a day's captures and their text, skipping captures already in the store.
  public static func insert(_ captures: [DayCapture], into database: AppDatabase) throws {
    for item in captures where try database.capture(id: item.capture.id) == nil {
      try database.insert(item.capture)
      try database.saveOCR(captureID: item.capture.id, lines: item.lines, milliseconds: 0)
    }
  }

  /// Boundary answers per local day, in `seg.py`'s shape: one value per capture, `nil` at a day's first capture and
  /// after a hard break, otherwise 0 at a boundary and 1 inside an activity.
  public static func exportSegmentation(_ database: AppDatabase, clock: TimeFormatter) throws -> [String: [Double?]] {
    let captures = try database.focusedCaptures(from: 0)
    let boundaries = try database.boundaries(rightCaptureIDs: captures.map(\.id))
    var out: [String: [Double?]] = [:]
    for capture in captures {
      let day = clock.day(capture.at)
      var values = out[day] ?? []
      if values.isEmpty {
        values.append(nil)
      } else if let boundary = boundaries[capture.id], boundary.source != .hardBreak {
        values.append(boundary.isBoundary ? 0 : 1)
      } else {
        values.append(nil)
      }
      out[day] = values
    }
    return out
  }

  /// Thread answers in `thread.py`'s shape: `assign` maps "<day>@<index of the activity's first capture>" to a
  /// thread id; an activity that crosses midnight is also listed at index 0 of the next day.
  public static func exportThreads(_ database: AppDatabase, clock: TimeFormatter) throws -> JSONValue {
    let captures = try database.focusedCaptures(from: 0)
    var indexInDay: [String: (String, Int)] = [:]
    var counters: [String: Int] = [:]
    for capture in captures {
      let day = clock.day(capture.at)
      indexInDay[capture.id] = (day, counters[day, default: 0])
      counters[day, default: 0] += 1
    }
    let activities = try database.reader.read { db in try Activity.fetchAll(db, sql: "SELECT * FROM activity ORDER BY startAt") }
    var assign: [(String, JSONValue)] = []
    var members: [Int64: [String]] = [:]
    var seenDayStarts = Set<String>()
    for activity in activities {
      guard let threadID = activity.threadID, let (day, index) = indexInDay[activity.firstCaptureID] else { continue }
      let key = "\(day)@\(index)"
      assign.append((key, .string("t\(threadID)")))
      members[threadID, default: []].append(key)
      if index == 0 { seenDayStarts.insert(day) }
      if let (lastDay, _) = indexInDay[activity.lastCaptureID], lastDay != day, !seenDayStarts.contains(lastDay) {
        assign.append(("\(lastDay)@0", .string("t\(threadID)")))
        seenDayStarts.insert(lastDay)
      }
    }
    let threads = try database.allThreads().map { thread -> JSONValue in
      .object([
        ("id", .string("t\(thread.id ?? 0)")), ("name", .string(thread.name)), ("description", .string(thread.summary)),
        ("category", .string(thread.category.rawValue)),
        ("members", .array((members[thread.id ?? 0] ?? []).map { .string($0) })),
        ("captions", .array(thread.captions.map { .string($0) })),
      ])
    }
    let cost = try database.reader.read { db in try Double.fetchOne(db, sql: "SELECT COALESCE(SUM(costUSD), 0) FROM decision") ?? 0 }
    return .object([("assign", .object(assign)), ("threads", .array(threads)), ("cost", .number((cost * 10_000).rounded() / 10_000))])
  }

  public static func segmentationJSON(_ values: [String: [Double?]]) -> JSONValue {
    .object(values.keys.sorted().map { day in (day, .array(values[day]!.map { $0.map { .number($0) } ?? .null })) })
  }
}
