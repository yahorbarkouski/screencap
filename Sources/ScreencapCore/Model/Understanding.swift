import Foundation

/// Purpose of a thread. Unknown is shown when the category question's top answer is below the threshold.
public enum ActivityCategory: String, Codable, Sendable, CaseIterable {
  case work = "Work"
  case study = "Study"
  case leisure = "Leisure"
  case chores = "Chores"
  case social = "Social"
  case unknown = "Unknown"

  /// The definitions the category question shows the decision model.
  public static let definitions: [ActivityCategory: String] = [
    .work: "Work: professional tasks, including work-directed research, coding, documents, meetings, email and team chat",
    .study: "Study: learning for its own sake, courses, tutorials, educational reading not done for a work task",
    .leisure: "Leisure: entertainment, games, recreational browsing, passive media",
    .chores: "Chores: personal administration, bills, shopping, appointments, paperwork, household tasks",
    .social: "Social: personal, non-work communication: messaging friends and family, personal calls",
  ]
}

/// Where the boundary answer for a gap between two consecutive focused captures came from.
public enum BoundarySource: String, Codable, Sendable {
  /// The decision model answered.
  case model
  /// A hard fact (marker or a gap of more than 10 minutes) ends the activity.
  case hardBreak = "hard_break"
  /// The right capture repeats the left one's frame and context, so the activity continues.
  case duplicate
  /// The user split the activity here.
  case user
  /// The model could not answer for this input after repeated tries; the activity continues.
  case unanswered
  /// The decider drew a boundary here, and a second look at the activities on both sides joined them.
  case joined
  /// The right capture is evidence, not an anchor: it gets no question and continues the activity before it.
  case evidence
}

/// The answer for the gap that ends at `rightCaptureID`.
public struct BoundaryDecision: Codable, Sendable, Hashable {
  public var rightCaptureID: String
  public var leftCaptureID: String
  /// Probability that the right capture starts a new activity.
  public var pNew: Double
  public var isBoundary: Bool
  public var source: BoundarySource
  public var decidedAt: Double

  public init(
    rightCaptureID: String, leftCaptureID: String, pNew: Double, isBoundary: Bool,
    source: BoundarySource, decidedAt: Double
  ) {
    self.rightCaptureID = rightCaptureID
    self.leftCaptureID = leftCaptureID
    self.pNew = pNew
    self.isBoundary = isBoundary
    self.source = source
    self.decidedAt = decidedAt
  }
}

/// A contiguous episode with one intent.
public struct Activity: Codable, Sendable, Hashable, Identifiable {
  public var id: Int64?
  public var firstCaptureID: String
  public var lastCaptureID: String
  public var startAt: Double
  /// End of the last capture's time: the next capture in its segment, capped (see `CaptureTiming`).
  public var endAt: Double
  public var captureCount: Int
  public var isOpen: Bool
  public var threadID: Int64?
  public var threadProbability: Double?
  /// The thread came from the question asked while the activity was still open.
  public var isThreadProvisional: Bool
  public var caption: String?
  /// Set by a user correction; background decisions never change the thread again.
  public var isThreadLocked: Bool
  /// A few words naming the activity like a calendar event, written from its caption; the caption keeps the detail.
  public var title: String?

  public init(
    id: Int64? = nil, firstCaptureID: String, lastCaptureID: String, startAt: Double, endAt: Double,
    captureCount: Int, isOpen: Bool, threadID: Int64? = nil, threadProbability: Double? = nil,
    isThreadProvisional: Bool = false, caption: String? = nil, isThreadLocked: Bool = false, title: String? = nil
  ) {
    self.id = id
    self.firstCaptureID = firstCaptureID
    self.lastCaptureID = lastCaptureID
    self.startAt = startAt
    self.endAt = endAt
    self.captureCount = captureCount
    self.isOpen = isOpen
    self.threadID = threadID
    self.threadProbability = threadProbability
    self.isThreadProvisional = isThreadProvisional
    self.caption = caption
    self.isThreadLocked = isThreadLocked
    self.title = title
  }

  public var minutes: Double { (endAt - startAt) / 60 }

