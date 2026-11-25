import Foundation

/// Groups a day for the canvas: per thread, the things it was about.
///
/// An activity is the wrong unit here. Every return to a task starts a new one, which is right on a timeline, so a
/// stream watched between other work is dozens of activities, each with a name of its own. On the canvas it is one
/// thing. A screenshot names the thing it shows, the way Resume's places do (a page's address, a Claude conversation,
/// a window); the time spent decides how fine a thing is kept. A page that held its thread long enough stands alone,
/// shorter pages fold into their site, and what was only passed through is one last group.
public struct CanvasGrouper: Sendable {
  /// A page stands alone from this long and this share of its thread's day; in a long thread, from `pageEnough`.
  static let pageSeconds = 150.0, pageShare = 0.1, pageEnough = 480.0
  /// A site made of shorter pages, likewise.
  static let siteSeconds = 90.0, siteShare = 0.06, siteEnough = 300.0
  /// A screenshot stands for the time until the next one in its activity, at most this long.
  static let cadence = 60.0
  /// A look away shorter than this does not end a visit.
  static let visitGap = 180.0
  /// Two screens closer than this are the same screen.
  static let sameScreenBits = 5
  static let maxShots = 48

  struct Label: Hashable {
    var place: String
    var title: String
  }

  /// What one screenshot shows, from finest to coarsest.
  struct Ref {
    var page: String
    var site: String
    var title: String
    var place: String
    var icon: CanvasIcon
  }

  struct Item {
    var capture: Capture
    var activity: Activity
    var seconds: Double
    var ref: Ref
  }

  public let names: SiteNames
  public let sessions: ClaudeSessionIndex
  /// Titles seen in so many threads that they tell nothing apart.
  private var common: Set<Label> = []

  /// `claude` is when Claude was in front and for which thread, so a conversation credited with many threads' time
  /// is known for a guess that says nothing.
  public init(seen: [SeenTitle], sessions: ClaudeSessionIndex, claude: [(at: Double, threadID: Int64)] = []) {
    names = SiteNames(seen)
    self.sessions = sessions
    var threads: [Label: Set<Int64>] = [:]
    for row in seen where row.bundleID != ClaudeSessionIndex.bundleID {
      guard let thread = row.threadID else { continue }
      let context = ForegroundContext(
        bundleID: row.bundleID, appName: row.appName, windowTitle: row.title, urlHost: row.host, urlPath: row.path)
      let ref = ref(context, at: 0)
      threads[Label(place: ref.place, title: ref.title), default: []].insert(thread)
    }
    for row in claude {
      let ref = ref(ForegroundContext(bundleID: ClaudeSessionIndex.bundleID, appName: "Claude"), at: row.at)
      threads[Label(place: ref.place, title: ref.title), default: []].insert(row.threadID)
    }
    common = Set(threads.filter { $0.value.count >= SiteNames.commonThreads }.keys)
  }

  // MARK: The day

  public func day(activities: [Activity], captures: [Capture], threads: [Int64: String], from start: Double, to end: Double) -> CanvasDay {
    let activities = activities.filter { $0.endAt > start && $0.startAt < end }.sorted { $0.startAt < $1.startAt }
    let captures = captures.filter { $0.isFocusedDisplay && $0.at >= start && $0.at < end }.sorted { $0.at < $1.at }
    var owned: [(capture: Capture, activity: Activity)] = []
    var next = 0
    var current: Activity?
    for capture in captures {
      while next < activities.count, activities[next].startAt <= capture.at {
        current = activities[next]
        next += 1
      }
      guard let activity = current, capture.at < activity.endAt, capture.context.bundleID != Moments.ownBundleID else { continue }
      owned.append((capture, activity))
    }
    var byThread: [Int64: [Item]] = [:]
    for (index, (capture, activity)) in owned.enumerated() {
      let follows = index + 1 < owned.count && owned[index + 1].activity.id == activity.id
      let until = follows ? owned[index + 1].capture.at : min(activity.endAt, end)
      let seconds = max(0, min(Self.cadence, until - capture.at))
      let item = Item(capture: capture, activity: activity, seconds: seconds, ref: ref(capture.context, at: capture.at))
      byThread[activity.threadID ?? 0, default: []].append(item)
    }
    var result = byThread.compactMap { id, items -> CanvasThread? in
      let things = self.things(items, thread: id == 0 ? "" : threads[id] ?? "")
      guard !things.isEmpty else { return nil }
      return CanvasThread(
        id: id, name: id == 0 ? "Not sorted yet" : threads[id] ?? "Thread", seconds: items.reduce(0) { $0 + $1.seconds }, things: things)
    }
    result.sort { $0.seconds == $1.seconds ? $0.id < $1.id : $0.seconds > $1.seconds }
    let first = owned.first?.capture.at ?? start
    let last = owned.last.map { min($0.activity.endAt, end) } ?? end
    return CanvasDay(threads: result, span: first...max(last, first + 60))
  }

