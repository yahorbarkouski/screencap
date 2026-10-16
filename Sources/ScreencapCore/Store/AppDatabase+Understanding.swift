import Foundation
import GRDB

extension AppDatabase {
  /// Focused-display captures in time order, from `start` (inclusive), at most `limit`.
  public func focusedCaptures(from start: Double, limit: Int = 10_000) throws -> [Capture] {
    try reader.read { db in
      try Capture.fetchAll(
        db, sql: "SELECT * FROM capture WHERE isFocusedDisplay = 1 AND at >= ? ORDER BY at LIMIT ?",
        arguments: [start, limit])
    }
  }

  /// The `count` focused captures before `at`, oldest first; with `anchorsOnly`, only those that get a boundary question.
  public func focusedCaptures(before at: Double, count: Int, anchorsOnly: Bool = false) throws -> [Capture] {
    try reader.read { db in
      try Capture.fetchAll(
        db,
        sql: "SELECT * FROM capture WHERE isFocusedDisplay = 1 AND at < ? \(anchorsOnly ? "AND isAnchor = 1" : "") ORDER BY at DESC LIMIT ?",
        arguments: [at, count])
    }.reversed()
  }

  /// The earliest focused capture without a boundary answer, skipping the very first capture (it has no left side).
  public func earliestUndecidedCapture() throws -> Capture? {
    try reader.read { db in
      try Capture.fetchOne(
        db,
        sql: """
          SELECT c.* FROM capture c LEFT JOIN boundary b ON b.rightCaptureID = c.id
          WHERE c.isFocusedDisplay = 1 AND b.rightCaptureID IS NULL
            AND c.at > (SELECT MIN(at) FROM capture WHERE isFocusedDisplay = 1)
          ORDER BY c.at LIMIT 1
          """)
    }
  }

  /// Of the given captures, those whose text is final: OCR done or failed, or a duplicate whose frame's OCR is.
  public func ocrResolved(ids: [String]) throws -> Set<String> {
    guard !ids.isEmpty else { return [] }
    return try reader.read { db in
      var resolved = Set<String>()
      for chunk in stride(from: 0, to: ids.count, by: 500).map({ Array(ids[$0..<min($0 + 500, ids.count)]) }) {
        let placeholders = Array(repeating: "?", count: chunk.count).joined(separator: ",")
        let rows = try Row.fetchAll(
          db,
          sql: """
            SELECT c.id FROM capture c LEFT JOIN capture s ON s.id = c.duplicateOf
            WHERE c.id IN (\(placeholders)) AND (
              (c.duplicateOf IS NULL AND c.ocrState != 'pending') OR (c.duplicateOf IS NOT NULL AND s.ocrState != 'pending'))
            """, arguments: StatementArguments(chunk))
        resolved.formUnion(rows.map { $0["id"] as String })
      }
      return resolved
    }
  }

  public func evidence(for captures: [Capture]) throws -> [CaptureEvidence] {
    try reader.read { db in
      try captures.map { CaptureEvidence(capture: $0, lines: try Self.ocrLines(db, captureID: $0.id)) }
    }
  }

  public func hasBreakMarker(after start: Double, upTo end: Double) throws -> Bool {
    try markers(from: start, to: end).contains { $0.kind.breaksActivity }
  }

  public func boundary(rightCaptureID: String) throws -> BoundaryDecision? {
    try reader.read { db in try BoundaryDecision.fetchOne(db, key: rightCaptureID) }
  }

  public func boundaries(rightCaptureIDs ids: [String]) throws -> [String: BoundaryDecision] {
    try reader.read { db in
      Dictionary(uniqueKeysWithValues: try BoundaryDecision.fetchAll(db, keys: ids).map { ($0.rightCaptureID, $0) })
    }
  }

  public func save(_ boundary: BoundaryDecision, decision: DecisionRecord?) throws {
    try writer.write { db in
      try boundary.save(db)
      if var decision { try decision.insert(db) }
    }
  }

  public func record(_ decision: DecisionRecord) throws {
    var decision = decision
    try writer.write { db in try decision.insert(db) }
  }

  /// The latest answer of a kind for a subject, so a restart never asks the same question twice.
  public func decision(kind: String, subject: String) throws -> DecisionRecord? {
    try reader.read { db in
      try DecisionRecord.fetchOne(
        db, sql: "SELECT * FROM decision WHERE kind = ? AND subject = ? ORDER BY id DESC LIMIT 1",
        arguments: [kind, subject])
    }
  }

  // MARK: Activities

  public func latestActivity() throws -> Activity? {
    try reader.read { db in try Activity.fetchOne(db, sql: "SELECT * FROM activity ORDER BY startAt DESC LIMIT 1") }
  }

