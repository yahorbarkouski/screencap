import Foundation

/// What kind of place a thing is, which decides how it is brought back to the front.
public enum ThingKind: String, Codable, Sendable {
  /// A page in a browser, identified by its address: the browser may hold it in any window.
  case tab
  /// One conversation inside an app that keeps many in a single window (Claude).
  case session
  /// A window of an ordinary app, identified by its title.
  case window
  /// An app with nothing finer to aim at: no title was read, or the title changes every minute.
  case app
}

/// Somewhere you can come back to. The key survives relaunches, so a thing stays the same thing after a reboot:
/// window ids and process ids do not, and are never part of it.
/// A place said not to belong to a thread.
public struct ThingExclusion: Sendable, Hashable, Identifiable {
  public var threadID: Int64
  public var threadName: String
  public var thing: Thing
  public var at: Double

  public var id: String { "\(threadID)-\(thing.id ?? 0)" }
}

public struct Thing: Codable, Sendable, Hashable, Identifiable {
  public var id: Int64?
  /// `url:<host><path>`, `claude:<session-uuid>`, `win:<bundleID>|<title>` or `app:<bundleID>`.
  public var key: String
  public var kind: ThingKind
  /// What to call it on screen. The newest label wins: titles improve as a page or session is named.
  public var label: String
  /// A second line when the label needs context: the host for a tab, the folder for a session.
  public var detail: String?
  public var bundleID: String?
  public var firstSeenAt: Double
  public var lastSeenAt: Double

  public init(
    id: Int64? = nil, key: String, kind: ThingKind, label: String, detail: String? = nil,
    bundleID: String? = nil, firstSeenAt: Double, lastSeenAt: Double
  ) {
    self.id = id
    self.key = key
    self.kind = kind
    self.label = label
    self.detail = detail
    self.bundleID = bundleID
    self.firstSeenAt = firstSeenAt
    self.lastSeenAt = lastSeenAt
  }
}

/// A thing read off one capture, before it is stored and given an id.
public struct ThingRef: Sendable, Hashable {
  public var key: String
  public var kind: ThingKind
  public var label: String
  public var detail: String?
  public var bundleID: String?

  public init(key: String, kind: ThingKind, label: String, detail: String? = nil, bundleID: String? = nil) {
    self.key = key
    self.kind = kind
    self.label = label
    self.detail = detail
    self.bundleID = bundleID
  }
}

/// Seconds a thing was on screen while a thread was the one being worked on, for one local day.
///
/// Days are buckets rather than one running total so that how fast old time stops counting can change without
/// rebuilding anything: the decay is applied when the rows are read (`ThingScore`).
public struct ThreadBinding: Codable, Sendable, Hashable {
  public var threadID: Int64
  public var thingID: Int64
  /// Local midnight of the day the time was spent, so a bucket matches the day the person remembers. Kept as a
  /// moment rather than a day number because local midnight is not a multiple of 86 400 outside UTC.
  public var dayStart: Double
  public var seconds: Double
  public var captures: Int
  /// Separate stretches of work the thing appeared in, on this day. Recurrence is what tells a place you come
  /// back to from one you passed through: an article's address is seen once, an issue over and over.
  public var activities: Int

  public init(threadID: Int64, thingID: Int64, dayStart: Double, seconds: Double, captures: Int, activities: Int = 1) {
    self.threadID = threadID
    self.thingID = thingID
    self.dayStart = dayStart
    self.seconds = seconds
    self.captures = captures
    self.activities = activities
  }

  /// Local midnight of the day a moment falls in, as stored in `dayStart`.
  public static func dayStart(_ at: Double, calendar: Calendar = .current) -> Double {
    calendar.startOfDay(for: Date(timeIntervalSince1970: at)).timeIntervalSince1970
  }
}
