import Foundation

/// A capture with its OCR lines: everything the questions read about one moment.
public struct CaptureEvidence: Sendable, Hashable {
  public var capture: Capture
  public var lines: [OCRLine]

  public init(capture: Capture, lines: [OCRLine]) {
    self.capture = capture
    self.lines = lines
  }
}

/// The text renderings of captures that the decision and text models read.
///
/// These match the design experiments' `evidence.py` (`line`, `wline`, `ocr_text`, `ocr_new`), so the app's
/// questions see the same evidence the measured results came from.
public enum CaptureText {
  /// Lines above this normalized y are the menu bar.
  static let menuBarHeight = 0.035

  /// OCR lines in reading order, without the menu bar and fragments of two characters or fewer.
  public static func readingOrder(_ lines: [OCRLine]) -> [String] {
    lines
      .filter { $0.y > menuBarHeight && $0.text.trimmingCharacters(in: .whitespaces).count > 2 }
      .sorted { a, b in
        let ya = (a.y * 100).rounded() / 100
        let yb = (b.y * 100).rounded() / 100
        return ya == yb ? a.x < b.x : ya < yb
      }
      .map { $0.text.trimmingCharacters(in: .whitespaces) }
  }

  /// The first `limit` characters of the screen text in reading order.
  public static func excerpt(_ lines: [OCRLine], limit: Int) -> String {
    String(readingOrder(lines).joined(separator: " · ").prefix(limit))
  }

  /// Screen lines whose words were mostly absent from the previous capture: what changed, which is the boundary
  /// signal. Matching on words makes OCR jitter in tab strips and sidebars count as unchanged.
  public static func newText(_ lines: [OCRLine], previous: [OCRLine]?, limit: Int = 220) -> String {
    let seen = Set((previous.map(readingOrder) ?? []).flatMap(tokens))
    let fresh = readingOrder(lines).filter { line in
      let words = tokens(line)
      guard !words.isEmpty else { return false }
      return Double(words.filter(seen.contains).count) / Double(words.count) < 0.5
    }
    return fresh.isEmpty ? "(no new text)" : String(fresh.joined(separator: " · ").prefix(limit))
  }

  static func tokens(_ text: String) -> [String] {
    text.lowercased().matches(of: /\w+/).map { String($0.output) }.filter { $0.count >= 3 }
  }

  /// `14:06 | Cursor | ferris-notes — src/main.rs | - | new text: …`, the boundary window's line.
  public static func windowLine(_ evidence: CaptureEvidence, previous: CaptureEvidence?, clock: TimeFormatter) -> String {
    let c = evidence.capture
    let title = String((c.context.windowTitle ?? "").replacingOccurrences(of: "\n", with: " ").prefix(100))
    return
      "\(clock.hourMinute(c.at)) | \(c.context.appName ?? "?") | \(title) | \(c.context.urlHost ?? "-") | new text: \(newText(evidence.lines, previous: previous?.lines))"
  }

  /// `[14:06] Cursor — title — host` plus an optional screen-text line, the activity evidence line.
  public static func activityLine(_ evidence: CaptureEvidence, ocrLimit: Int, clock: TimeFormatter) -> String {
    let c = evidence.capture
    let title = String((c.context.windowTitle ?? "").replacingOccurrences(of: "\n", with: " ").prefix(120))
    var line = "[\(clock.hourMinute(c.at))] \(c.context.appName ?? "?") — \(title)"
    if let host = c.context.urlHost, !host.isEmpty { line += " — \(host)" }
    if ocrLimit > 0 { line += "\n  Screen text: \(excerpt(evidence.lines, limit: ocrLimit))" }
    return line
  }
}

/// Local wall-clock formatting of capture times.
public struct TimeFormatter: Sendable {
  public var timeZone: TimeZone

  public init(timeZone: TimeZone = .current) {
    self.timeZone = timeZone
  }

  public func hourMinute(_ at: Double) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: at))
    return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
  }

  public func hourMinuteSecond(_ at: Double) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.hour, .minute, .second], from: Date(timeIntervalSince1970: at))
    return String(format: "%02d:%02d:%02d", parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0)
  }

  public func day(_ at: Double) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: at))
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }
}