  public func activity(id: Int64) throws -> Activity? {
    try reader.read { db in try Activity.fetchOne(db, key: id) }
  }

  @discardableResult
  public func insert(_ activity: Activity) throws -> Activity {
    var activity = activity
    try writer.write { db in try activity.insert(db) }
    return activity
  }

  public func update(_ activity: Activity) throws {
    try writer.write { db in try activity.update(db) }
  }

  /// Closed activities still missing a caption, oldest first.
  public func closedActivitiesWithoutCaption() throws -> [Activity] {
    try reader.read { db in
      try Activity.fetchAll(db, sql: "SELECT * FROM activity WHERE isOpen = 0 AND caption IS NULL ORDER BY startAt")
    }
  }

  /// Captioned activities without a title yet, oldest first.
  public func activitiesAwaitingTitle() throws -> [Activity] {
    try reader.read { db in
      try Activity.fetchAll(
        db, sql: "SELECT * FROM activity WHERE isOpen = 0 AND caption IS NOT NULL AND caption != '' AND title IS NULL ORDER BY startAt")
    }
  }

  public func setTitle(_ title: String, activityID: Int64) throws {
    try writer.write { db in try db.execute(sql: "UPDATE activity SET title = ? WHERE id = ?", arguments: [title, activityID]) }
  }

  /// Closed activities whose final thread is not decided yet, oldest first.
  public func closedActivitiesAwaitingThread() throws -> [Activity] {
    try reader.read { db in
      try Activity.fetchAll(
        db,
        sql: """
          SELECT * FROM activity WHERE isOpen = 0 AND isThreadLocked = 0 AND (threadID IS NULL OR isThreadProvisional = 1)
          ORDER BY startAt
          """)
    }
  }

  /// Focused captures from an activity's first to its last capture.
  public func captures(of activity: Activity) throws -> [Capture] {
    try reader.read { db in
      try Capture.fetchAll(
        db,
        sql: """
          SELECT * FROM capture WHERE isFocusedDisplay = 1
            AND at >= (SELECT at FROM capture WHERE id = ?) AND at <= (SELECT at FROM capture WHERE id = ?)
          ORDER BY at
          """, arguments: [activity.firstCaptureID, activity.lastCaptureID])
    }
  }

  /// Every display's captures from an activity's first to its last capture: what deleting the activity removes.
  public func capturesOnEveryDisplay(of activity: Activity) throws -> [Capture] {
    try reader.read { db in
      try Capture.fetchAll(
        db,
        sql: """
          SELECT * FROM capture
          WHERE at >= (SELECT at FROM capture WHERE id = ?) AND at <= (SELECT at FROM capture WHERE id = ?)
          ORDER BY at
          """, arguments: [activity.firstCaptureID, activity.lastCaptureID])
    }
  }

  /// Removes everything the engine decided (boundaries, activities, threads, the decision log), keeping captures,
  /// their text, markers and corrections, so the engine can run over the captures again.
  public func clearUnderstanding() throws {
    try writer.write { db in
      for table in ["activity", "thread", "boundary", "decision"] { try db.execute(sql: "DELETE FROM \(table)") }
    }
  }

  /// The decider's boundaries that have not had their second look, in time order. Boundaries an activity already
  /// starts at are final, which keeps a store from before this stage as it is.
  public func boundariesAwaitingJoin() throws -> [BoundaryDecision] {
    try reader.read { db in
      try BoundaryDecision.fetchAll(
        db,
        sql: """
          SELECT b.* FROM boundary b JOIN capture c ON c.id = b.rightCaptureID
          WHERE b.source = 'model' AND b.isBoundary = 1
            AND c.at > (SELECT COALESCE(MAX(startAt), 0) FROM activity)
            AND NOT EXISTS (SELECT 1 FROM decision d WHERE d.kind = 'join' AND d.subject = b.rightCaptureID)
          ORDER BY c.at
          """)
    }
  }

  /// Of these boundary captures, the ones still waiting for their second look.
  public func awaitingJoin(rightCaptureIDs ids: [String]) throws -> Set<String> {
    guard !ids.isEmpty else { return [] }
    return try reader.read { db in
      let placeholders = Array(repeating: "?", count: ids.count).joined(separator: ",")
      let answered = try String.fetchAll(
        db, sql: "SELECT subject FROM decision WHERE kind = 'join' AND subject IN (\(placeholders))", arguments: StatementArguments(ids))
      return Set(ids).subtracting(answered)
    }
  }

