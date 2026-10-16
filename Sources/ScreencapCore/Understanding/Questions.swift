import Foundation

/// The questions and prompts, word for word as measured in the design experiments (seg.py RULE2/GAP, thread.py
/// QUESTION/NEW/CAPTION_PROMPT/THREAD_PROMPT, build_mock.py's category question, consolidate.py's merge question),
/// which ran on the author's own captures and are not published.
public enum Questions {
  public static let boundaryRule =
    "An activity is one concrete intent or outcome the person would want as one timeline row. It can span several "
    + "apps and sites: reading docs, editing code and checking the result is one activity. Short detours that serve the "
    + "current task (looking up docs, copying a password, running tests, asking an AI assistant about it) stay in the "
    + "same activity. Switching to an unrelated purpose starts a new activity, even in the same app (another project, "
    + "another document or conversation, entertainment instead of work), and so does a short side task with its own "
    + "outcome, such as replying to an unrelated message. Returning to an earlier task after an unrelated interruption "
    + "also starts a new activity."
    + " A glance of one or two captures with no outcome of its own stays in the activity: a blank or loading page, a "
    + "window passed through on the way to another, a notification seen but not acted on, or a lookup for the current "
    + "task. Checking mail, reading or answering a message about something else, or checking on another piece of work "
    + "(such as an AI agent working on another project) has an outcome of its own and starts a new activity however "
    + "short it is, even while a stream or video keeps playing. A message, mail or AI chat about the current task "
    + "(asking someone about it, sending them its result, discussing it with an AI assistant) continues the activity, "
    + "even when it moves between apps. Use the captures after the gap and their screen text to see what the person "
    + "did and what it was about. Opening a related document, tool or page to continue the same piece of work stays in "
    + "the activity."

  /// The second look at a boundary the decider drew, with the activities on both sides shown whole. Designed on the
  /// app's own stream, where a capture at every switch of app or site makes each hop of one piece of work look like
  /// a change; tried in the design experiments' join probe.
  public static let joinRule =
    "An activity is one concrete intent or outcome the person would want as one timeline row. It can span several "
    + "apps and sites: gathering material from chat, mail, documents and an AI assistant for one piece of work is one "
    + "activity, and so is reading docs, editing code and checking the result. Leisure browsing that moves between feeds, "
    + "videos and sites with no goal of its own is one activity too, the way several unrelated videos watched in a row "
    + "are. A side task with its own outcome, such as replying to an unrelated message, is its own activity, and so is "
    + "switching to an unrelated purpose."

  public static let join =
    "Activity B continues activity A: both serve the same intent or outcome, so they belong in one timeline row."

  public static func boundaryGap(right: String, left: String) -> String {
    "Capture \(right) starts a new activity: it does not continue the activity of capture \(left)."
  }

  public static func capturesHeader(cadence: Double) -> String {
    cadence >= 90
      ? "A person's screen captures, one every ~2 minutes, oldest first:"
      : "A person's screen captures, about one a minute, oldest first:"
  }

  public static let thread =
    "The state shows one activity from a person's screen history: a few of its screen captures (time, app, window "
    + "title, host, screen text) and screenshots. Which of the person's threads does this activity belong to? A thread "
    + "is one ongoing effort or interest: one workstream of a project, one personal matter, one recurring pastime. It is "
    + "about purpose, not apps: the same app serves many threads, and one thread spans many apps. Choose an existing "
    + "thread only when this activity serves the same effort; otherwise choose new."

  public static let newThreadKey = "new"
  public static let newThreadCriterion = "new: none of these; a different effort or interest"

  public static let caption =
    "These are screen captures from one activity of a person's day (time, app, window title, host, screen text), "
    + "plus a screenshot. Return JSON {\"caption\": \"one specific line saying what the person did and toward what end, "
    + "naming the project, document, person, video or game when visible\"}.\n\n"

  /// The caption and the Day view's title in one call; the app asks this one, the replay (no titles) asks `caption`.
  public static let captionAndTitle =
    "These are screen captures from one activity of a person's day (time, app, window title, host, screen text), "
    + "plus a screenshot. Return JSON {\"caption\": \"one specific line saying what the person did and toward what end, "
    + "naming the project, document, person, video or game when visible\", \"title\": \"2-5 words naming what was done "
    + "and on what, like a calendar event, such as Checkout API spec review, Lease renewal edits or Tour de France highlights; "
    + "no person's full name, no trailing period\"}.\n\n"

  /// Unlike thread.py's THREAD_PROMPT, the card names the thread at the level it keeps across days. Built from its
  /// first captions, a pastime's card used to name one video's or post's topic, and every later thread question
  /// and merge then compared topics: the replay split one browsing pastime into 29 threads.
  /// What a day was about, for the top of the Day view; the input is the day's sessions, oldest first.
  public static let dayStory =
    "These are the sessions of one person's day, oldest first: time, minutes, thread, and what they did. Return JSON "
    + "{\"headline\": \"the day in 2-5 words, naming its one to three main efforts, like a diary heading\"}.\n\n"