  /// The activity's short name: its title, else its caption while the title is being written.
  public var label: String {
    if let title, !title.isEmpty { return title }
    return captionText
  }

  /// The caption as the timeline shows it. An empty caption means the model could not describe the activity.
  public var captionText: String {
    guard let caption else { return "Describing…" }
    return caption.isEmpty ? "No description" : caption
  }
}

/// Related activities across days: one workstream, matter or pastime.
public struct ActivityThread: Codable, Sendable, Hashable, Identifiable {
  public var id: Int64?
  public var name: String
  public var summary: String
  public var category: ActivityCategory
  public var isNameLocked: Bool
  public var isCategoryLocked: Bool
  public var createdAt: Double
  public var lastSeenAt: Double
  public var activityCount: Int
  /// Captions of member activities, oldest first, newest kept (see `ThreadCard.captionMemory`).
  public var captions: [String]
  /// Captions the user moved into this thread ("Includes") and out of it ("Not").
  public var includes: [String]
  public var excludes: [String]
  /// Set when a merge folded this thread into another; such threads are never offered again.
  public var mergedInto: Int64?

  public init(
    id: Int64? = nil, name: String, summary: String, category: ActivityCategory = .unknown,
    isNameLocked: Bool = false, isCategoryLocked: Bool = false, createdAt: Double,
    lastSeenAt: Double, activityCount: Int = 0, captions: [String] = [], includes: [String] = [],
    excludes: [String] = [], mergedInto: Int64? = nil
  ) {
    self.id = id
    self.name = name
    self.summary = summary
    self.category = category
    self.isNameLocked = isNameLocked
    self.isCategoryLocked = isCategoryLocked
    self.createdAt = createdAt
    self.lastSeenAt = lastSeenAt
    self.activityCount = activityCount
    self.captions = captions
    self.includes = includes
    self.excludes = excludes
    self.mergedInto = mergedInto
  }
}

/// One model answer, kept for audit, cost accounting and idempotent restarts.
public struct DecisionRecord: Codable, Sendable, Hashable {
  public var id: Int64?
  public var kind: String
  public var subject: String
  public var answer: String
  public var probability: Double?
  public var model: String
  public var inputTokens: Int
  public var costUSD: Double
  public var latencyMS: Int
  public var createdAt: Double

  public init(
    id: Int64? = nil, kind: String, subject: String, answer: String, probability: Double?,
    model: String, inputTokens: Int, costUSD: Double, latencyMS: Int, createdAt: Double
  ) {
    self.id = id
    self.kind = kind
    self.subject = subject
    self.answer = answer
    self.probability = probability
    self.model = model
    self.inputTokens = inputTokens
    self.costUSD = costUSD
    self.latencyMS = latencyMS
    self.createdAt = createdAt
  }
}

public enum CorrectionKind: String, Codable, Sendable {
  case move, merge, split, rename, category, delete
}

public struct Correction: Codable, Sendable, Hashable {
  public var id: Int64?
  public var kind: CorrectionKind
  public var payload: String
  public var at: Double

  public init(id: Int64? = nil, kind: CorrectionKind, payload: String, at: Double) {
    self.id = id
    self.kind = kind
    self.payload = payload
    self.at = at
  }
}

/// What a day was about, in a few words, written from its sessions.
public struct DayStory: Codable, Sendable, Equatable {
  public var headline: String

  public init(headline: String) {
    self.headline = headline
  }
}

/// The thread stage's answer for one activity, written onto the current rows by `AppDatabase.assign`.
public struct ThreadAssignment: Sendable {
  public var activityID: Int64
  /// The chosen thread, or nil for a new one.
  public var threadID: Int64?
  public var probability: Double?
  public var caption: String
  public var startAt: Double
  public var endAt: Double
  /// The card written with this answer (name, description, category), when the thread was due a new one.
  public var card: ActivityThread?

  public init(
    activityID: Int64, threadID: Int64?, probability: Double?, caption: String, startAt: Double, endAt: Double,
    card: ActivityThread?
  ) {
    self.activityID = activityID
    self.threadID = threadID
    self.probability = probability
    self.caption = caption
    self.startAt = startAt
    self.endAt = endAt
    self.card = card
  }
}
