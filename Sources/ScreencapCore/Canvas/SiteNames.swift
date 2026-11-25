import Foundation

/// One window title as it was seen: where, in which thread, and how often.
public struct SeenTitle: Sendable, Hashable {
  public var bundleID: String?
  public var appName: String?
  public var host: String?
  public var path: String?
  public var title: String
  public var threadID: Int64?
  public var count: Int

  public init(
    bundleID: String? = nil, appName: String? = nil, host: String? = nil, path: String? = nil, title: String,
    threadID: Int64? = nil, count: Int = 1
  ) {
    self.bundleID = bundleID
    self.appName = appName
    self.host = host
    self.path = path
    self.title = title
    self.threadID = threadID
    self.count = count
  }
}

/// What the window titles of the whole history say about the places they were seen at: what a site calls itself,
/// which hosts are frames inside another page, which addresses stand for many pages, and which titles are seen in so
/// many threads that they name nothing. Learned from the titles, so no site has a rule of its own.
public struct SiteNames: Sendable {
  public struct Page: Hashable, Sendable {
    public var host: String
    public var path: String
  }

  /// A site's name for itself, by host, where its titles show one.
  private var names: [String: String] = [:]
  /// Hosts of one domain, by domain.
  private var siblings: [String: Set<String>] = [:]
  /// The page most often seen under a title.
  private var pageOf: [String: Page] = [:]
  /// Titles a browser did not cut short, by host, longest first.
  private var whole: [String: [String]] = [:]
  /// Hosts whose titles are another host's: a frame that had the focus inside that host's page.
  private var frames: Set<String> = []
  /// Names of browser profiles that a browser writes in front of its window titles, by browser.
  private var profiles: [String: Set<String>] = [:]
  /// Addresses (`host/path`) that stand for many pages, such as a video player or a search.
  public private(set) var ambiguous: Set<String> = []

  /// A title in this many threads says nothing about any of them.
  static let commonThreads = 6

  public init() {}

  public init(_ seen: [SeenTitle]) {
    learnProfiles(seen)
    var pages: [String: [Page: Int]] = [:]
    var titles: [String: Set<String>] = [:]
    var perTitleHost: [String: [String: Int]] = [:]
    for row in seen {
      guard let raw = row.host, !raw.isEmpty else { continue }
      let host = Self.bare(raw)
      let title = stable(row.title, bundleID: row.bundleID)
      guard !title.isEmpty else { continue }
      perTitleHost[title, default: [:]][host, default: 0] += row.count
      guard !Self.isGeneratedFrame(host) else { continue }
      pages[title, default: [:]][Page(host: host, path: row.path ?? ""), default: 0] += row.count
      titles[host, default: []].insert(title)
    }
    // A host seen nearly only under the titles of a host seen more than it is a frame in that host's pages. Its
    // captures are weighed rather than its titles: a frame can have the focus whenever one page is open.
    let totals = perTitleHost.values.reduce(into: [String: Int]()) { $0.merge($1, uniquingKeysWith: +) }
    for (host, own) in titles where Self.domain(host) != host {
      let (mine, total) = own.reduce(into: (0, 0)) { sums, title in
        let counts = perTitleHost[title] ?? [:]
        sums.1 += counts[host] ?? 0
        if counts.keys.contains(where: { !Self.isGeneratedFrame($0) && totals[$0]! > totals[host]! }) { sums.0 += counts[host] ?? 0 }
      }
      if total >= 3, Double(mine) >= 0.8 * Double(total) { frames.insert(host) }
    }
    for host in frames { titles[host] = nil }
    for (title, counts) in pages {
      let real = counts.filter { !frames.contains($0.key.host) }
      pageOf[title] = real.max { ($0.value, $1.key.path) < ($1.value, $0.key.path) }?.key
    }
    for (host, own) in titles {
      whole[host] = own.filter { !$0.contains("…") }.sorted { ($0.count, $1) > ($1.count, $0) }
      let domain = Self.domain(host)
      if host != domain, !Self.hosting.contains(domain) { siblings[domain, default: []].insert(host) }
      names[host] = Self.ownName(host: host, titles: own)
    }
    learnAmbiguous(seen)
  }

  // MARK: Names

