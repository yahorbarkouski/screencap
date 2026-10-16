import Foundation

/// Finds secrets in screen text and window titles before they are stored, so they are never indexed, searched, shown
/// to an agent or sent to a model: API keys and tokens by their known shapes, private-key blocks, JSON web tokens,
/// long random-looking runs, Screencap's own recovery key, and card and bank account numbers that pass their check
/// digits. Each is replaced by `mask`. A frame whose text held one is never sent to a model (`hadSecret`).
public enum SecretScrubber {
  public static let mask = "[hidden]"

  /// Shapes that are secrets wherever they appear.
  nonisolated(unsafe) static let keyShapes: [Regex<Substring>] = [
    /sk-(?:or-v1-|proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_\-]{20,}/,
    /(?:AKIA|ASIA)[0-9A-Z]{16}/,
    /gh[pousr]_[A-Za-z0-9]{30,}/,
    /github_pat_[A-Za-z0-9_]{30,}/,
    /glpat-[A-Za-z0-9_\-]{20,}/,
    /xox[abposr]-[A-Za-z0-9\-]{10,}/,
    /AIza[0-9A-Za-z_\-]{35}/,
    /(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/,
    /npm_[A-Za-z0-9]{36}/,
    /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    // Screencap's recovery key: eight groups of eight hex digits.
    /(?:[0-9a-fA-F]{8}-){7}[0-9a-fA-F]{8}/,
    // 48 or more hex digits (a 64-digit secret key, a SHA-256), longer than a 40-digit commit hash.
    /\b[0-9a-fA-F]{48,}\b/,
  ]

  /// A run that could be a token; kept unless it looks random (`isRandom`).
  nonisolated(unsafe) static let run = /[A-Za-z0-9+\/=_\-]{32,}/
  /// 13 to 19 digits, maybe grouped by spaces or hyphens: a card number when the Luhn check passes.
  nonisolated(unsafe) static let digits = /\b\d(?:[ \-]?\d){12,18}\b/
  /// An IBAN: country, check digits and up to 30 letters and digits, maybe in groups of four.
  nonisolated(unsafe) static let iban = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/

  public static func scrub(_ text: String) -> (text: String, found: Bool) {
    guard text.count >= 13 else { return (text, false) }
    var result = text
    var found = false
    for shape in keyShapes where result.contains(shape) {
      result.replace(shape, with: mask)
      found = true
    }
    result.replace(run) { match in
      guard isRandom(match.output) else { return String(match.output) }
      found = true
      return mask
    }
    result.replace(digits) { match in
      guard luhn(match.output.filter(\.isNumber)) else { return String(match.output) }
      found = true
      return mask
    }
    result.replace(iban) { match in
      guard ibanChecks(match.output.filter { !$0.isWhitespace }) else { return String(match.output) }
      found = true
      return mask
    }
    return (result, found)
  }

  /// Whether text held a secret that was masked.
  public static func hadSecret(_ text: String) -> Bool { text.contains(mask) }

  /// Mixed case and digits with little of it in words: a token or a secret key. Names and paths are mostly words
  /// (`UnderstandingEngine`, `Settings2026`); in random base64 under a tenth of the characters fall in a run of four
  /// or more lowercase letters. Tuned on generated tokens: 98% of random 32-character ones are caught.
  static func isRandom(_ run: Substring) -> Bool {
    guard run.contains(where: \.isNumber), run.contains(where: \.isUppercase), run.contains(where: \.isLowercase) else { return false }
    let wordy = run.matches(of: /[A-Z]?[a-z]{4,}/).reduce(0) { $0 + $1.output.count }
    guard Double(wordy) < 0.4 * Double(run.count) else { return false }
    var counts: [Character: Int] = [:]
    for character in run { counts[character, default: 0] += 1 }
    let length = Double(run.count)
    let entropy = counts.values.reduce(0.0) { sum, count in
      let p = Double(count) / length
      return sum - p * log2(p)
    }
    return entropy >= 3.8
  }

  static func luhn(_ number: String) -> Bool {
    let values = number.reversed().compactMap(\.wholeNumberValue)
    guard (13...19).contains(values.count), Set(values).count > 1 else { return false }
    let sum = values.enumerated().reduce(0) { sum, item in
      guard item.offset % 2 == 1 else { return sum + item.element }
      let doubled = item.element * 2
      return sum + (doubled > 9 ? doubled - 9 : doubled)
    }
    return sum % 10 == 0
  }

  /// ISO 13616: the rearranged number, letters as 10 to 35, is 1 modulo 97.
  static func ibanChecks(_ iban: String) -> Bool {
    guard (15...34).contains(iban.count) else { return false }
    let rearranged = iban.dropFirst(4) + iban.prefix(4)
    var remainder = 0
    for character in rearranged {
      guard let value = character.wholeNumberValue ?? (character.isLetter ? Int(character.asciiValue ?? 0) - 55 : nil) else { return false }
      for digit in String(value) { remainder = (remainder * 10 + digit.wholeNumberValue!) % 97 }
    }
    return remainder == 1
  }
}

extension ForegroundContext {
  /// The title and the page path with secrets masked (a terminal's title can show a command with a key in it, a
  /// reset link carries a token in its path).
  public var scrubbed: ForegroundContext {
    var context = self
    context.windowTitle = windowTitle.map { SecretScrubber.scrub($0).text }
    context.urlPath = urlPath.map { SecretScrubber.scrub($0).text }
    return context
  }
}
