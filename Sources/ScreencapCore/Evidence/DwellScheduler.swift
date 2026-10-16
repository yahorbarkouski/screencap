import Foundation

/// Decides when to capture, from input and focus, and which captures get a boundary question.
///
/// A capture follows what the person did: a page once its title or URL has held `viewHold`, the screen once it has
/// stayed still for `settle` after a key press, click, scroll or page change, the screen `typingPause` after a burst
/// of typing, and a frame whenever `fallback` has passed since the last capture. On three hours of logged use
/// (research/smart-capture.md) this caught 97% of the pages held 10 s or more, against 73% for a 60 s timer and a
/// capture 5 s after each change of app or site, for 128 kept frames an hour against 80.
///
/// Every capture, kept or duplicate, serves the changes before it: a trigger fires only for a change that came after
/// the last capture. A blocked attempt (idle, locked, an excluded app) serves them too, so a blocked trigger waits for
/// the next change or the fallback instead of retrying every poll.
public struct DwellScheduler: Sendable {
  public struct Rules: Sendable {
    public var fallback: Double = 60
    public var viewHold: Double = 10
    public var settle: Double = 10
    public var typingPause: Double = 3
    public var typingMinKeys = 8
    /// Key presses at most this far apart belong to one burst.
    public var typingGap: Double = 2
    /// The least time between an event capture and the capture before it.
    public var eventSpacing: Double = 10
    /// Event captures allowed in a row after a quiet spell, and how many the allowance regains a minute.
    public var burst: Double = 4
    public var perMinute: Double = 3
    /// An event capture is an anchor when no anchor came for this long: it stands in for a timer capture.
    public var anchorGap: Double = 55

    public init() {}
  }

  /// Input counted since the previous poll.
  public struct Input: Sendable, Equatable {
    public var keys: Int
    public var clicks: Int
    public var scrolls: Int

    public init(keys: Int = 0, clicks: Int = 0, scrolls: Int = 0) {
      self.keys = keys
      self.clicks = clicks
      self.scrolls = scrolls
    }
  }

  public let rules: Rules
  /// The last capture or blocked attempt.
  public private(set) var lastServedAt: Double?
  private var lastViewChangeAt: Double?
  /// The last key press, click, scroll or page change.
  private var lastChangeAt: Double?
  private var lastKeyAt: Double?
  private var burstKeys = 0
  private var allowance: Double
  private var allowanceAt: Double?
  private var lastAnchorAt: Double?
  private var lastAnchorPlace: String?

  public init(rules: Rules = Rules()) {
    self.rules = rules
    allowance = rules.burst
  }

  /// Records one poll of the input counters, taken at `now`.
  public mutating func observe(_ input: Input, at now: Double) {
    if input.keys > 0 {
      if let lastKeyAt, now - lastKeyAt <= rules.typingGap {
        burstKeys += input.keys
      } else {
        burstKeys = input.keys
      }
      lastKeyAt = now
    }
    if input.keys + input.clicks + input.scrolls > 0 { lastChangeAt = now }
  }

  /// The app, title, site or path in front changed.
  public mutating func viewChanged(at now: Double) {
    lastViewChangeAt = now
    lastChangeAt = now
  }

  /// The capture due at `now`, if any.
  public mutating func due(at now: Double) -> CaptureTrigger? {
    let served = lastServedAt ?? -.infinity
    if now - served >= rules.fallback { return .timer }
    guard now - served >= rules.eventSpacing, refill(at: now) >= 1 else { return nil }
    if let view = lastViewChangeAt, view > served, now - view >= rules.viewHold { return .view }
    if let key = lastKeyAt, key > served, burstKeys >= rules.typingMinKeys, now - key >= rules.typingPause { return .typing }
    if let change = lastChangeAt, change > served, now - change >= rules.settle { return .settle }
    return nil
  }

  /// A capture was taken at `now`. Returns whether it is an anchor: every timer, wake and manual capture, and an
  /// event capture that is the first at a new app or site (`place`) or comes `anchorGap` after the last anchor.
  @discardableResult
  public mutating func captured(_ trigger: CaptureTrigger, place: String, at now: Double) -> Bool {
    lastServedAt = now
    if trigger.isEvent { allowance = refill(at: now) - 1 }
    let isAnchor =
      !trigger.isEvent || place != lastAnchorPlace || lastAnchorAt.map { now - $0 >= rules.anchorGap } ?? true
    if isAnchor {
      lastAnchorAt = now
      lastAnchorPlace = place
    }
    return isAnchor
  }

  /// The gate refused a capture at `now`.
  public mutating func blocked(at now: Double) {
    lastServedAt = now
  }

  private mutating func refill(at now: Double) -> Double {
    if let allowanceAt { allowance = min(rules.burst, allowance + (now - allowanceAt) * rules.perMinute / 60) }
    allowanceAt = now
    return allowance
  }
}
