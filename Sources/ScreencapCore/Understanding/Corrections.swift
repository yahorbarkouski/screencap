import Foundation
import GRDB

/// The user's corrections. Each one changes the data at once and becomes text the thread question reads from then
/// on (a thread card's "Includes" and "Not" lines), so it applies to the next decision without retraining.
public struct Corrections: Sendable {
  let database: AppDatabase
  let location: StoreLocation
  let engine: UnderstandingEngine

  public init(database: AppDatabase, location: StoreLocation, engine: UnderstandingEngine) {
    self.database = database
    self.location = location
    self.engine = engine
  }

  /// Moves an activity to `threadID`, or to a new thread named after it when `threadID` is nil. Locks the activity so
  /// background passes never move it back. An activity is moved only once it has a caption, the text its old and new
  /// threads' cards remember it by.
  @discardableResult
  public func move(activityID: Int64, to threadID: Int64?) async throws -> Int64? {
    guard let activity = try database.activity(id: activityID), let caption = activity.caption else { return nil }
    var target: ActivityThread
    if let threadID, let existing = try database.thread(id: threadID) {
      target = existing
    } else {
      target = ActivityThread(name: "", summary: "", createdAt: activity.startAt, lastSeenAt: activity.endAt)
      target.captions = [caption]
      target = try await engine.refreshedCard(target)
    }
    return try database.applyMove(activity: activity, caption: caption, to: target)
  }

  /// Asks the thread question again without the activity's current thread, and moves the activity to the answer.
  @discardableResult
  public func notThisThread(activityID: Int64) async throws -> Int64? {
    guard let activity = try database.activity(id: activityID), activity.caption != nil else { return nil }
    let answer = try await engine.chooseThread(for: activity, excluding: activity.threadID.map { [$0] } ?? [])
    return try await move(activityID: activityID, to: answer)
  }

  /// Moves the smaller side of a thread that holds two pieces of work into a thread of its own, and answers with
  /// the new thread's id.
  ///
  /// The new thread is named before anything moves, from the captions of the activities going into it, the way
  /// `move` names a thread it makes: a thread is otherwise named only when a new activity joins it, and a side split
  /// off from past work may never be joined again. If the name cannot be written nothing moves, so a failure leaves
  /// the thread as it was. The thread the side left gets a fresh card too, since what it holds has changed.
  @discardableResult
  public func split(_ candidate: ThreadSplitCandidate) async throws -> Int64? {
    guard candidate.groups.count > 1, let source = try database.thread(id: candidate.threadID) else { return nil }
    let leaving = try database.activities(threadID: candidate.threadID)
      .filter { activity in activity.id.map(candidate.groups[1].activityIDs.contains) ?? false }
      .sorted { $0.startAt < $1.startAt }
    guard let first = leaving.first, let last = leaving.max(by: { $0.endAt < $1.endAt }) else { return nil }

    var target = ActivityThread(
      name: "", summary: "", category: source.category, createdAt: first.startAt, lastSeenAt: last.endAt)
    target.captions = Array(leaving.compactMap(\.caption).filter { !$0.isEmpty }.suffix(ThreadCard.captionMemory))
    let named = try await engine.refreshedCard(target)
    target = try await database.writer.write { db in
      var inserted = named
      try inserted.insert(db)
      return inserted
    }

    for activity in leaving {
      _ = try database.applyMove(activity: activity, caption: activity.caption ?? "", to: target)
    }
    if let remaining = try database.thread(id: candidate.threadID) {
      try database.applyCard(try await engine.refreshedCard(remaining))
    }
    try log(.split, "thread \(candidate.threadID): \(leaving.count) activities into thread \(target.id ?? 0)")
    return target.id
  }

  /// Folds thread `absorbedID` into `survivorID` and refreshes the survivor's card.
  public func merge(_ absorbedID: Int64, into survivorID: Int64) async throws {
    guard absorbedID != survivorID, let merged = try database.merge([absorbedID], into: survivorID) else { return }
    try database.applyCard(try await engine.refreshedCard(merged))
    try log(.merge, "thread \(absorbedID) into \(survivorID)")
  }

  public func rename(threadID: Int64, to name: String) throws {
    guard var thread = try database.thread(id: threadID), !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    thread.name = name.trimmingCharacters(in: .whitespaces)
    thread.isNameLocked = true
    try database.update(thread)
    try log(.rename, "thread \(threadID): \(thread.name)")
  }

  public func setCategory(threadID: Int64, to category: ActivityCategory) throws {
    guard var thread = try database.thread(id: threadID) else { return }
    thread.category = category
    thread.isCategoryLocked = true
    try database.update(thread)
    try log(.category, "thread \(threadID): \(category.rawValue)")
  }

