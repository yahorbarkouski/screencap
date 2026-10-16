import Foundation
import Testing

@testable import ScreencapCore

@Test func databaseOpensWithSchema() throws {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  let db = try AppDatabase(path: dir.appendingPathComponent("t.sqlite").path)
  let tables = try db.reader.read { try String.fetchAll($0, sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") }
  #expect(tables.contains("capture"))
  #expect(tables.contains("thread"))
}
