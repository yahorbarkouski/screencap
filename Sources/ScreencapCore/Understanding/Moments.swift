import Foundation

/// Which screenshot stands for a stretch of captures.
public enum Moments {
  /// The app's own window is never in its frames, so a capture made while it was in front shows what was behind it.
  public static let ownBundleID = "com.screencaping.app"

  /// From the place the captures mostly happened at (their app, or their site), the screen that stayed up longest
  /// (the most unchanged captures after it), nearest the middle on a tie.
  public static func representative(among all: [Capture]) -> Capture? {
    let usable = all.filter { $0.context.bundleID != ownBundleID }
    let kept = usable.filter { !$0.isDuplicate && $0.framePath != nil }
    guard !kept.isEmpty else { return nil }
    let counts = Dictionary(grouping: usable, by: \.context.placeKey).mapValues(\.count)
    let main = counts.max { $0.value < $1.value }?.key
    let atMain = kept.filter { $0.context.placeKey == main }
    let pool = atMain.isEmpty ? kept : atMain
    let held = Dictionary(grouping: all.compactMap(\.duplicateOf), by: { $0 }).mapValues(\.count)
    let middle = Double(pool.count - 1) / 2
    return pool.enumerated().max { a, b in
      let (heldA, heldB) = (held[a.element.id] ?? 0, held[b.element.id] ?? 0)
      if heldA != heldB { return heldA < heldB }
      return abs(Double(a.offset) - middle) > abs(Double(b.offset) - middle)
    }?.element
  }
}