  /// What to call a site: its own name for itself, else its domain, with the part before it for a company that keeps
  /// several places under one domain (`docs.`, `meet.`).
  public func name(_ host: String) -> String {
    if let own = names[host] { return own }
    let core = Self.core(host)
    guard core != "localhost" else { return core }
    var name = (core.prefix(1).uppercased() + core.dropFirst()).replacingOccurrences(of: "-", with: " ")
    let labels = host.split(separator: ".")
    if let first = labels.first, labels.count == 3, !Self.secondLevel.contains(String(labels[1])), first.count > 3,
      !Self.hosting.contains(Self.domain(host)), (siblings[Self.domain(host)]?.count ?? 0) >= 3
    {
      name += " " + first.prefix(1).uppercased() + first.dropFirst()
    }
    return name
  }

  /// The page an address stands for: a frame's address stands for the page seen under the same window title, and a
  /// browser window whose address was not read for the page its title belongs to. Nil when nothing says which page.
  public func page(host: String?, path: String?, title: String?, bundleID: String?) -> Page? {
    let known = pageOf[stable(title, bundleID: bundleID)]
    guard let host, !host.isEmpty else { return known }
    let bare = Self.bare(host)
    guard bare.contains(".") || bare.hasPrefix("localhost") else { return known }
    if Self.isGeneratedFrame(bare) || frames.contains(bare) {
      return known ?? Page(host: Self.domain(bare), path: "")
    }
    return Page(host: bare, path: path ?? "")
  }

  /// A window title without what changes while the place stays the same: unread counters, the browser profile.
  public func stable(_ title: String?, bundleID: String?) -> String {
    guard let title else { return "" }
    var text = String(title.unicodeScalars.filter { !Self.invisible.contains($0) })
    if let bundleID, let own = profiles[bundleID], let colon = text.range(of: ": "), own.contains(String(text[..<colon.lowerBound])) {
      text = String(text[colon.upperBound...])
    }
    if text.first == "[" || text.first == "(" || text.first == " " || text.contains(" new item") {
      text = ForegroundContext.stableTitle(text.trimmingCharacters(in: .whitespaces))
    }
    return text.trimmingCharacters(in: .whitespaces)
  }

  /// A page's title without its site's name, filled in from another screenshot where the browser cut it short.
  public func label(title: String?, host: String, bundleID: String?) -> String {
    var text = stable(title, bundleID: bundleID)
    if let cut = text.range(of: "…") {
      let stem = text[..<cut.lowerBound]
      if stem.count >= 10, let full = whole[host]?.first(where: { $0.hasPrefix(stem) }) { text = full }
    }
    let name = name(host)
    let own = [name, Self.core(host), host].map(Self.squash)
    let parts = TitleParts(text)
    if parts.texts.count > 1 {
      let last = Self.squash(parts.texts[parts.texts.count - 1])
      let first = Self.squash(parts.texts[0])
      if !last.isEmpty, own.contains(last) || (last.count >= 3 && own[0].hasPrefix(last)) {
        text = parts.dropping(last: true)
      } else if !first.isEmpty, own.contains(first) {
        text = parts.dropping(last: false)
      }
    }
    // What is left of the site's name after the browser cut the title: "channel - Str…" is the channel.
    if text.contains("…") {
      let parts = TitleParts(text)
      if parts.texts.count > 1 {
        let tail = Self.squash(parts.texts[parts.texts.count - 1])
        if tail.isEmpty || own[0].hasPrefix(tail) { text = parts.dropping(last: true) }
      }
    }
    return text.isEmpty ? name : text
  }

  // MARK: Learning

  /// A browser that writes its profile's name in front of every title ("Main: …") shows the same few words there over
  /// and over; a page's own colon does not.
  private mutating func learnProfiles(_ seen: [SeenTitle]) {
    var titles: [String: Set<String>] = [:]
    var prefixes: [String: [String: Set<String>]] = [:]
    for row in seen {
      guard let bundleID = row.bundleID, PrivateWindows.browsers[bundleID] != nil else { continue }
      titles[bundleID, default: []].insert(row.title)
      guard let colon = row.title.range(of: ": ") else { continue }
      let prefix = String(row.title[..<colon.lowerBound])
      if prefix.count <= 24 { prefixes[bundleID, default: [:]][prefix, default: []].insert(row.title) }
    }
    for (bundleID, found) in prefixes {
      let all = Double(titles[bundleID]?.count ?? 0)
      profiles[bundleID] = Set(found.filter { $0.value.count >= 12 && Double($0.value.count) >= 0.1 * all }.keys)
    }
  }