  // MARK: Naming a screenshot

  func ref(_ context: ForegroundContext, at: Double) -> Ref {
    let bundle = context.bundleID ?? ""
    if PrivateWindows.browsers[bundle] != nil,
      let page = names.page(host: context.urlHost, path: context.urlPath, title: context.windowTitle, bundleID: bundle)
    {
      let address = ThingKey.address(host: page.host, path: page.path)
      let title = names.label(title: context.windowTitle, host: page.host, bundleID: bundle)
      return Ref(
        page: "url:" + address + (names.ambiguous.contains(address) ? "|" + title : ""), site: "site:" + page.host, title: title,
        place: names.name(page.host), icon: .site(page.host))
    }
    let app = names.stable(context.appName, bundleID: nil)
    let place = app.isEmpty ? bundle : app
    if bundle == ClaudeSessionIndex.bundleID, let session = sessions.session(at: at) {
      let title = [session.title, session.directoryName].first { !$0.isEmpty } ?? place
      return Ref(page: "claude:" + session.id, site: "app:" + bundle, title: title, place: place, icon: .app(bundle))
    }
    var title = names.stable(context.windowTitle, bundleID: bundle)
    if title.hasSuffix(" - " + place) { title = String(title.dropLast(place.count + 3)) }
    return Ref(
      page: "win:\(bundle)|\(title)", site: "app:" + bundle, title: title.isEmpty ? place : title, place: place, icon: .app(bundle))
  }

  // MARK: One thread's day

  private struct Group {
    var key: String
    var kind: CanvasThing.Kind
    var items: [Item] = []
    var seconds = 0.0
    var titles: [String: Double] = [:]
    var places: [String: Double] = [:]
    var icons: [CanvasIcon: Double] = [:]

    mutating func add(_ item: Item) {
      items.append(item)
      seconds += item.seconds
      titles[item.ref.title, default: 0] += item.seconds
      places[item.ref.place, default: 0] += item.seconds
      icons[item.ref.icon, default: 0] += item.seconds
    }

    var place: String { CanvasGrouper.most(places) ?? "" }
    var icon: CanvasIcon { icons.max { ($0.value, "\($1.key)") < ($1.value, "\($0.key)") }?.key ?? .app("") }
  }

  static func most(_ weights: [String: Double]) -> String? { weights.max { ($0.value, $1.key) < ($1.value, $0.key) }?.key }

  func things(_ items: [Item], thread: String) -> [CanvasThing] {
    let total = items.reduce(0) { $0 + $1.seconds }
    var pages: [String: Double] = [:]
    for item in items { pages[item.ref.page, default: 0] += item.seconds }
    let ownPages = Set(pages.filter { $0.value >= Self.pageSeconds && $0.value >= min(Self.pageEnough, Self.pageShare * total) }.keys)
    var sites: [String: Double] = [:]
    for item in items where !ownPages.contains(item.ref.page) { sites[item.ref.site, default: 0] += item.seconds }
    var ownSites = Set(sites.filter { $0.value >= Self.siteSeconds && $0.value >= min(Self.siteEnough, Self.siteShare * total) }.keys)
    if ownPages.isEmpty, ownSites.isEmpty, let main = Self.most(sites) { ownSites = [main] }

    var groups: [String: Group] = [:]
    var order: [String] = []
    for item in items {
      let (key, kind): (String, CanvasThing.Kind) =
        ownPages.contains(item.ref.page) ? (item.ref.page, .page) : ownSites.contains(item.ref.site) ? (item.ref.site, .site) : ("rest", .rest)
      if groups[key] == nil {
        groups[key] = Group(key: key, kind: kind)
        order.append(key)
      }
      groups[key]!.add(item)
    }

    // Things that end up with one name are one thing: a feed's home and its site, one game after another.
    var merged: [(group: Group, title: String, place: String)] = []
    var at: [[String]: Int] = [:]
    for key in order {
      let group = groups[key]!
      let (title, place) = name(group)
      let identity = group.kind == .rest ? ["rest"] : [title, place, "\(group.icon)"]
      if let index = at[identity] {
        for item in group.items { merged[index].group.add(item) }
        merged[index].group.items.sort { $0.capture.at < $1.capture.at }
      } else {
        at[identity] = merged.count
        merged.append((group, title, place))
      }
    }

    var spent: [Int64: Double] = [:]
    for item in items { spent[item.activity.id ?? 0, default: 0] += item.seconds }
    return merged.compactMap { group, title, place -> CanvasThing? in
      let shots = Self.shots(group.items)
      guard !shots.isEmpty else { return nil }
      let title = title.contains("…") && group.kind == .page ? activityName(group, spent) ?? title : title
      var words = Set(group.items.map { names.stable($0.capture.context.windowTitle, bundleID: $0.capture.context.bundleID) })
      words.formUnion(group.items.compactMap(\.activity.title))
      words.formUnion(group.places.keys)
      let bundles = group.items.reduce(into: [String: Double]()) { $0[$1.capture.context.bundleID ?? "", default: 0] += $1.seconds }
      return CanvasThing(
        id: group.key, kind: group.kind, title: title, place: place, icon: group.icon, bundleID: Self.most(bundles), seconds: group.seconds,
        visits: Self.visits(group.items), shots: shots, cover: Self.cover(shots, hashes: group.items),
        searchText: ([thread, title, place] + words.sorted()).joined(separator: "\n").lowercased())
    }
    .sorted { a, b in
      if (a.kind == .rest) != (b.kind == .rest) { return b.kind == .rest }
      return a.seconds == b.seconds ? a.id < b.id : a.seconds > b.seconds
    }
  }

