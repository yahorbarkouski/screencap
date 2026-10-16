import CoreGraphics
import Foundation
import GRDB

/// A made-up yesterday for screenshots of the app (the README's): seven threads of an imagined person's day spent on
/// public web pages (Wikipedia, Apple's documentation, GitHub, the Rust book, NASA, Hacker News, OpenStreetMap), with
/// the switches a real day has. Each frame is a page captured from the web (`scripts/capture-pages.sh`), drawn in a
/// browser window by the caller (`render`), and its text is left for the OCR helper to read, so search finds and marks
/// words on it. Nothing in it comes from anyone's own screen.
public enum DemoStore {
  /// The meta key every made-up store carries.
  public static let mark = "demo-store"

  public struct Page: Sendable, Hashable {
    public let key: String
    public let url: String
    public let title: String
  }

  /// One frame to draw: a page in the browser window.
  public struct Scene: Hashable, Sendable {
    public let page: Page
  }

  public static let browser = (bundleID: "com.apple.Safari", name: "Safari")
  /// Where the browser window sits on the screen.
  public static let window = ScreenRect(x: 0.11, y: 0.075, width: 0.78, height: 0.81)

  public static let pages: [String: Page] = Dictionary(uniqueKeysWithValues: [
    Page(key: "hn-front", url: "https://news.ycombinator.com/", title: "Hacker News"),
    Page(key: "hn-best", url: "https://news.ycombinator.com/best", title: "Top Links | Hacker News"),
    Page(key: "apple-swiftui", url: "https://developer.apple.com/documentation/swiftui", title: "SwiftUI | Apple Developer Documentation"),
    Page(key: "apple-hig", url: "https://developer.apple.com/design/human-interface-guidelines/", title: "Human Interface Guidelines | Apple Developer Documentation"),
    Page(key: "apple-xcode", url: "https://developer.apple.com/xcode/", title: "Xcode - Apple Developer"),
    Page(key: "apple-list", url: "https://developer.apple.com/documentation/swiftui/list", title: "List | Apple Developer Documentation"),
    Page(key: "gh-collections", url: "https://github.com/apple/swift-collections", title: "apple/swift-collections"),
    Page(key: "rust-ownership", url: "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html", title: "What Is Ownership? - The Rust Programming Language"),
    Page(key: "rust-borrowing", url: "https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html", title: "References and Borrowing - The Rust Programming Language"),
    Page(key: "rust-slices", url: "https://doc.rust-lang.org/book/ch04-03-slices.html", title: "The Slice Type - The Rust Programming Language"),
    Page(key: "wiki-kyoto", url: "https://en.wikipedia.org/wiki/Kyoto", title: "Kyoto - Wikipedia"),
    Page(key: "wiki-fushimi", url: "https://en.wikipedia.org/wiki/Fushimi_Inari-taisha", title: "Fushimi Inari-taisha - Wikipedia"),
    Page(key: "wiki-kinkakuji", url: "https://en.wikipedia.org/wiki/Kinkaku-ji", title: "Kinkaku-ji - Wikipedia"),
    Page(key: "osm-kyoto", url: "https://www.openstreetmap.org/export/embed.html?bbox=135.755,34.985,135.795,35.010&layer=mapnik", title: "OpenStreetMap"),
    Page(key: "nasa-iotd", url: "https://www.nasa.gov/image-of-the-day/", title: "Image of the Day - NASA"),
    Page(key: "nasa-webb", url: "https://science.nasa.gov/mission/webb/", title: "Webb - NASA Science"),
    Page(key: "wiki-ramen", url: "https://en.wikipedia.org/wiki/Ramen", title: "Ramen - Wikipedia"),
    Page(key: "wiki-okonomiyaki", url: "https://en.wikipedia.org/wiki/Okonomiyaki", title: "Okonomiyaki - Wikipedia"),
  ].map { ($0.key, $0) })

  struct Thread {
    let name: String
    let summary: String
    let category: ActivityCategory
    /// The page a person would recognise the thread by, for its cover.
    let hero: String
  }

