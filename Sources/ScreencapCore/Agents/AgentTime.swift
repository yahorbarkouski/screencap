import Foundation

/// How the agent tools read and write times: local wall-clock time in one time zone, `YYYY-MM-DD HH:MM:SS` for a
/// moment and `YYYY-MM-DD HH:MM–HH:MM` for a span.
public struct AgentTime: Sendable {
  public let timeZone: TimeZone
  let calendar: Calendar

  public init(timeZone: TimeZone = .current) {
    self.timeZone = timeZone
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    self.calendar = calendar
  }

  // MARK: Reading

  /// A time as an agent writes it: `now`, `today`, `yesterday`, `YYYY-MM-DD`, or a date with a time
  /// (`HH:MM` or `HH:MM:SS`, after a space or `T`), optionally with an offset (`Z`, `+02:00`). A date alone is
  /// its midnight. Nil when the text is none of these.
  public func moment(_ text: String, now: Double) -> Double? {
    let trimmed = text.trimmingCharacters(in: .whitespaces).lowercased()
    switch trimmed {
    case "now": return now
    case "today": return startOfDay(now)
    case "yesterday": return calendar.date(byAdding: .day, value: -1, to: Date(timeIntervalSince1970: startOfDay(now)))?.timeIntervalSince1970
    default: break
    }
    let pattern = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(z|[+-]\d{2}:?\d{2})?$/
    guard let match = trimmed.wholeMatch(of: pattern) else { return nil }
    var parts = DateComponents()
    parts.year = Int(match.1)
    parts.month = Int(match.2)
    parts.day = Int(match.3)
    parts.hour = match.4.flatMap { Int($0) } ?? 0
    parts.minute = match.5.flatMap { Int($0) } ?? 0
    parts.second = match.6.flatMap { Int($0) } ?? 0
    var zoned = calendar
    if let offset = match.7.map(String.init) {
      zoned.timeZone = Self.zone(offset) ?? timeZone
    }
    guard let month = parts.month, (1...12).contains(month), let day = parts.day, (1...31).contains(day),
      (0...23).contains(parts.hour ?? 0), (0...59).contains(parts.minute ?? 0), (0...59).contains(parts.second ?? 0),
      let date = zoned.date(from: parts), zoned.component(.day, from: date) == day
    else { return nil }
    return date.timeIntervalSince1970
  }

  /// Whether `text` names a whole day (`today`, `yesterday` or a date with no time).
  public func isDay(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespaces).lowercased()
    return ["today", "yesterday"].contains(trimmed) || trimmed.wholeMatch(of: /^\d{4}-\d{2}-\d{2}$/) != nil
  }

  static func zone(_ offset: String) -> TimeZone? {
    if offset == "z" { return TimeZone(secondsFromGMT: 0) }
    let digits = offset.dropFirst().filter(\.isNumber)
    guard digits.count == 4, let hours = Int(digits.prefix(2)), let minutes = Int(digits.suffix(2)) else { return nil }
    let seconds = (hours * 3600 + minutes * 60) * (offset.hasPrefix("-") ? -1 : 1)
    return TimeZone(secondsFromGMT: seconds)
  }

  public func startOfDay(_ at: Double) -> Double {
    calendar.startOfDay(for: Date(timeIntervalSince1970: at)).timeIntervalSince1970
  }

  /// The start of the day after the one holding `at` (23 or 25 hours later on a daylight-saving change).
  public func startOfNextDay(_ at: Double) -> Double {
    calendar.date(byAdding: .day, value: 1, to: Date(timeIntervalSince1970: startOfDay(at)))!.timeIntervalSince1970
  }

  public func days(before at: Double, _ count: Int) -> Double {
    calendar.date(byAdding: .day, value: -count, to: Date(timeIntervalSince1970: startOfDay(at)))!.timeIntervalSince1970
  }

  // MARK: Writing

  public func date(_ at: Double) -> String {
    let p = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: at))
    return String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
  }

  public func clock(_ at: Double) -> String {
    let p = calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: at))
    return String(format: "%02d:%02d", p.hour ?? 0, p.minute ?? 0)
  }

  /// `2026-10-15 14:05:12`: a moment, which `screenshot` takes back.
  public func moment(_ at: Double) -> String {
    let p = calendar.dateComponents([.second], from: Date(timeIntervalSince1970: at))
    return "\(date(at)) \(clock(at)):\(String(format: "%02d", p.second ?? 0))"
  }

  /// `2026-10-15 14:05`.
  public func minute(_ at: Double) -> String { "\(date(at)) \(clock(at))" }

  /// `2026-10-15 14:05–14:30`, with the end's date too when it falls on another day; `14:05–14:30` without dates.
  public func span(_ start: Double, _ end: Double, withDate: Bool = true) -> String {
    let sameDay = date(start) == date(max(start, end - 1))
    guard withDate else { return "\(clock(start))–\(clock(end))" }
    return sameDay ? "\(minute(start))–\(clock(end))" : "\(minute(start))–\(minute(end))"
  }

  public func weekday(_ at: Double) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "EEEE"
    return formatter.string(from: Date(timeIntervalSince1970: at))
  }

  /// `America/Los_Angeles (UTC-07:00)`.
  public func zoneName(at: Double) -> String {
    let seconds = timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: at))
    let sign = seconds < 0 ? "-" : "+"
    return String(format: "%@ (UTC%@%02d:%02d)", timeZone.identifier, sign, abs(seconds) / 3600, abs(seconds) % 3600 / 60)
  }
}
