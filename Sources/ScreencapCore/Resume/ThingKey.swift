import Foundation

/// How a place's key is spelled, and how two spellings of one place are told to be the same.
///
/// The rules live here, apart from the readers that use them, because both sides of the feature need them to
/// agree: the key written when a capture is bound and the key read off a tab open right now come from one place,
/// so they cannot drift.
public enum ThingKey {
  /// Paths are cut to this many segments, so every issue keeps its own key while the pages under it
  /// (`/issues/72/comments`, `/pull/1234/changes`) fold into the thing they belong to.
  public static let pathSegments = 4

  /// `host/path`: the host lowercased without `www.`, the path cut to `pathSegments`.
  ///
  /// The path keeps its case, because a path can be case-sensitive (`acme/Widgets`), and a query
  /// never reaches here: `ContextMonitor` records only the path.
  public static func address(host: String, path: String?) -> String {
    var host = host.lowercased()
    if host.hasPrefix("www.") { host.removeFirst(4) }
    let segments = (path ?? "").split(separator: "/").prefix(pathSegments)
    guard !segments.isEmpty else { return host }
    return host + "/" + segments.joined(separator: "/")
  }

  /// The key for a page's full address, so that a tab open right now can be matched against what was bound.
  public static func key(forURL text: String) -> String? {
    guard let url = URL(string: text), let host = url.host(), !host.isEmpty else { return nil }
    return "url:" + address(host: host, path: url.path())
  }

  /// The part of a page's key above its last path segment, or nil when there is nothing above it.
  ///
  /// A section is what a page belongs to when its own address has moved on: the episode after the one that was
  /// watched, the next item in a feed. It is only ever used to find an open page when the exact one is gone, and
  /// only when a single open page sits there, so nothing is guessed. A key with one segment (`x.com/home`) has no
  /// section, because its section would be the whole site.
  public static func section(of key: String) -> String? {
    guard key.hasPrefix("url:") else { return nil }
    let parts = key.dropFirst(4).split(separator: "/")
    guard parts.count >= 3 else { return nil }
    return "url:" + parts.dropLast().joined(separator: "/")
  }

  /// The part of a page's key above its last path segment, `url:streams.example` for `url:streams.example/channel`, so
  /// pages that stand in for each other can be told apart from pages that sit side by side. Nil for anything but a
  /// page with a path.
  public static func parent(of key: String) -> String? {
    guard key.hasPrefix("url:") else { return nil }
    let parts = key.dropFirst(4).split(separator: "/")
    guard parts.count >= 2 else { return nil }
    return "url:" + parts.dropLast().joined(separator: "/")
  }

  /// A page inside a frame on a generated host, such as a streaming site's extension overlay on
  /// `k3x9qa7m2p8w4z6t1v5b0n7c.ext-streams.example`: the browser reports it while the frame has focus, but it is
  /// never a place to go back to.
  public static func isGeneratedFrame(_ key: String) -> Bool {
    guard key.hasPrefix("url:"), let host = key.dropFirst(4).split(separator: "/").first else { return false }
    return host.split(separator: ".").contains { label in
      label.count >= 20 && label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
        && label.contains(where: \.isNumber) && label.contains(where: \.isLetter)
    }
  }

  /// Whether two window titles name the same window, allowing for one having been cut short.
  ///
  /// A window's title is read from the window server at capture time and from Accessibility when a resume looks
  /// for it, and the two do not always agree to the character: a browser writes "Main: Release notes for ve…" while
  /// a page is loading and lengthens it afterwards.
  public static func titlesMatch(_ left: String, _ right: String) -> Bool {
    let left = ForegroundContext.stableTitle(left)
    let right = ForegroundContext.stableTitle(right)
    if left == right { return true }
    let ellipsis = CharacterSet(charactersIn: "…...")
    let leftStem = left.trimmingCharacters(in: ellipsis)
    let rightStem = right.trimmingCharacters(in: ellipsis)
    guard leftStem.count >= 8, rightStem.count >= 8 else { return false }
    return leftStem.hasPrefix(rightStem) || rightStem.hasPrefix(leftStem)
  }
}