  /// An activity's short name, written from its caption.
  public static let title =
    "This describes one activity from a person's screen history. Name it like a calendar event. Return JSON "
    + "{\"title\": \"2-5 words naming what was done and on what, such as Checkout API spec review, Lease renewal "
    + "edits or Tour de France highlights; no person's full name, no trailing period\"}.\n\n"

  public static let threadCard =
    "A thread groups a person's related activities across days: one ongoing effort or interest (one workstream of a "
    + "project, one personal matter, one recurring pastime). Here are captions of its activities, oldest first. Return "
    + "JSON {\"name\": \"2-6 words a person would recognise\", \"description\": \"one sentence saying what unites the "
    + "thread\"}. Name it at the level it keeps across days: for work, the project and its workstream; for a personal "
    + "matter, the matter; for a pastime, the pastime and where (such as watching YouTube videos or browsing X), with "
    + "today's topics only as examples, since the next video or post will be about something else.\n\n"

  public static let category = "What is the purpose of this thread of a person's activity? Judge by purpose, not by app."

  public static let categoryOptions: [ChoiceOption] =
    [ActivityCategory.work, .study, .leisure, .chores, .social].map {
      ChoiceOption(key: $0.rawValue, criterion: ActivityCategory.definitions[$0]!)
    } + [ChoiceOption(key: ActivityCategory.unknown.rawValue, criterion: "Unknown: the purpose cannot be determined from what is on screen")]

  public static let mergeState = "Two threads of one person's screen activity history."

  /// Measured on the gold days, this wording (0.694 thread B-cubed F1 with nightly merges) beat one that restated
  /// the thread question's definition and called sibling workstreams different (0.631: precision rose, but the
  /// merge stopped joining real duplicates, such as one pastime's thread under two names).
  public static func merge(a: String, b: String) -> String {
    "Thread A: \(a)\n\nThread B: \(b)\n\nAre threads A and B the same ongoing effort or interest of this person, so that "
      + "they should be one thread? Same project workstream, same personal matter or same pastime counts as the same; "
      + "merely using the same app or being the same broad category (both work, both entertainment) does not."
  }
}

/// An activity's captures, rendered the way the caption and thread questions read them.
public struct ActivityEvidence: Sendable {
  public var captures: [CaptureEvidence]
  public var cadence: Double
  public var clock: TimeFormatter

  public init(captures: [CaptureEvidence], cadence: Double, clock: TimeFormatter) {
    self.captures = captures
    self.cadence = cadence
    self.clock = clock
  }

  /// Up to `k` captures spread evenly, ends included, with Python's round-half-to-even like the experiments.
  public func sample(_ k: Int = 6) -> [CaptureEvidence] {
    guard captures.count > k else { return captures }
    return (0..<k).map { i in
      let position = (Double(i) * Double(captures.count - 1) / Double(k - 1)).rounded(.toNearestOrEven)
      return captures[Int(position)]
    }
  }

  /// The screenshots shown with the activity: its middle, or its quarter and three-quarter points.
  public var imageCaptures: [CaptureEvidence] {
    let n = captures.count
    return n < 4 ? [captures[n / 2]] : [captures[n / 4], captures[(3 * n) / 4]]
  }

  public func text(ocrLimit: Int) -> String {
    let first = captures.first!.capture
    let last = captures.last!.capture
    let minutes = Int(((last.at - first.at) / 60).rounded(.toNearestOrEven)) + Int(cadence / 60)
    let head =
      "Activity on \(clock.day(first.at)), \(clock.hourMinute(first.at))–\(clock.hourMinute(last.at)) (\(captures.count) captures, ~\(minutes) min):"
    return ([head] + sample().map { CaptureText.activityLine($0, ocrLimit: ocrLimit, clock: clock) }).joined(separator: "\n")
  }
}

/// How a thread reads in the questions.
public enum ThreadCard {
  /// Captions kept on the thread record; the questions read the latest 3 to 8.
  public static let captionMemory = 20
  /// Corrections shown on the card, newest first.
  public static let correctionMemory = 5
  /// Threads the thread question offers: a choice question takes at most 255 options, and one is "new thread".
  public static let maxOptions = 254

  /// The option text of the thread question: name, description, recent captions, and the user's corrections.
  public static func option(_ thread: ActivityThread) -> String {
    var text = "\(thread.name): \(thread.summary) Recent: \(thread.captions.suffix(3).joined(separator: "; "))"
    if !thread.includes.isEmpty { text += " Includes: \(thread.includes.suffix(correctionMemory).joined(separator: "; "))" }
    if !thread.excludes.isEmpty { text += " Not: \(thread.excludes.suffix(correctionMemory).joined(separator: "; "))" }
    return text
  }

  /// The text model's input for naming and describing a thread.
  public static func describeInput(_ thread: ActivityThread) -> String {
    Questions.threadCard + thread.captions.suffix(8).map { "- \($0)" }.joined(separator: "\n")
  }

  public static func categoryState(_ thread: ActivityThread) -> String {
    "Thread: \(thread.name). \(thread.summary)\nActivities: " + thread.captions.suffix(5).joined(separator: "; ")
  }

  public static func mergeText(_ thread: ActivityThread) -> String {
    "\(thread.name): \(thread.summary) Activities: \(thread.captions.suffix(4).joined(separator: "; "))"
  }
}