  static let threads = [
    Thread(name: "SwiftUI side project", summary: "Building a small SwiftUI app: lists, navigation and state.", category: .work, hero: "apple-hig"),
    Thread(name: "Kyoto trip", summary: "Planning a week in Kyoto: temples, neighbourhoods and walking routes.", category: .chores, hero: "wiki-kyoto"),
    Thread(name: "Rust book", summary: "Working through the Rust book's chapters on ownership.", category: .study, hero: "rust-ownership"),
    Thread(name: "Hacker News", summary: "Reading the Hacker News front page.", category: .leisure, hero: "hn-front"),
    Thread(name: "Space pictures", summary: "NASA's image of the day and Webb telescope pictures.", category: .leisure, hero: "nasa-iotd"),
    Thread(name: "swift-collections", summary: "Reading and triaging the swift-collections repository.", category: .work, hero: "gh-collections"),
    Thread(name: "Dinner ideas", summary: "Japanese dishes to cook this week.", category: .chores, hero: "wiki-ramen"),
  ]

  /// One stretch on one page: its thread, its length, and what the person did.
  struct Visit {
    let thread: Int
    let page: String
    let minutes: Double
    let title: String
    let caption: String
  }

  /// The day, as runs of visits from a start time (hours and minutes); the gaps between runs are breaks.
  static let plan: [(start: (Int, Int), visits: [Visit])] = [
    ((8, 52), [
      Visit(thread: 3, page: "hn-front", minutes: 9, title: "Morning front page", caption: "Read the Hacker News front page over coffee."),
      Visit(thread: 3, page: "hn-best", minutes: 7, title: "Best of the week", caption: "Skimmed the week's best Hacker News stories."),
    ]),
    ((9, 8), [
      Visit(thread: 0, page: "apple-swiftui", minutes: 13, title: "How views compose", caption: "Looked up how SwiftUI views compose for the side project."),
      Visit(thread: 0, page: "apple-list", minutes: 9, title: "List and sections", caption: "Read how List builds sections and swipe actions."),
      Visit(thread: 3, page: "hn-front", minutes: 2, title: "Front page check", caption: "Checked the Hacker News front page."),
      Visit(thread: 0, page: "apple-hig", minutes: 20, title: "Design guidelines", caption: "Read Apple's design guidelines on lists and navigation."),
      Visit(thread: 1, page: "osm-kyoto", minutes: 4, title: "Map of Gion", caption: "Looked at the map around Gion for the trip."),
      Visit(thread: 0, page: "apple-list", minutes: 11, title: "Swipe actions", caption: "Added swipe actions to the side project's list."),
      Visit(thread: 3, page: "hn-front", minutes: 3, title: "Front page check", caption: "Checked the Hacker News front page."),
      Visit(thread: 0, page: "apple-swiftui", minutes: 10, title: "State and bindings", caption: "Read about state and bindings to fix a view that did not update."),
      Visit(thread: 5, page: "gh-collections", minutes: 12, title: "Deque for the queue", caption: "Read the swift-collections README for a deque."),
      Visit(thread: 5, page: "gh-collections", minutes: 14, title: "Open issues", caption: "Went through the repository's open issues."),
    ]),
    ((11, 18), [
      Visit(thread: 2, page: "rust-ownership", minutes: 21, title: "Ownership chapter", caption: "Read the Rust book's chapter on ownership."),
      Visit(thread: 4, page: "nasa-iotd", minutes: 3, title: "Image of the day", caption: "Looked at NASA's image of the day."),
      Visit(thread: 2, page: "rust-borrowing", minutes: 24, title: "References and borrowing", caption: "Worked through references and borrowing."),
      Visit(thread: 3, page: "hn-front", minutes: 2, title: "Front page check", caption: "Checked the Hacker News front page."),
      Visit(thread: 2, page: "rust-slices", minutes: 12, title: "Slices", caption: "Read about string slices."),
    ]),
    ((13, 21), [
      Visit(thread: 1, page: "wiki-kyoto", minutes: 26, title: "Kyoto districts", caption: "Read about Kyoto's districts and temples."),
      Visit(thread: 1, page: "wiki-fushimi", minutes: 22, title: "Fushimi Inari", caption: "Read up on the torii trail at Fushimi Inari."),
      Visit(thread: 1, page: "wiki-kinkakuji", minutes: 18, title: "Golden Pavilion", caption: "Read about Kinkaku-ji and when it opens."),
      Visit(thread: 1, page: "osm-kyoto", minutes: 8, title: "Temple walk", caption: "Planned a walking route between the temples."),
      Visit(thread: 0, page: "apple-xcode", minutes: 15, title: "Xcode previews", caption: "Read about Xcode previews to speed up the side project."),
      Visit(thread: 1, page: "wiki-fushimi", minutes: 3, title: "Best time to visit", caption: "Checked the best time to visit Fushimi Inari."),
      Visit(thread: 0, page: "apple-swiftui", minutes: 18, title: "Layout", caption: "Read about stacks and layout priority."),
      Visit(thread: 4, page: "nasa-webb", minutes: 4, title: "Webb pictures", caption: "Browsed Webb telescope pictures."),
      Visit(thread: 0, page: "apple-list", minutes: 12, title: "List performance", caption: "Looked into a slow list with many rows."),
      Visit(thread: 3, page: "hn-best", minutes: 2, title: "Best of the week", caption: "Skimmed the week's best stories."),
      Visit(thread: 5, page: "gh-collections", minutes: 9, title: "Deque API", caption: "Checked the Deque API for the side project."),
    ]),
    ((15, 58), [
      Visit(thread: 2, page: "rust-borrowing", minutes: 19, title: "Borrowing exercises", caption: "Did the borrowing exercises."),
      Visit(thread: 3, page: "hn-front", minutes: 3, title: "Front page check", caption: "Checked the Hacker News front page."),
      Visit(thread: 2, page: "rust-slices", minutes: 21, title: "Slice exercises", caption: "Did the slice exercises."),
      Visit(thread: 2, page: "rust-ownership", minutes: 8, title: "Ownership review", caption: "Reviewed the ownership rules."),
      Visit(thread: 1, page: "wiki-kyoto", minutes: 10, title: "Where to stay", caption: "Compared neighbourhoods to stay in."),
      Visit(thread: 1, page: "osm-kyoto", minutes: 6, title: "Hotels near Gion", caption: "Looked for hotels near Gion on the map."),
      Visit(thread: 4, page: "nasa-iotd", minutes: 12, title: "Image of the day", caption: "Read the story behind NASA's image of the day."),
      Visit(thread: 4, page: "nasa-webb", minutes: 14, title: "Webb deep field", caption: "Looked through Webb's deep-field images."),
      Visit(thread: 6, page: "wiki-ramen", minutes: 9, title: "Ramen styles", caption: "Read about ramen styles for dinner."),
      Visit(thread: 6, page: "wiki-okonomiyaki", minutes: 8, title: "Okonomiyaki", caption: "Read how okonomiyaki is made."),
      Visit(thread: 3, page: "hn-front", minutes: 4, title: "Front page check", caption: "Checked the Hacker News front page."),
    ]),
    ((18, 24), [
      Visit(thread: 3, page: "hn-best", minutes: 11, title: "Evening reading", caption: "Read the best Hacker News stories."),
      Visit(thread: 1, page: "wiki-kinkakuji", minutes: 12, title: "Northern temples", caption: "Read about the temples north of the centre."),
      Visit(thread: 1, page: "osm-kyoto", minutes: 16, title: "Day-by-day plan", caption: "Laid out the trip day by day on the map."),
    ]),
  ]

