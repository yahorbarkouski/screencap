import Accelerate
import Foundation
import SQLite3

// Local store benchmark on SYNTHETIC data. Usage: store <dbPath>
// 1. SQLite (system libsqlite3, WAL) + FTS5: insert N OCR-sized docs, then MATCH query latency.
// 2. In-memory brute-force vector search (Accelerate sgemv) at personal scale.

var rng = SystemRandomNumberGenerator()
let vocab: [String] = (0..<20000).map { i in
  let letters = Array("abcdefghijklmnopqrstuvwxyz")
  var s = ""
  var x = i &* 2654435761
  for _ in 0..<(3 + i % 7) { s.append(letters[abs(x) % 26]); x = x &* 1103515245 &+ 12345 }
  return s
}

func doc(words: Int) -> String {
  // Zipf-ish: square the uniform to favour common words.
  (0..<words).map { _ in
    let u = Double.random(in: 0..<1, using: &rng)
    return vocab[Int(u * u * Double(vocab.count))]
  }.joined(separator: " ")
}

func exec(_ db: OpaquePointer?, _ sql: String) {
  var err: UnsafeMutablePointer<CChar>?
  if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK { print("SQL error: \(String(cString: err!)) in \(sql)") }
}

@main struct StoreBench {
  static func main() {
    let path = CommandLine.arguments[1]
    try? FileManager.default.removeItem(atPath: path)
    var db: OpaquePointer?
    sqlite3_open(path, &db)
    exec(db, "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
    exec(db, """
      CREATE TABLE capture(id INTEGER PRIMARY KEY, ts INTEGER, app TEXT, title TEXT, url TEXT, ocr TEXT);
      CREATE VIRTUAL TABLE capture_fts USING fts5(title, url, ocr, content='capture', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      """)
    let n = 100_000  // ~1 year at ~300 captures/day
    var stmt: OpaquePointer?
    sqlite3_prepare_v2(db, "INSERT INTO capture(ts, app, title, url, ocr) VALUES(?,?,?,?,?)", -1, &stmt, nil)
    var fts: OpaquePointer?
    sqlite3_prepare_v2(db, "INSERT INTO capture_fts(rowid, title, url, ocr) VALUES(?,?,?,?)", -1, &fts, nil)
    let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    let t0 = DispatchTime.now().uptimeNanoseconds
    var single: [Double] = []
    exec(db, "BEGIN")
    for i in 0..<n {
      let ts0 = DispatchTime.now().uptimeNanoseconds
      let title = doc(words: 6)
      let url = "https://example.com/" + doc(words: 2).replacingOccurrences(of: " ", with: "/")
      let ocr = doc(words: 220)  // ~1.5 KB of OCR text per capture
      sqlite3_bind_int64(stmt, 1, Int64(i))
      sqlite3_bind_text(stmt, 2, "App\(i % 30)", -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(stmt, 3, title, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(stmt, 4, url, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(stmt, 5, ocr, -1, SQLITE_TRANSIENT)
      sqlite3_step(stmt); sqlite3_reset(stmt)
      sqlite3_bind_int64(fts, 1, sqlite3_last_insert_rowid(db))
      sqlite3_bind_text(fts, 2, title, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(fts, 3, url, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(fts, 4, ocr, -1, SQLITE_TRANSIENT)
      sqlite3_step(fts); sqlite3_reset(fts)
      if i % 1000 == 999 { exec(db, "COMMIT"); exec(db, "BEGIN") }
      if i >= n - 200 { single.append(Double(DispatchTime.now().uptimeNanoseconds - ts0) / 1000) }
    }
    exec(db, "COMMIT")
    let insertMs = ms(DispatchTime.now().uptimeNanoseconds - t0)
    exec(db, "PRAGMA wal_checkpoint(TRUNCATE)")
    let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
    print("inserted \(n) captures (+FTS5) in \(fmt(insertMs / 1000, 1)) s (\(fmt(insertMs * 1000 / Double(n), 0)) us each incl. text generation); db \(size / 1_048_576) MB")
    // Single-row commit cost (what the app does per capture).
    var commitUs: [Double] = []
    for i in 0..<50 {
      let t = DispatchTime.now().uptimeNanoseconds
      exec(db, "BEGIN")
      sqlite3_bind_int64(stmt, 1, Int64(n + i)); sqlite3_bind_text(stmt, 2, "App", -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(stmt, 3, "t", -1, SQLITE_TRANSIENT); sqlite3_bind_text(stmt, 4, "u", -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(stmt, 5, doc(words: 220), -1, SQLITE_TRANSIENT)
      sqlite3_step(stmt); sqlite3_reset(stmt)
      exec(db, "COMMIT")
      commitUs.append(Double(DispatchTime.now().uptimeNanoseconds - t) / 1000)
    }
    print("single capture row commit (WAL, synchronous=NORMAL): median \(fmt(Stats(values: commitUs).median, 0)) us")
    for q in [vocab[50], "\(vocab[200]) \(vocab[3000])", "\"\(vocab[10]) \(vocab[11])\"", "\(vocab[15000])*"] {
      var qs: OpaquePointer?
      sqlite3_prepare_v2(db, "SELECT rowid FROM capture_fts WHERE capture_fts MATCH ? ORDER BY rank LIMIT 20", -1, &qs, nil)
      var times: [Double] = []
      var rows = 0
      for _ in 0..<5 {
        let t = DispatchTime.now().uptimeNanoseconds
        sqlite3_bind_text(qs, 1, q, -1, SQLITE_TRANSIENT)
        rows = 0
        while sqlite3_step(qs) == SQLITE_ROW { rows += 1 }
        sqlite3_reset(qs)
        times.append(ms(DispatchTime.now().uptimeNanoseconds - t))
      }
      print("FTS5 MATCH '\(q)' top-20 by bm25: median \(fmt(Stats(values: times).median, 2)) ms (\(rows) rows)")
      sqlite3_finalize(qs)
    }
    sqlite3_close(db)

    // Vector search.
    for (count, dim) in [(10_000, 512), (100_000, 512), (100_000, 768)] {
      var m = [Float](repeating: 0, count: count * dim)
      for i in 0..<m.count { m[i] = Float.random(in: -1...1, using: &rng) }
      var q = [Float](repeating: 0, count: dim)
      for i in 0..<dim { q[i] = Float.random(in: -1...1, using: &rng) }
      var scores = [Float](repeating: 0, count: count)
      var times: [Double] = []
      for _ in 0..<10 {
        let t = DispatchTime.now().uptimeNanoseconds
        cblas_sgemv(CblasRowMajor, CblasNoTrans, Int32(count), Int32(dim), 1, m, Int32(dim), q, 1, 0, &scores, 1)
        var best = [(Float, Int)]()
        best.reserveCapacity(10)
        for i in 0..<count where best.count < 10 || scores[i] > best.last!.0 {
          best.append((scores[i], i)); best.sort { $0.0 > $1.0 }; if best.count > 10 { best.removeLast() }
        }
        times.append(ms(DispatchTime.now().uptimeNanoseconds - t))
      }
      print("brute-force cosine top-10 over \(count) x \(dim) float32 (\(count * dim * 4 / 1_048_576) MB): median \(fmt(Stats(values: times).median, 2)) ms")
    }
  }
}
