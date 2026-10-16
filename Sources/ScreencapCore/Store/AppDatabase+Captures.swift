import Foundation
import GRDB

extension AppDatabase {
  /// Writes a capture and its search row. The search body is filled when OCR arrives.
  public func insert(_ capture: Capture) throws {
    try writer.write { db in
      try capture.insert(db)
      try db.execute(
        sql: "INSERT INTO captureSearch (rowid, captureID, title, host, body) VALUES ((SELECT rowid FROM capture WHERE id = ?), ?, ?, ?, '')",
        arguments: [capture.id, capture.id, capture.context.windowTitle ?? "", capture.context.urlHost ?? ""])
    }
  }

  public func insert(_ marker: Marker) throws {
    var marker = marker
    try writer.write { db in try marker.insert(db) }
  }

  public func capture(id: String) throws -> Capture? {
    try reader.read { db in try Capture.fetchOne(db, key: id) }
  }

  public func captures(ids: [String]) throws -> [Capture] {
    try reader.read { db in try Capture.fetchAll(db, keys: ids) }.sorted { $0.at < $1.at }
  }

  /// Kept frames still waiting for OCR, oldest first.
  public func capturesAwaitingOCR(limit: Int) throws -> [Capture] {
    try reader.read { db in
      try Capture.fetchAll(
        db,
        sql: "SELECT * FROM capture WHERE ocrState = ? AND framePath IS NOT NULL ORDER BY at LIMIT ?",
        arguments: [OCRState.pending.rawValue, limit])
    }
  }

  /// Stores a frame's text with secrets masked (`SecretScrubber`), for search, prompts and agents alike.
  public func saveOCR(captureID: String, lines: [OCRLine], milliseconds: Int) throws {
    let lines = lines.map { line in
      var line = line
      line.text = SecretScrubber.scrub(line.text).text
      return line
    }
    let body = lines.map(\.text).joined(separator: " ")
    let json = String(decoding: try JSONEncoder().encode(lines), as: UTF8.self)
    try writer.write { db in
      try db.execute(
        sql: "INSERT OR REPLACE INTO captureText (captureID, lines, ocrMS) VALUES (?, ?, ?)",
        arguments: [captureID, json, milliseconds])
      try db.execute(
        sql: "UPDATE capture SET ocrState = ? WHERE id = ?", arguments: [OCRState.done.rawValue, captureID])
      try db.execute(
        sql: "UPDATE captureSearch SET body = ? WHERE rowid = (SELECT rowid FROM capture WHERE id = ?)",
        arguments: [body, captureID])
    }
  }

  /// Masks secrets in what builds before `SecretScrubber` stored: screen text and its search copy, window titles
  /// and page paths. Runs once per store, in batches; returns how many captures changed.
  @discardableResult
  public func scrubStoredSecrets() throws -> Int {
    guard try meta("secrets.scrubbed") == nil else { return 0 }
    var changed = 0
    var after: Int64 = 0
    while true {
      let rows = try reader.read { db in
        try Row.fetchAll(db, sql: "SELECT rowid, captureID, lines FROM captureText WHERE rowid > ? ORDER BY rowid LIMIT 500", arguments: [after])
      }
      guard let last = rows.last else { break }
      after = last["rowid"]
      for row in rows {
        let id: String = row["captureID"]
        let json: String = row["lines"]
        guard var lines = try? JSONDecoder().decode([OCRLine].self, from: Data(json.utf8)) else { continue }
        var found = false
        for index in lines.indices {
          let result = SecretScrubber.scrub(lines[index].text)
          if result.found {
            lines[index].text = result.text
            found = true
          }
        }
        guard found else { continue }
        let scrubbed = String(decoding: try JSONEncoder().encode(lines), as: UTF8.self)
        try writer.write { db in
          try db.execute(sql: "UPDATE captureText SET lines = ? WHERE captureID = ?", arguments: [scrubbed, id])
          try db.execute(
            sql: "UPDATE captureSearch SET body = ? WHERE rowid = (SELECT rowid FROM capture WHERE id = ?)",
            arguments: [lines.map(\.text).joined(separator: " "), id])
        }
        changed += 1
      }
    }
    let contexts = try reader.read { db in
      try Row.fetchAll(db, sql: "SELECT id, windowTitle, urlPath FROM capture WHERE windowTitle IS NOT NULL OR urlPath IS NOT NULL")
    }
    for row in contexts {
      let title: String? = row["windowTitle"]
      let path: String? = row["urlPath"]
      let scrubbedTitle = title.map { SecretScrubber.scrub($0) }
      let scrubbedPath = path.map { SecretScrubber.scrub($0) }
      guard scrubbedTitle?.found == true || scrubbedPath?.found == true else { continue }
      let id: String = row["id"]
      try writer.write { db in
        try db.execute(
          sql: "UPDATE capture SET windowTitle = ?, urlPath = ? WHERE id = ?", arguments: [scrubbedTitle?.text, scrubbedPath?.text, id])
        try db.execute(
          sql: "UPDATE captureSearch SET title = ? WHERE rowid = (SELECT rowid FROM capture WHERE id = ?)",
          arguments: [scrubbedTitle?.text ?? "", id])
      }
      changed += 1
    }
    try setMeta("secrets.scrubbed", "1")
    return changed
  }