  public struct Result: Sendable {
    public let day: Date
    /// Kept frames of each thread's recognisable page, for its cover.
    public let heroCaptures: Set<String>
    public let threadIDs: [Int64]
  }

  /// Fills `database` (an empty store at `location`) with the made-up yesterday.
  public static func build(database: AppDatabase, location: StoreLocation, render: (Scene) throws -> CGImage) throws -> Result {
    let calendar = Calendar.current
    let day = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: Date()))!
    func at(_ hm: (Int, Int)) -> Double { day.timeIntervalSince1970 + Double(hm.0 * 3600 + hm.1 * 60) }

    var visits: [(start: Double, visit: Visit)] = []
    for run in plan {
      var t = at(run.start)
      for visit in run.visits {
        visits.append((t, visit))
        t += visit.minutes * 60
      }
    }

    var threadIDs: [Int64] = []
    try database.writer.write { db in
      for (index, thread) in threads.enumerated() {
        let own = visits.filter { $0.visit.thread == index }
        var record = ActivityThread(
          name: thread.name, summary: thread.summary, category: thread.category, createdAt: own.first!.start,
          lastSeenAt: own.last!.start + own.last!.visit.minutes * 60, activityCount: own.count, captions: own.map(\.visit.caption))
        try record.insert(db)
        threadIDs.append(record.id!)
      }
    }

    var images: [String: CGImage] = [:]
    var heroes: Set<String> = []
    for (start, visit) in visits {
      guard let page = pages[visit.page], let url = URL(string: page.url) else { continue }
      let context = ForegroundContext(
        bundleID: browser.bundleID, appName: browser.name, windowTitle: page.title, urlHost: url.host(),
        urlPath: url.path().isEmpty ? "/" : url.path())
      var captures: [Capture] = []
      var keptID: String?
      for k in 0..<max(1, Int(visit.minutes)) {
        let at = start + Double(k) * 60 + (k == 0 ? 2 : 0)
        let id = UUID().uuidString
        if let keptID {
          // The page stayed put: an unchanged screen, recorded as a duplicate of the frame before.
          let capture = Capture(
            id: id, at: at, trigger: .timer, displayID: 1, isFocusedDisplay: true, context: context, framePath: nil, thumbPath: nil,
            pixelWidth: 1728, pixelHeight: 1117, dHash: 0, duplicateOf: keptID, ocrState: .notNeeded, window: window)
          try database.insert(capture)
          captures.append(capture)
          continue
        }
        if images[page.key] == nil { images[page.key] = try render(Scene(page: page)) }
        let framePath = location.frameRelativePath(captureID: id, at: at)
        let thumbPath = location.thumbRelativePath(captureID: id, at: at)
        try FrameEncoder.writeHEIC(images[page.key]!, to: location.url(framePath))
        try FrameEncoder.writeThumbnail(images[page.key]!, to: location.url(thumbPath))
        let capture = Capture(
          id: id, at: at, trigger: .contextSwitch, displayID: 1, isFocusedDisplay: true, context: context, framePath: framePath,
          thumbPath: thumbPath, pixelWidth: 1728, pixelHeight: 1117, dHash: 0, duplicateOf: nil, ocrState: .pending, window: window)
        try database.insert(capture)
        captures.append(capture)
        keptID = id
        if threads[visit.thread].hero == page.key { heroes.insert(id) }
      }
      try database.insert(
        Activity(
          firstCaptureID: captures.first!.id, lastCaptureID: captures.last!.id, startAt: start, endAt: start + visit.minutes * 60,
          captureCount: captures.count, isOpen: false, threadID: threadIDs[visit.thread], threadProbability: 0.97,
          caption: visit.caption, title: visit.title))
    }
    try database.setMeta("onboarded", ISO8601DateFormatter().string(from: day))
    // README screenshots render only from a store carrying this mark (`ReadmeShots`).
    try database.setMeta(Self.mark, "1")
    return Result(day: day, heroCaptures: heroes, threadIDs: threadIDs)
  }
}

