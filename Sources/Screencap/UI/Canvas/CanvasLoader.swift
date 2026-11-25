import Foundation
import ScreencapCore

/// Reads days for the canvas off the main thread. What the history says about names is learned once and kept for half
/// an hour. Claude's conversations come from what Resume last read of the transcripts: reading them here, hundreds of
/// files that change all day, kept the page empty for fifteen seconds.
actor CanvasLoader {
  private let database: AppDatabase
  private let location: StoreLocation
  private var grouper: (value: CanvasGrouper, at: Double)?
  private static let learnAgain = 1800.0
  /// Names are learned from this much of the history.
  private static let learnDays = 60.0

  init(database: AppDatabase, location: StoreLocation) {
    self.database = database
    self.location = location
  }

  func day(from start: Date, to end: Date) throws -> CanvasDay {
    let now = Date().timeIntervalSince1970
    if grouper.map({ now - $0.at > Self.learnAgain }) ?? true {
      grouper = (try Self.grouper(database: database, location: location, now: now), now)
    }
    return try Self.day(database: database, grouper: grouper!.value, from: start, to: end)
  }

  func days() throws -> [CanvasDaySummary] { try database.canvasDays() }

  static func grouper(database: AppDatabase, location: StoreLocation, now: Double) throws -> CanvasGrouper {
    let since = now - learnDays * 86_400
    let seen = try database.seenTitles(since: since, momentsOf: ClaudeSessionIndex.bundleID)
    return CanvasGrouper(seen: seen.titles, sessions: ClaudeSessionIndex.cached(location.claudeSessionCache), claude: seen.moments)
  }

  static func day(database: AppDatabase, grouper: CanvasGrouper, from start: Date, to end: Date) throws -> CanvasDay {
    let (from, to) = (start.timeIntervalSince1970, end.timeIntervalSince1970)
    let threads = Dictionary(uniqueKeysWithValues: try database.allThreads().compactMap { thread in thread.id.map { ($0, thread.name) } })
    return grouper.day(
      activities: try database.activities(from: from, to: to), captures: try database.focusedCaptures(from: from, to: to), threads: threads,
      from: from, to: to)
  }
}