  public func markOCRFailed(captureID: String) throws {
    try writer.write { db in
      try db.execute(
        sql: "UPDATE capture SET ocrState = ? WHERE id = ?", arguments: [OCRState.failed.rawValue, captureID])
    }
  }

  /// OCR lines of a capture, following a duplicate to the frame it repeats.
  public func ocrLines(captureID: String) throws -> [OCRLine] {
    try reader.read { db in try Self.ocrLines(db, captureID: captureID) }
  }

  static func ocrLines(_ db: Database, captureID: String) throws -> [OCRLine] {
    let source =
      try String.fetchOne(db, sql: "SELECT COALESCE(duplicateOf, id) FROM capture WHERE id = ?", arguments: [captureID])
      ?? captureID
    guard let json = try String.fetchOne(db, sql: "SELECT lines FROM captureText WHERE captureID = ?", arguments: [source])
    else { return [] }
    return (try? JSONDecoder().decode([OCRLine].self, from: Data(json.utf8))) ?? []
  }

  /// The most recent kept frame on a display, used to recognise duplicates after a restart.
  public func lastKeptCapture(displayID: UInt32) throws -> Capture? {
    try reader.read { db in
      try Capture.fetchOne(
        db,
        sql: "SELECT * FROM capture WHERE displayID = ? AND framePath IS NOT NULL ORDER BY at DESC LIMIT 1",
        arguments: [Int64(displayID)])
    }
  }

  public func markers(from start: Double, to end: Double) throws -> [Marker] {
    try reader.read { db in
      try Marker.fetchAll(
        db, sql: "SELECT * FROM marker WHERE at > ? AND at <= ? ORDER BY at", arguments: [start, end])
    }
  }

  public func latestMarker(before at: Double) throws -> Marker? {
    try reader.read { db in
      try Marker.fetchOne(db, sql: "SELECT * FROM marker WHERE at <= ? ORDER BY at DESC LIMIT 1", arguments: [at])
    }
  }

  public func meta(_ key: String) throws -> String? {
    try reader.read { db in try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = ?", arguments: [key]) }
  }

  public func setMeta(_ key: String, _ value: String) throws {
    try writer.write { db in
      try db.execute(sql: "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", arguments: [key, value])
    }
  }
}

/// One search result: a capture and its rank (lower is better, bm25).
public struct SearchHit: Sendable, Hashable {
  public var captureID: String
  public var rank: Double
}

extension AppDatabase {
  /// Full-text search over window titles, hosts and OCR text; every word must match as a prefix.
  public func search(_ query: String, limit: Int = 200) throws -> [SearchHit] {
    guard let pattern = FTS5Pattern(matchingAllPrefixesIn: query) else { return [] }
    return try reader.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT captureID, bm25(captureSearch, 0, 4.0, 2.0, 1.0) AS rank FROM captureSearch
          WHERE captureSearch MATCH ? ORDER BY rank LIMIT ?
          """,
        arguments: [pattern, limit]
      ).map { SearchHit(captureID: $0["captureID"], rank: $0["rank"]) }
    }
  }
}