  private func name(_ group: Group) -> (title: String, place: String) {
    let place = group.place
    var title: String
    switch group.kind {
    case .page: title = Self.most(group.titles) ?? place
    // One page under a site is that page; several are the site.
    case .site: title = group.titles.count == 1 ? group.titles.keys.first! : place
    case .rest:
      if group.places.count > 1 {
        let places = group.places.sorted { ($0.value, $1.key) > ($1.value, $0.key) }.map(\.key)
        return (places.prefix(3).joined(separator: ", ") + (places.count > 3 ? " and \(places.count - 3) more" : ""), "")
      }
      title = group.titles.count == 1 ? group.titles.keys.first! : place
    }
    // An app's account name or a feed's home says nothing: the place's own name does.
    if common.contains(Label(place: place, title: title)) { title = place }
    return (title, title.lowercased() == place.lowercased() ? "" : place)
  }

  /// Screencap's own name for the activities a thing filled, for a title the browser never showed whole.
  private func activityName(_ group: Group, _ spent: [Int64: Double]) -> String? {
    var mine: [Int64: (title: String, seconds: Double)] = [:]
    for item in group.items {
      guard let id = item.activity.id, let title = item.activity.title, !title.isEmpty else { continue }
      mine[id] = (title, (mine[id]?.seconds ?? 0) + item.seconds)
    }
    var titles: [String: Double] = [:]
    for (id, value) in mine where value.seconds >= 0.6 * (spent[id] ?? 0) { titles[value.title, default: 0] += value.seconds }
    return Self.most(titles)
  }

  // MARK: Screens and visits

  /// Distinct screens in order: each differs from the one before it, and a long stretch is thinned evenly.
  static func shots(_ items: [Item]) -> [CanvasShot] {
    var kept: [Item] = []
    for item in items where !item.capture.isDuplicate && item.capture.thumbPath != nil {
      if let last = kept.last, bits(item.capture.dHash, last.capture.dHash) < sameScreenBits { continue }
      kept.append(item)
    }
    if kept.count > maxShots {
      kept = (0..<maxShots).map { kept[Int((Double($0) * Double(kept.count - 1) / Double(maxShots - 1)).rounded())] }
    }
    return kept.map { item in
      let capture = item.capture
      return CanvasShot(
        captureID: capture.id, activityID: item.activity.id ?? 0, at: capture.at, thumbPath: capture.thumbPath!, framePath: capture.framePath,
        pixelWidth: capture.pixelWidth, pixelHeight: capture.pixelHeight, crop: capture.window.flatMap { $0.isWorthCropping ? $0 : nil })
    }
  }

  /// The most typical screen: the one closest to all the others.
  static func cover(_ shots: [CanvasShot], hashes items: [Item]) -> Int {
    guard shots.count >= 3 else { return 0 }
    let hash = Dictionary(items.map { ($0.capture.id, $0.capture.dHash) }) { first, _ in first }
    let pool = stride(from: 0, to: shots.count, by: max(1, shots.count / 24)).map { ($0, hash[shots[$0].captureID] ?? 0) }
    return pool.min { a, b in
      pool.reduce(0) { $0 + bits(a.1, $1.1) } < pool.reduce(0) { $0 + bits(b.1, $1.1) }
    }?.0 ?? 0
  }

  static func visits(_ items: [Item]) -> [ClosedRange<Double>] {
    var result: [ClosedRange<Double>] = []
    for item in items {
      let end = item.capture.at + item.seconds
      if let last = result.last, item.capture.at - last.upperBound <= visitGap {
        result[result.count - 1] = last.lowerBound...max(last.upperBound, end)
      } else {
        result.append(item.capture.at...end)
      }
    }
    return result
  }

  static func bits(_ a: Int64, _ b: Int64) -> Int { (a ^ b).nonzeroBitCount }
}