  private mutating func learnAmbiguous(_ seen: [SeenTitle]) {
    var titles: [String: Set<String>] = [:]
    var counts: [String: Int] = [:]
    for row in seen {
      guard let raw = row.host else { continue }
      let host = Self.bare(raw)
      guard !Self.isGeneratedFrame(host), !frames.contains(host) else { continue }
      let address = ThingKey.address(host: host, path: row.path)
      guard address != host else { continue }
      titles[address, default: []].insert(String(stable(row.title, bundleID: row.bundleID).prefix(40)))
      counts[address, default: 0] += row.count
    }
    ambiguous = Set(titles.filter { $0.value.count >= 8 && Double(counts[$0.key] ?? 0) / Double($0.value.count) < 12 }.keys)
  }

  /// The ending a site's titles share, when it reads like the site's domain ("… - Streams" on streams.example).
  static func ownName(host: String, titles: Set<String>) -> String? {
    let core = squash(core(host))
    guard !core.isEmpty else { return nil }
    var tails: [String: Int] = [:]
    for title in titles {
      let parts = TitleParts(title).texts
      if parts.count > 1 {
        tails[parts[parts.count - 1], default: 0] += 1
        tails[parts[0], default: 0] += 0
      } else {
        tails[title, default: 0] += 0
      }
    }
    return tails.sorted { ($0.value, $1.key) > ($1.value, $0.key) }.prefix(6).first { tail, count in
      guard !tail.isEmpty, tail.count <= 28, !tail.contains("…") else { return false }
      let text = squash(tail)
      return text == core || (count >= 2 && text.count > 1 && text.contains(core))
    }?.key
  }

  // MARK: Hosts

  static let invisible: Set<Unicode.Scalar> = Set((0x200B...0x200F).compactMap(Unicode.Scalar.init)).union((0x202A...0x202E).compactMap(Unicode.Scalar.init))
  /// Domains that host other people's sites, where the part before the domain is the site.
  static let hosting: Set<String> = [
    "vercel.app", "netlify.app", "github.io", "pages.dev", "workers.dev", "web.app", "fly.dev", "onrender.com", "herokuapp.com", "modal.run",
  ]
  static let secondLevel: Set<String> = ["co", "com", "org", "gov", "ac", "net"]

  static func bare(_ host: String) -> String {
    let lower = host.lowercased()
    return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
  }

  static func domain(_ host: String) -> String {
    let labels = host.split(separator: ".")
    guard labels.count > 2 else { return host }
    return labels.suffix(secondLevel.contains(String(labels[labels.count - 2])) ? 3 : 2).joined(separator: ".")
  }

  /// The word a site is known by in its host.
  static func core(_ host: String) -> String {
    if host.hasPrefix("localhost") || host.hasPrefix("[") || host.allSatisfy({ $0.isNumber || $0 == "." || $0 == ":" }) { return "localhost" }
    let labels = host.split(separator: ".").map(String.init)
    guard labels.count >= 2 else { return host }
    let domain = domain(host)
    if hosting.contains(domain), labels.count > 2 { return labels[labels.count - 3] }
    return String(domain.split(separator: ".")[0])
  }

  /// A frame on a generated host, or a browser extension's own page.
  static func isGeneratedFrame(_ host: String) -> Bool {
    if ThingKey.isGeneratedFrame("url:" + host) { return true }
    if host.count == 32, host.allSatisfy({ ("a"..."p").contains($0) }) { return true }
    return host.split(separator: ".").contains { UUID(uuidString: String($0)) != nil }
  }

  static func squash(_ text: String) -> String {
    String(text.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) })
  }
}

/// A title cut at the marks sites put between a page and themselves: " - ", " | ", " · ".
struct TitleParts {
  private let text: String
  private(set) var ranges: [Range<String.Index>] = []

  init(_ text: String) {
    self.text = text
    var start = text.startIndex
    var index = text.startIndex
    while index < text.endIndex {
      let next = text.index(after: index)
      if Self.marks.contains(text[index]) {
        let spaced = index > text.startIndex && text[text.index(before: index)] == " " && (next == text.endIndex || text[next] == " " || text[next] == "…")
        if spaced || text[index] == "|" {
          ranges.append(start..<index)
          start = next
        }
      }
      index = next
    }
    ranges.append(start..<text.endIndex)
  }

  static let marks: Set<Character> = ["-", "–", "—", "|", "·", "•", "/"]

  var texts: [String] { ranges.map { text[$0].trimmingCharacters(in: .whitespaces) } }

  /// The title without its last (else its first) part.
  func dropping(last: Bool) -> String {
    guard ranges.count > 1 else { return text }
    let rest = last ? text[..<ranges[ranges.count - 2].upperBound] : text[ranges[1].lowerBound...]
    return rest.trimmingCharacters(in: CharacterSet(charactersIn: " -–—|·•/"))
  }
}