/// Stands in for the decision model on the made-up day: picks a cover among the thread's recognisable pages.
public struct DemoDecider: DecisionModel {
  let preferred: Set<String>

  public init(preferred: Set<String>) { self.preferred = preferred }

  public func decide(state: [StatePart], questions: [(key: String, question: DecisionQuestion)]) async throws -> DecisionResult {
    var answers: [String: DecisionAnswer] = [:]
    for (key, question) in questions {
      switch question {
      case .noul: answers[key] = .noul(0.1)
      case .choice(_, let options):
        let pick = options.first { preferred.contains($0.key) } ?? options[0]
        answers[key] = .choice(pick.key, Dictionary(uniqueKeysWithValues: options.map { ($0.key, $0.key == pick.key ? 0.9 : 0.1 / Double(options.count)) }))
      }
    }
    return DecisionResult(answers: answers, usage: ModelUsage(model: "demo", inputTokens: 0, costUSD: 0, latencyMS: 0))
  }
}

/// Stands in for the text model on the made-up day: writes its headline.
public struct DemoWriter: TextModel {
  let headline: String

  public init(headline: String) { self.headline = headline }

  public func json(content: [StatePart], keys: [String], purpose: String) async throws -> TextResult {
    TextResult(values: Dictionary(uniqueKeysWithValues: keys.map { ($0, headline) }), usage: ModelUsage(model: "demo", inputTokens: 0, costUSD: 0, latencyMS: 0))
  }
}