  /// The latest focused capture before `at` that starts an activity.
  public func lastBoundaryCapture(before at: Double) throws -> Capture? {
    try reader.read { db in
      try Capture.fetchOne(
        db,
        sql: """
          SELECT c.* FROM capture c JOIN boundary b ON b.rightCaptureID = c.id
          WHERE c.isFocusedDisplay = 1 AND b.isBoundary = 1 AND c.at < ? ORDER BY c.at DESC LIMIT 1
          """, arguments: [at])
    }
  }

  /// Where a thread happened most: the site (with the browser it was in) or app of most of its focused captures.
  public func mainPlace(threadID: Int64) throws -> (host: String?, bundleID: String?)? {
    try reader.read { db in
      try Row.fetchOne(
        db,
        sql: """
          SELECT c.urlHost AS host, c.bundleID AS bundle, COUNT(*) AS n FROM activity a
          JOIN capture c ON c.isFocusedDisplay = 1 AND c.at >= a.startAt AND c.at < a.endAt
          WHERE a.threadID = ? GROUP BY c.urlHost, c.bundleID ORDER BY n DESC LIMIT 1
          """, arguments: [threadID]
      ).map { ($0["host"], $0["bundle"]) }
    }
  }

  /// Settles an activity whose thread question kept failing: it stays without a thread, and no pass asks again.
  public func settleWithoutThread(activityID: Int64) throws {
    try writer.write { db in
      try db.execute(
        sql: "UPDATE activity SET threadID = NULL, isThreadProvisional = 0, isThreadLocked = 1 WHERE id = ?", arguments: [activityID])
    }
  }

  public func decisionCount(kind: String, subject: String) throws -> Int {
    try reader.read { db in
      try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM decision WHERE kind = ? AND subject = ?", arguments: [kind, subject]) ?? 0
    }
  }

  /// Writes a caption, unless the activity changed (split, or grew) while it was being written.
  public func setCaption(_ caption: String, activityID: Int64, lastCaptureID: String) throws {
    try writer.write { db in
      try db.execute(
        sql: "UPDATE activity SET caption = ? WHERE id = ? AND lastCaptureID = ?", arguments: [caption, activityID, lastCaptureID])
    }
  }

  public func activities(from start: Double, to end: Double) throws -> [Activity] {
    try reader.read { db in
      try Activity.fetchAll(
        db, sql: "SELECT * FROM activity WHERE endAt > ? AND startAt < ? ORDER BY startAt", arguments: [start, end])
    }
  }

  public func activities(threadID: Int64) throws -> [Activity] {
    try reader.read { db in
      try Activity.fetchAll(db, sql: "SELECT * FROM activity WHERE threadID = ? ORDER BY startAt", arguments: [threadID])
    }
  }

  // MARK: Threads

  /// Threads the thread question offers: not merged away and seen within `days`, at most the `limit` most recently
  /// seen, oldest first.
  public func liveThreads(now: Double, days: Double = 30, limit: Int = ThreadCard.maxOptions) throws -> [ActivityThread] {
    try reader.read { db in
      try ActivityThread.fetchAll(
        db,
        sql: """
          SELECT * FROM (SELECT * FROM thread WHERE mergedInto IS NULL AND lastSeenAt >= ? ORDER BY lastSeenAt DESC LIMIT ?)
          ORDER BY id
          """,
        arguments: [now - days * 86_400, limit])
    }
  }

  public func thread(id: Int64) throws -> ActivityThread? {
    try reader.read { db in try ActivityThread.fetchOne(db, key: id) }
  }

  public func allThreads() throws -> [ActivityThread] {
    try reader.read { db in try ActivityThread.fetchAll(db, sql: "SELECT * FROM thread WHERE mergedInto IS NULL ORDER BY id") }
  }

  public func update(_ thread: ActivityThread) throws {
    try writer.write { db in try thread.update(db) }
  }

  /// Folds the `absorbed` threads into `survivorID`: their activities, captions and corrections move over, and each
  /// absorbed thread points at the survivor so it is never offered again. Reads the current rows, so a thread merged
  /// or renamed meanwhile is respected. Returns the survivor, or nil when it was merged away meanwhile.
  public func merge(_ absorbed: [Int64], into survivorID: Int64) throws -> ActivityThread? {
    try writer.write { db in
      guard var survivor = try ActivityThread.fetchOne(db, key: survivorID), survivor.mergedInto == nil else { return nil }
      for id in absorbed where id != survivorID {
        guard var thread = try ActivityThread.fetchOne(db, key: id), thread.mergedInto == nil else { continue }
        try db.execute(sql: "UPDATE activity SET threadID = ? WHERE threadID = ?", arguments: [survivorID, id])
        survivor.captions = Array((survivor.captions + thread.captions).suffix(ThreadCard.captionMemory))
        survivor.includes += thread.includes
        survivor.excludes += thread.excludes
        survivor.activityCount += thread.activityCount
        survivor.lastSeenAt = max(survivor.lastSeenAt, thread.lastSeenAt)
        survivor.createdAt = min(survivor.createdAt, thread.createdAt)
        thread.mergedInto = survivorID
        try thread.update(db)
      }
      try survivor.update(db)
      return survivor
    }
  }