  /// Ends the activity just before `captureID`. Both parts get new captions on the next pass, and the second part a
  /// thread of its own choosing.
  public func split(activityID: Int64, before captureID: String) throws {
    guard var activity = try database.activity(id: activityID), captureID != activity.firstCaptureID else { return }
    let captures = try database.captures(of: activity)
    guard let index = captures.firstIndex(where: { $0.id == captureID }), index > 0 else { return }
    let left = Array(captures[..<index])
    let right = Array(captures[index...])
    try database.writer.write { db in
      try BoundaryDecision(
        rightCaptureID: captureID, leftCaptureID: left.last!.id, pNew: 1, isBoundary: true, source: .user,
        decidedAt: Date().timeIntervalSince1970
      ).save(db)
      let wasOpen = activity.isOpen
      let originalEnd = activity.endAt
      activity.lastCaptureID = left.last!.id
      activity.endAt = right.first!.at
      activity.captureCount = left.count
      activity.caption = nil
      activity.isOpen = false
      try activity.update(db)
      // The first part keeps the id; the caption written for the whole activity must not come back as its caption.
      try db.execute(sql: "DELETE FROM decision WHERE kind = 'caption' AND subject = ?", arguments: ["activity:\(activityID)"])
      var second = Activity(
        firstCaptureID: right.first!.id, lastCaptureID: right.last!.id, startAt: right.first!.at, endAt: originalEnd,
        captureCount: right.count, isOpen: wasOpen)
      try second.insert(db)
      var correction = Correction(kind: .split, payload: "activity \(activityID) before \(captureID)", at: Date().timeIntervalSince1970)
      try correction.insert(db)
    }
  }

  /// Deletes an activity with every display's captures over its span, their frames, thumbnails and text, and its
  /// caption wherever it was kept (thread cards, the decision log). In the backup, the frames' objects are deleted,
  /// the day files are written again without the rows, and tombstones keep a restore from bringing them back from
  /// an older snapshot.
  public func delete(activityID: Int64) throws {
    guard let activity = try database.activity(id: activityID) else { return }
    let captures = try database.capturesOnEveryDisplay(of: activity)
    // Duplicates elsewhere may point at these frames; they lose their link and keep their own row.
    for capture in captures {
      for path in [capture.framePath, capture.thumbPath].compactMap({ $0 }) where !path.hasPrefix("/") {
        try? FileManager.default.removeItem(at: location.url(path))
      }
    }
    let now = Date().timeIntervalSince1970
    try database.writer.write { db in
      // The search index then removes a deleted row's words from its pages too (SQLite 3.42 and later).
      try db.execute(sql: "INSERT INTO captureSearch(captureSearch, rank) VALUES('secure-delete', 1)")
      for capture in captures {
        if let path = capture.framePath, !path.hasPrefix("/") {
          try AppDatabase.enqueueBackup(db, .delete, objectKey: BackupKeys.frame(capture: capture), localPath: nil, at: now)
        }
        try AppDatabase.addTombstone(db, kind: "capture", id: capture.id, at: now)
        try db.execute(sql: "DELETE FROM captureSearch WHERE captureID = ?", arguments: [capture.id])
        try db.execute(sql: "DELETE FROM capture WHERE id = ?", arguments: [capture.id])
      }
      for day in Set(captures.map { BackupKeys.day($0.at) }) {
        try AppDatabase.enqueueBackup(db, .rows, objectKey: BackupKeys.rows(day: day), localPath: nil, at: now)
      }
      try AppDatabase.enqueueBackup(db, .tombstones, objectKey: BackupKeys.tombstones, localPath: nil, at: now)
      // This week's snapshot still holds the deleted rows; a new one replaces it, and its upload prunes older ones.
      try AppDatabase.enqueueBackup(db, .snapshot, objectKey: BackupKeys.snapshot(week: BackupKeys.week(now)), localPath: nil, at: now)
      for var thread in try ActivityThread.fetchAll(db) {
        let before = thread
        if let caption = activity.caption {
          thread.captions.removeAll { $0 == caption }
          thread.includes.removeAll { $0 == caption }
          thread.excludes.removeAll { $0 == caption }
        }
        if thread.id == activity.threadID { thread.activityCount = max(0, thread.activityCount - 1) }
        if thread != before { try thread.update(db) }
      }
      try db.execute(sql: "DELETE FROM decision WHERE subject = ?", arguments: ["activity:\(activityID)"])
      try db.execute(sql: "DELETE FROM activity WHERE id = ?", arguments: [activityID])
      try AppDatabase.addTombstone(db, kind: "activity", id: String(activityID), at: now)
      var correction = Correction(kind: .delete, payload: "activity \(activityID), \(captures.count) captures", at: now)
      try correction.insert(db)
    }
  }

  func log(_ kind: CorrectionKind, _ payload: String) throws {
    var correction = Correction(kind: kind, payload: payload, at: Date().timeIntervalSince1970)
    try database.writer.write { db in try correction.insert(db) }
  }
}