  /// Writes a new card onto the thread's current row: the description always, the name and category unless the user
  /// set them while the card was being written.
  public func applyCard(_ card: ActivityThread) throws {
    guard let id = card.id else { return }
    try writer.write { db in
      try db.execute(
        sql: """
          UPDATE thread SET summary = ?, name = CASE WHEN isNameLocked THEN name ELSE ? END,
            category = CASE WHEN isCategoryLocked THEN category ELSE ? END
          WHERE id = ?
          """, arguments: [card.summary, card.name, card.category.rawValue, id])
    }
  }

  /// The data side of moving an activity: the old thread drops the caption from its recent ones and learns
  /// "Not: caption", the target learns "Includes: caption", and the activity is locked to the target. A target without an id is inserted. Returns the target's id.
  public func applyMove(activity: Activity, caption: String, to target: ActivityThread) throws -> Int64? {
    var target = target
    return try writer.write { db in
      guard let id = activity.id, var activity = try Activity.fetchOne(db, key: id) else { return nil }
      let previousID = activity.threadID
      if let targetID = target.id, let current = try ActivityThread.fetchOne(db, key: targetID) { target = current }
      if let previousID, var previous = try ActivityThread.fetchOne(db, key: previousID), previousID != target.id {
        previous.activityCount = max(0, previous.activityCount - 1)
        previous.captions.removeAll { $0 == caption }
        previous.excludes = Array((previous.excludes + [caption]).suffix(ThreadCard.correctionMemory))
        try previous.update(db)
      }
      if target.id == nil || target.id != previousID {
        if target.id != nil { target.captions = Array((target.captions + [caption]).suffix(ThreadCard.captionMemory)) }
        target.activityCount += 1
        target.includes = Array((target.includes + [caption]).suffix(ThreadCard.correctionMemory))
        target.lastSeenAt = max(target.lastSeenAt, activity.endAt)
      }
      if target.id == nil { try target.insert(db) } else { try target.update(db) }
      activity.threadID = target.id
      activity.isThreadProvisional = false
      activity.isThreadLocked = true
      try activity.update(db)
      var correction = Correction(
        kind: .move,
        payload: "activity \(activity.id ?? 0): thread \(previousID.map(String.init) ?? "none") -> \(target.id.map(String.init) ?? "new")",
        at: Date().timeIntervalSince1970)
      try correction.insert(db)
      return target.id
    }
  }

  /// Records the thread question's answer in one transaction, on the current rows: the activity joins the thread
  /// (a new one when `threadID` is nil, its survivor when it was merged meanwhile) unless the user locked it, and the
  /// thread gains the caption and, when one was written, the new card. Returns the thread's id.
  @discardableResult
  public func assign(_ assignment: ThreadAssignment, decision: DecisionRecord?) throws -> Int64? {
    try writer.write { db in
      guard var activity = try Activity.fetchOne(db, key: assignment.activityID), !activity.isThreadLocked else { return nil }
      var thread = ActivityThread(name: "", summary: "", createdAt: assignment.startAt, lastSeenAt: assignment.endAt)
      if let id = assignment.threadID, var existing = try ActivityThread.fetchOne(db, key: id) {
        while let survivorID = existing.mergedInto, let survivor = try ActivityThread.fetchOne(db, key: survivorID) { existing = survivor }
        thread = existing
      }
      if !assignment.caption.isEmpty {
        thread.captions = Array((thread.captions + [assignment.caption]).suffix(ThreadCard.captionMemory))
      }
      thread.activityCount += 1
      thread.lastSeenAt = max(thread.lastSeenAt, assignment.endAt)
      if let card = assignment.card {
        if !thread.isNameLocked { thread.name = card.name }
        thread.summary = card.summary
        if !thread.isCategoryLocked { thread.category = card.category }
      }
      if thread.id == nil { try thread.insert(db) } else { try thread.update(db) }
      activity.threadID = thread.id
      activity.threadProbability = assignment.probability
      activity.isThreadProvisional = false
      try activity.update(db)
      if var decision {
        decision.answer = thread.id.map(String.init) ?? decision.answer
        try decision.insert(db)
      }
      return thread.id
    }
  }
}
