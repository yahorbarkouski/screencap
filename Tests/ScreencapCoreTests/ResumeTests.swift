import Foundation
import Testing

@testable import ScreencapCore

@Suite struct ThingKeyTests {
  let dia = "company.thebrowser.dia"
  let readers = ThingReaders.standard()

  func context(_ bundleID: String?, title: String? = nil, host: String? = nil, path: String? = nil, app: String? = nil)
    -> ForegroundContext
  {
    ForegroundContext(bundleID: bundleID, appName: app, windowTitle: title, urlHost: host, urlPath: path)
  }

  @Test func aPageBecomesItsAddress() {
    let ref = readers.ref(
      context: context(dia, title: "Main: Fix the tokenizer f…", host: "github.com", path: "/acme/widgets/issues/72"),
      at: 0)
    #expect(ref?.kind == .tab)
    #expect(ref?.key == "url:github.com/acme/widgets/issues/72")
  }

  @Test func theHostLosesItsCaseAndItsWww() {
    let ref = readers.ref(context: context(dia, title: "Channel", host: "WWW.YouTube.COM", path: "/@channel"), at: 0)
    #expect(ref?.key == "url:youtube.com/@channel")
  }

  @Test func aLongPathFoldsIntoThePageItBelongsTo() {
    // A comment, a diff and a review of one pull request are the same place to come back to.
    let changes = readers.ref(
      context: context(dia, title: "", host: "github.com", path: "/acme/gadgets/pull/1234/changes"), at: 0)
    let files = readers.ref(
      context: context(dia, title: "", host: "github.com", path: "/acme/gadgets/pull/1234/files/abc/def"),
      at: 0)
    #expect(changes?.key == "url:github.com/acme/gadgets/pull/1234")
    #expect(changes?.key == files?.key)
  }

  @Test func aBrowserWithNoPageYetIsStillItsWindow() {
    let ref = readers.ref(context: context(dia, title: "Main: New Tab"), at: 0)
    #expect(ref?.kind == .window)
    #expect(ref?.key == "win:company.thebrowser.dia|Main: New Tab")
  }

  @Test func anUnreadTitleLosesItsCounter() {
    let ref = readers.ref(context: context("com.tinyspeck.slackmacgap", title: "(3) Slack — Acme"), at: 0)
    #expect(ref?.key == "win:com.tinyspeck.slackmacgap|Slack — Acme")
  }

  /// Slack writes its counter into the middle of the title, so a channel with news was a second place.
  @Test func slacksNewItemCounterIsNotPartOfThePlace() {
    let slack = "com.tinyspeck.slackmacgap"
    let one = readers.ref(context: context(slack, title: "general (Channel) - Acme - 1 new item - Slack"), at: 0)
    let many = readers.ref(context: context(slack, title: "general (Channel) - Acme - 12 new items - Slack"), at: 0)
    let none = readers.ref(context: context(slack, title: "general (Channel) - Acme - Slack"), at: 0)
    #expect(none?.key == "win:com.tinyspeck.slackmacgap|general (Channel) - Acme - Slack")
    #expect(one?.key == none?.key)
    #expect(many?.key == none?.key)
    // Words that only look like a counter stay.
    #expect(ForegroundContext.stableTitle("3 new items to review - Notes") == "3 new items to review - Notes")
  }

  @Test func anAppWithoutATitleIsJustTheApp() {
    let ref = readers.ref(context: context("com.spotify.client", app: "Spotify"), at: 0)
    #expect(ref?.kind == .app)
    #expect(ref?.key == "app:com.spotify.client")
    #expect(ref?.label == "Spotify")
  }

  @Test func nothingToComeBackToWithoutAnApp() {
    #expect(readers.ref(context: context(nil), at: 0) == nil)
  }

  /// Screencap in front for a minute of a thread used to come back as one of its places.
  @Test func screencapIsNeverAPlaceToGoBackTo() {
    #expect(readers.ref(context: context(Moments.ownBundleID, title: "Screencap", app: "Screencap"), at: 0) == nil)
  }

  /// A tab open right now has to produce the same key as the capture that bound it, or a resume finds nothing.
  @Test func aTabOpenNowMatchesTheKeyThatWasBound() {
    let bound = readers.ref(
      context: context(dia, title: "x", host: "github.com", path: "/acme/widgets/issues/72"), at: 0)
    #expect(
      ThingKey.key(forURL: "https://github.com/acme/widgets/issues/72#issuecomment-1") == bound?.key)
    #expect(ThingKey.key(forURL: "https://www.youtube.com/@channel?si=share") == "url:youtube.com/@channel")
    #expect(ThingKey.key(forURL: "about:blank") == nil)
    #expect(ThingKey.key(forURL: "not a url") == nil)
  }

  /// A series moves from one episode's address to the next and stays the same place to come back to.
  @Test func aPageKnowsTheSectionItBelongsTo() {
    #expect(ThingKey.section(of: "url:netflix.com/watch/1001") == "url:netflix.com/watch")
    #expect(ThingKey.section(of: "url:github.com/acme/gadgets/issues/58") == "url:github.com/acme/gadgets/issues")
    // One segment has no section: its section would be the whole site, which would match any page on it.
    #expect(ThingKey.section(of: "url:x.com/home") == nil)
    #expect(ThingKey.section(of: "url:youtube.com") == nil)
    #expect(ThingKey.section(of: "win:com.apple.Safari|x") == nil)
  }

  @Test func aTitleCutShortStillNamesItsWindow() {
    #expect(ThingKey.titlesMatch("Main: Fix the tokenizer f…", "Main: Fix the tokenizer for nested quotes"))
    #expect(ThingKey.titlesMatch("(3) Slack — Acme", "Slack — Acme"))
    #expect(!ThingKey.titlesMatch("Main: New Tab", "Main: Fix the tokenizer f…"))
    // Two short titles are not matched on a prefix: too many windows would look alike.
    #expect(!ThingKey.titlesMatch("Main", "Main: x"))
  }

  @Test func claudeBecomesTheSessionThatWasInFront() {
    let index = ClaudeSessionIndex(sessions: [
      ClaudeSession(
        id: "abc", title: "Gadgets issue #58 deep dive", directory: "/Users/me/gadgets",
        entrypoint: "claude-desktop", promptTimes: [100], lastPromptAt: 100)
    ])
    let ref = ThingReaders.standard(sessions: index).ref(
      context: context(ClaudeSessionIndex.bundleID, title: "Claude", app: "Claude"), at: 160)
    #expect(ref?.kind == .session)
    #expect(ref?.key == "claude:abc")
    #expect(ref?.label == "Gadgets issue #58 deep dive")
    #expect(ref?.detail == "gadgets")
  }

  @Test func claudeStaysOneBlobWithoutTheIndex() {
    let ref = readers.ref(context: context(ClaudeSessionIndex.bundleID, title: "Claude"), at: 160)
    #expect(ref?.kind == .window)
    #expect(ref?.key == "win:com.anthropic.claudefordesktop|Claude")
  }
}

@Suite struct ClaudeSessionIndexTests {
  /// A transcript folder like the ones under `~/.claude/projects`.
  func transcripts(_ files: [String: [String]]) throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("claude-\(UUID().uuidString)")
    let folder = root.appendingPathComponent("-Users-me-project")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    for (name, rows) in files {
      try rows.joined(separator: "\n").write(
        to: folder.appendingPathComponent("\(name).jsonl"), atomically: true, encoding: .utf8)
    }
    return root
  }

  func prompt(_ stamp: String, cwd: String = "/Users/me/project", extra: String = "") -> String {
    """
    {"type":"user","timestamp":"\(stamp)","origin":{"kind":"human"},"cwd":"\(cwd)",\
    "entrypoint":"claude-desktop","isSidechain":false\(extra.isEmpty ? "" : ",\(extra)")}
    """
  }

  func title(_ text: String) -> String { #"{"type":"custom-title","customTitle":"\#(text)"}"# }

  @Test func readsTheTitleAndTheMomentsSomebodyTyped() throws {
    let root = try transcripts([
      "11111111-1111-1111-1111-111111111111": [
        title("Tokenizer: comment for widgets #72"),
        prompt("2026-10-16T22:01:00.000Z"),
        prompt("2026-10-16T22:04:30.500Z"),
        #"{"type":"assistant","timestamp":"2026-10-16T22:05:00.000Z"}"#,
      ]
    ])
    let index = ClaudeSessionIndex.build(root: root)
    #expect(index.sessions.count == 1)
    let session = index.sessions[0]
    #expect(session.id == "11111111-1111-1111-1111-111111111111")
    #expect(session.title == "Tokenizer: comment for widgets #72")
    #expect(session.directory == "/Users/me/project")
    #expect(session.isDesktop)
    #expect(session.promptTimes.count == 2)
  }

  @Test func theSessionInFrontIsTheOneTypedIntoLast() throws {
    let root = try transcripts([
      "aaaaaaaa-0000-0000-0000-000000000000": [title("First"), prompt("2026-10-16T20:00:00.000Z")],
      "bbbbbbbb-0000-0000-0000-000000000000": [title("Second"), prompt("2026-10-16T21:00:00.000Z")],
    ])
    let index = ClaudeSessionIndex.build(root: root)
    let noon = ClaudeSessionIndex.moment("2026-10-16T20:30:00.000Z")!
    let later = ClaudeSessionIndex.moment("2026-10-16T21:30:00.000Z")!
    #expect(index.session(at: noon)?.title == "First")
    #expect(index.session(at: later)?.title == "Second")
    // Before anybody had typed, nothing was in front.
    #expect(index.session(at: ClaudeSessionIndex.moment("2026-10-16T19:00:00.000Z")!) == nil)
  }

  @Test func aLongBreakEndsTheAttribution() throws {
    let root = try transcripts(["cccccccc-0000-0000-0000-000000000000": [prompt("2026-10-16T09:00:00.000Z")]])
    let index = ClaudeSessionIndex.build(root: root)
    #expect(index.session(at: ClaudeSessionIndex.moment("2026-10-16T12:00:00.000Z")!) != nil)
    #expect(index.session(at: ClaudeSessionIndex.moment("2026-10-16T22:00:00.000Z")!) == nil)
  }

  @Test func rowsNobodyTypedSayNothingAboutWhatWasOnScreen() throws {
    let root = try transcripts([
      "dddddddd-0000-0000-0000-000000000000": [
        title("Agent work"),
        #"{"type":"user","timestamp":"2026-10-16T10:00:00.000Z","isSidechain":true,"origin":{"kind":"human"}}"#,
        #"{"type":"user","timestamp":"2026-10-16T10:05:00.000Z","origin":{"kind":"tool_result"}}"#,
      ]
    ])
    let index = ClaudeSessionIndex.build(root: root)
    #expect(index.sessions.isEmpty)
  }

  @Test func subagentTranscriptsAreSkipped() throws {
    let root = try transcripts(["eeeeeeee-0000-0000-0000-000000000000": [prompt("2026-10-16T10:00:00.000Z")]])
    let nested = root.appendingPathComponent("-Users-me-project/eeeeeeee-0000-0000-0000-000000000000/subagents")
    try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
    try prompt("2026-10-16T10:01:00.000Z").write(
      to: nested.appendingPathComponent("agent-abc.jsonl"), atomically: true, encoding: .utf8)
    #expect(ClaudeSessionIndex.build(root: root).sessions.count == 1)
  }

  @Test func theCacheGivesBackTheSameIndex() throws {
    let root = try transcripts([
      "ffffffff-0000-0000-0000-000000000000": [title("Cached"), prompt("2026-10-16T10:00:00.000Z")]
    ])
    let cache = root.appendingPathComponent("sessions.json")
    let cold = ClaudeSessionIndex.build(root: root, cache: cache)
    let warm = ClaudeSessionIndex.build(root: root, cache: cache)
    #expect(FileManager.default.fileExists(atPath: cache.path))
    #expect(cold.sessions == warm.sessions)
  }

  /// A pass over recent days used to write a cache holding only the transcripts it read, so the next full pass
  /// read every transcript again — twenty seconds of CPU, every time the palette looked for splits.
  @Test func aNarrowPassKeepsTheRestOfTheCache() throws {
    let root = try transcripts([
      "aaaaaaaa-1111-0000-0000-000000000000": [title("Old"), prompt("2026-10-01T10:00:00.000Z")],
      "bbbbbbbb-1111-0000-0000-000000000000": [title("New"), prompt("2026-10-16T10:00:00.000Z")],
    ])
    let old = root.appendingPathComponent("-Users-me-project/aaaaaaaa-1111-0000-0000-000000000000.jsonl")
    let longAgo = Date(timeIntervalSince1970: ClaudeSessionIndex.moment("2026-10-01T10:00:00.000Z")!)
    try FileManager.default.setAttributes([.modificationDate: longAgo], ofItemAtPath: old.path)
    let cache = root.appendingPathComponent("sessions.json")

    _ = ClaudeSessionIndex.build(root: root, cache: cache)
    let recent = ClaudeSessionIndex.moment("2026-10-10T00:00:00.000Z")!
    let narrow = ClaudeSessionIndex.build(root: root, since: recent, cache: cache)
    #expect(narrow.sessions.map(\.title) == ["New"])
    #expect(ClaudeSessionIndex.SessionCache.read(from: cache)?.files.count == 2)
  }

  @Test func readsClaudesTimestamps() {
    #expect(ClaudeSessionIndex.moment("1970-01-01T00:00:00.000Z") == 0)
    #expect(ClaudeSessionIndex.moment("2026-10-14T19:11:16.782Z") == 1_792_005_076.782)
    #expect(ClaudeSessionIndex.moment("2026-10-14T19:11:16Z") == 1_792_005_076)
    #expect(ClaudeSessionIndex.moment("not a time") == nil)
  }
}

@Suite struct BindingTests {
  let dia = "company.thebrowser.dia"

  func capture(_ threadID: Int64, _ at: Double, host: String? = nil, path: String? = nil, title: String? = nil,
    activity: Int64 = 1, end: Double = 100_000) -> BindingCapture
  {
    BindingCapture(
      threadID: threadID, activityID: activity, activityEnd: end, at: at, captureID: "c\(at)",
      context: ForegroundContext(bundleID: dia, appName: "Dia", windowTitle: title, urlHost: host, urlPath: path))
  }

  @Test func timeOnScreenStopsAtTheCadence() {
    // Two captures a minute apart, then one after a ten-minute gap inside the same activity: the gap is not time
    // spent on the page.
    let captures = [
      capture(1, 1_000, host: "github.com", path: "/a"),
      capture(1, 1_060, host: "github.com", path: "/a"),
      capture(1, 1_660, host: "github.com", path: "/a"),
    ]
    let totals = BindingBuilder().totals(for: captures, readers: ThingReaders.standard())
    #expect(totals.seconds.values.reduce(0, +) == 180)
  }

  @Test func timeStopsAtTheEndOfTheActivity() {
    let totals = BindingBuilder().totals(
      for: [capture(1, 1_000, host: "github.com", path: "/a", end: 1_020)], readers: ThingReaders.standard())
    #expect(totals.seconds.values.reduce(0, +) == 20)
  }

  @Test func aNewActivityDoesNotStretchTheCaptureBeforeIt() {
    let captures = [
      capture(1, 1_000, host: "github.com", path: "/a", activity: 1),
      capture(2, 1_010, host: "youtube.com", path: "/x", activity: 2),
    ]
    let totals = BindingBuilder().totals(for: captures, readers: ThingReaders.standard())
    // The first capture is the last of its activity, so it stands for a whole cadence rather than ten seconds.
    #expect(totals.seconds.values.allSatisfy { $0 == 60 })
    #expect(totals.seconds.count == 2)
  }

  @Test func daysAreCountedApart() {
    let monday = ThreadBinding.dayStart(1_792_000_000)
    let captures = [
      capture(1, monday + 3_600, host: "github.com", path: "/a", end: monday + 200_000),
      capture(1, monday + 86_400 + 3_600, host: "github.com", path: "/a", end: monday + 200_000),
    ]
    let totals = BindingBuilder().totals(for: captures, readers: ThingReaders.standard())
    #expect(totals.seconds.count == 2)
    #expect(Set(totals.seconds.keys.map(\.dayStart)).count == 2)
  }

  @Test func theNewestLabelWins() {
    let captures = [
      capture(1, 1_000, title: "Untitled"),
      capture(1, 2_000, title: "Untitled"),
    ]
    var late = capture(1, 3_000, title: "Untitled")
    late.context.windowTitle = "Named at last"
    let totals = BindingBuilder().totals(for: captures + [late], readers: ThingReaders.standard())
    #expect(totals.refs["win:\(dia)|Named at last"]?.label == "Named at last")
  }

  /// A pass over the last few days used to delete every bucket of every thread it touched and write back only the
  /// days it read, so a thread worked in today lost what it did last week each time upkeep ran.
  @Test func aRecentPassLeavesOlderDaysAlone() throws {
    let (_, database) = try temporaryStore()
    var thread = ActivityThread(name: "Search", summary: "", createdAt: 0, lastSeenAt: 0, activityCount: 2, captions: [])
    try database.writer.write { db in try thread.insert(db) }
    let monday = ThreadBinding.dayStart(1_792_000_000) + 10 * 3_600
    let wednesday = monday + 2 * 86_400
    for (id, at) in [("old", monday), ("new", wednesday)] {
      try database.insert(
        Capture(
          id: id, at: at, trigger: .timer, displayID: 1, isFocusedDisplay: true,
          context: ForegroundContext(
            bundleID: dia, appName: "Dia", windowTitle: "issue", urlHost: "github.com", urlPath: "/a/b/issues/72"),
          framePath: nil, thumbPath: nil, pixelWidth: 100, pixelHeight: 100, dHash: 0, duplicateOf: nil,
          ocrState: .done))
      _ = try database.insert(
        Activity(
          firstCaptureID: id, lastCaptureID: id, startAt: at, endAt: at + 60, captureCount: 1, isOpen: false,
          threadID: thread.id))
    }
    let builder = BindingBuilder()
    try builder.rebuild(in: database, readers: ThingReaders.standard())
    #expect(try database.bindings(threadID: thread.id!).count == 2)

    try builder.rebuild(in: database, since: wednesday, readers: ThingReaders.standard())
    let after = try database.bindings(threadID: thread.id!).sorted { $0.dayStart < $1.dayStart }
    #expect(after.count == 2)
    #expect(after.map(\.seconds) == [60, 60])
  }

  @Test func rebuildingTwiceWritesTheSameRows() throws {
    let (_, database) = try temporaryStore()
    var thread = ActivityThread(
      name: "Search", summary: "", category: .work, createdAt: 0, lastSeenAt: 2_000, activityCount: 1,
      captions: [])
    try database.writer.write { db in try thread.insert(db) }
    let threadID = thread.id!
    try database.insert(
      Capture(
        id: "c1", at: 1_000, trigger: .timer, displayID: 1, isFocusedDisplay: true,
        context: ForegroundContext(
          bundleID: dia, appName: "Dia", windowTitle: "issue", urlHost: "github.com", urlPath: "/a/b/issues/72"),
        framePath: nil, thumbPath: nil, pixelWidth: 100, pixelHeight: 100, dHash: 0, duplicateOf: nil,
        ocrState: .done))
    _ = try database.insert(
      Activity(
        firstCaptureID: "c1", lastCaptureID: "c1", startAt: 1_000, endAt: 1_060, captureCount: 1, isOpen: false,
        threadID: threadID))

    let builder = BindingBuilder()
    let first = try builder.rebuild(in: database, readers: ThingReaders.standard())
    let second = try builder.rebuild(in: database, readers: ThingReaders.standard())
    #expect(first == second)
    let rows = try database.bindings(threadID: threadID)
    #expect(rows.count == 1)
    #expect(rows[0].seconds == 60)
    let thing = try database.thing(key: "url:github.com/a/b/issues/72")
    #expect(thing?.kind == .tab)
    #expect(rows[0].thingID == thing?.id)
  }
}

@Suite struct ThingExclusionTests {
  @Test func anExclusionOutlivesARebuild() throws {
    let (_, database) = try temporaryStore()
    var thread = ActivityThread(name: "T", summary: "", createdAt: 0, lastSeenAt: 0, activityCount: 0, captions: [])
    try database.writer.write { db in try thread.insert(db) }
    let ids = try database.upsertThings(
      [ThingRef(key: "url:example.com/a", kind: .tab, label: "a")], firstSeen: ["url:example.com/a": 0],
      lastSeen: ["url:example.com/a": 0])
    let thingID = ids["url:example.com/a"]!
    try database.exclude(thingID: thingID, fromThread: thread.id!)
    #expect(try database.exclusions(threadID: thread.id!) == [thingID])

    // A rebuild replaces every binding; the exclusion is in its own table and is untouched.
    try database.replaceBindings([], fromDay: 0)
    #expect(try database.exclusions(threadID: thread.id!) == [thingID])

    let listed = try database.excludedPlaces()
    #expect(listed.map(\.thing.label) == ["a"])
    #expect(listed.first?.threadName == "T")
    #expect(listed.first?.threadID == thread.id)

    try database.include(thingID: thingID, inThread: thread.id!)
    #expect(try database.exclusions(threadID: thread.id!).isEmpty)
    #expect(try database.excludedPlaces().isEmpty)
  }

  /// Clearing used to delete the things too, and an exclusion points at a thing, so `rebuild-bindings
  /// --from-scratch` quietly undid every place the person had dropped.
  @Test func clearingBindingsKeepsWhatWasDropped() throws {
    let (_, database) = try temporaryStore()
    var thread = ActivityThread(name: "T", summary: "", createdAt: 0, lastSeenAt: 0, activityCount: 0, captions: [])
    try database.writer.write { db in try thread.insert(db) }
    let ids = try database.upsertThings(
      [ThingRef(key: "url:example.com/a", kind: .tab, label: "a")], firstSeen: ["url:example.com/a": 0],
      lastSeen: ["url:example.com/a": 0])
    try database.exclude(thingID: ids["url:example.com/a"]!, fromThread: thread.id!)
    try database.clearBindings()
    #expect(try database.exclusions(threadID: thread.id!) == [ids["url:example.com/a"]!])
    #expect(try database.thing(key: "url:example.com/a") != nil)
  }
}

@Suite struct ThreadSplitTests {
  func labels(_ keys: [String]) -> [String: ThingRef] {
    Dictionary(keys.map { ($0, ThingRef(key: $0, kind: .tab, label: $0)) }, uniquingKeysWith: { first, _ in first })
  }

  /// Two contributions to two projects in one thread, each with its own repository, issue and plan, never on
  /// screen together.
  @Test func aThreadHoldingTwoPiecesOfWorkSplits() {
    let times: [Int64: [String: Double]] = [
      1: ["claude:gadgets": 600, "url:github.com/acme/gadgets/issues/58": 120],
      2: ["claude:gadgets": 300, "url:github.com/acme/gadgets/pull/1234": 60],
      3: ["claude:gadgets": 240],
      4: ["url:github.com/acme/widgets/issues/72": 600],
      5: ["url:github.com/acme/widgets/issues/72": 300, "url:github.com/acme/widgets": 90],
      6: ["url:github.com/acme/widgets/issues/72": 180],
    ]
    let candidate = ThreadSplit.candidate(
      threadID: 60, activityTimes: times, labels: labels(times.values.flatMap(\.keys)))
    #expect(candidate?.groups.count == 2)
    #expect(candidate?.groups[0].activityIDs == [1, 2, 3])
    #expect(candidate?.groups[1].activityIDs == [4, 5, 6])
    #expect(candidate?.sharedShare == 0)
  }

  /// The measure used to count only activities that were all glances, so a side whose own work kept touching the
  /// other side's pages for a few seconds looked perfectly separate.
  @Test func aGlanceAcrossTheSidesCountsAgainstTheSplit() {
    var times: [Int64: [String: Double]] = [
      1: ["claude:a": 600], 2: ["claude:a": 600], 3: ["claude:a": 600],
      4: ["claude:b": 600], 5: ["claude:b": 600], 6: ["claude:b": 600],
    ]
    let clean = ThreadSplit.candidate(threadID: 1, activityTimes: times, labels: labels(times.values.flatMap(\.keys)))
    #expect(clean?.sharedShare == 0)

    // One of side a's activities spends twenty seconds in side b's session: a glance, so it links nothing, but it
    // is time the two sides have in common.
    times[3]?["claude:b"] = 20
    let touched = ThreadSplit.candidate(threadID: 1, activityTimes: times, labels: labels(times.values.flatMap(\.keys)))
    #expect(touched != nil)
    #expect((touched?.sharedShare ?? 0) > 0.15)

    // When most of a side's activities do it, the thread is one piece of work after all.
    times[1]?["claude:b"] = 20
    times[2]?["claude:b"] = 20
    #expect(ThreadSplit.candidate(threadID: 1, activityTimes: times, labels: labels(times.values.flatMap(\.keys))) == nil)
  }

  @Test func oneThingRunningThroughTheThreadHoldsItTogether() {
    // The same session is open all week: this is one piece of work, whatever else came and went.
    var times: [Int64: [String: Double]] = [:]
    for id in 1...8 {
      times[Int64(id)] = ["claude:one": 300, "url:example.com/\(id)": 300]
    }
    #expect(ThreadSplit.candidate(threadID: 1, activityTimes: times, labels: labels(times.values.flatMap(\.keys))) == nil)
  }

  @Test func oneStretchIsNotASideOfItsOwn() {
    let times: [Int64: [String: Double]] = [
      1: ["claude:main": 600], 2: ["claude:main": 600], 3: ["claude:main": 600], 4: ["claude:main": 600],
      5: ["claude:main": 600], 6: ["url:console.example.com/home": 900],
    ]
    #expect(ThreadSplit.candidate(threadID: 1, activityTimes: times, labels: labels(times.values.flatMap(\.keys))) == nil)
  }

  @Test func aYoungThreadSaysTooLittle() {
    let times: [Int64: [String: Double]] = [
      1: ["claude:a": 600], 2: ["claude:a": 600], 3: ["url:b.example.com": 600], 4: ["url:b.example.com": 600],
    ]
    var thresholds = ThreadSplitThresholds()
    #expect(ThreadSplit.candidate(threadID: 1, activityTimes: times, labels: labels(times.values.flatMap(\.keys))) == nil)
    // With the bar lowered the same thread does split, so it is the number of activities holding it back.
    thresholds.minActivities = 4
    let candidate = ThreadSplit.candidate(
      threadID: 1, activityTimes: times, labels: labels(times.values.flatMap(\.keys)), thresholds: thresholds)
    #expect(candidate?.groups.count == 2)
  }

  @Test func aGlanceMakesNoLink() {
    // A tab open for ten seconds in each of two otherwise unrelated stretches does not join them.
    var times: [Int64: [String: Double]] = [:]
    for id in 1...3 { times[Int64(id)] = ["claude:a": 600, "url:glance.example.com": 10] }
    for id in 4...6 { times[Int64(id)] = ["claude:b": 600, "url:glance.example.com": 10] }
    let candidate = ThreadSplit.candidate(
      threadID: 1, activityTimes: times, labels: labels(times.values.flatMap(\.keys)))
    #expect(candidate?.groups.count == 2)
    #expect(candidate?.groups.allSatisfy { $0.activityIDs.count == 3 } == true)
  }

  @Test func timePerActivityComesFromTheCaptures() {
    let captures = [
      BindingCapture(
        threadID: 1, activityID: 7, activityEnd: 10_000, at: 1_000, captureID: "a",
        context: ForegroundContext(bundleID: "company.thebrowser.dia", urlHost: "github.com", urlPath: "/a")),
      BindingCapture(
        threadID: 1, activityID: 7, activityEnd: 10_000, at: 1_030, captureID: "b",
        context: ForegroundContext(bundleID: "company.thebrowser.dia", urlHost: "github.com", urlPath: "/a")),
    ]
    let read = ThreadSplit.activityTimes(captures: captures, readers: ThingReaders.standard())
    #expect(read.times[7]?["url:github.com/a"] == 90)
    #expect(read.labels["url:github.com/a"]?.kind == .tab)
  }
}

@Suite struct ResumeRankingTests {
  func thing(_ id: Int64, _ key: String) -> Thing {
    Thing(id: id, key: key, kind: .tab, label: key, firstSeenAt: 0, lastSeenAt: 0)
  }

  @Test func timeCountsHalfAsMuchEveryHalfLife() {
    let now: Double = 14 * 86_400
    #expect(ResumeRanking.decayed(seconds: 100, dayStart: now, now: now, halfLifeDays: 7) == 100)
    #expect(ResumeRanking.decayed(seconds: 100, dayStart: now - 7 * 86_400, now: now, halfLifeDays: 7) == 50)
    #expect(ResumeRanking.decayed(seconds: 100, dayStart: now - 14 * 86_400, now: now, halfLifeDays: 7) == 25)
  }

  /// A video channel on screen for a minute inside a work thread and for hours inside a gaming thread is not the
  /// work thread's.
  @Test func aThingMostlySpentElsewhereIsLeftOut() {
    let now: Double = 1_000_000
    let issue = thing(1, "url:github.com/acme/widgets/issues/72")
    let stream = thing(2, "url:youtube.com/@channel")
    let mine = [
      ThreadBinding(threadID: 60, thingID: 1, dayStart: now, seconds: 600, captures: 10),
      ThreadBinding(threadID: 60, thingID: 2, dayStart: now, seconds: 60, captures: 1),
    ]
    let everywhere = mine + [ThreadBinding(threadID: 33, thingID: 2, dayStart: now, seconds: 7_200, captures: 120)]
    let scores = ResumeRanking.scores(
      threadID: 60, bindings: mine, everyBinding: everywhere, things: [1: issue, 2: stream], now: now)
    #expect(scores.first?.thing.id == 1)
    #expect(scores.first?.share == 1)
    let streamScore = scores.first { $0.thing.id == 2 }
    #expect((streamScore?.share ?? 1) < 0.02)
    let kept = ResumeRanking.plan(scores)
    #expect(kept.map(\.thing.id) == [1])
  }

  @Test func aGlanceIsNotAPlaceYouWereWorking() {
    let now: Double = 1_000_000
    let rows = [ThreadBinding(threadID: 1, thingID: 1, dayStart: now, seconds: 10, captures: 1)]
    let scores = ResumeRanking.scores(
      threadID: 1, bindings: rows, everyBinding: rows, things: [1: thing(1, "url:example.com")], now: now)
    // Nothing clears the thresholds, so the best single thing is kept rather than nothing at all.
    #expect(ResumeRanking.plan(scores).count == 1)
  }

  @Test func aPlaceSaidNotToBelongStaysOut() {
    let now: Double = 1_000_000
    let rows = [
      ThreadBinding(threadID: 1, thingID: 1, dayStart: now, seconds: 600, captures: 10, activities: 3),
      ThreadBinding(threadID: 1, thingID: 2, dayStart: now, seconds: 600, captures: 10, activities: 3),
    ]
    let things: [Int64: Thing] = [1: thing(1, "url:example.com/a"), 2: thing(2, "url:example.com/b")]
    let scores = ResumeRanking.scores(threadID: 1, bindings: rows, everyBinding: rows, things: things, now: now)
    #expect(ResumeRanking.plan(scores).count == 2)
    #expect(ResumeRanking.plan(scores, excluded: [2]).map(\.thing.id) == [1])
  }

  @Test func atMostEightThingsComeForward() {
    let now: Double = 1_000_000
    var rows: [ThreadBinding] = []
    var things: [Int64: Thing] = [:]
    for id in 1...20 {
      rows.append(ThreadBinding(threadID: 1, thingID: Int64(id), dayStart: now, seconds: 600, captures: 10))
      // Twenty different sites: twenty pages of one site would be a crowd, and only one of those comes forward.
      things[Int64(id)] = thing(Int64(id), "url:site\(id).example")
    }
    let scores = ResumeRanking.scores(threadID: 1, bindings: rows, everyBinding: rows, things: things, now: now)
    #expect(scores.count == 20)
    #expect(ResumeRanking.plan(scores).count == 8)
  }

  func seen(_ id: Int64, _ key: String, at lastSeen: Double) -> Thing {
    Thing(id: id, key: key, kind: .tab, label: key, firstSeenAt: 0, lastSeenAt: lastSeen)
  }

  /// A thread of streams watched over several evenings holds a different channel each evening.
  @Test func ofACrowdOfSiblingPagesOnlyTheLatestComesForward() {
    let now: Double = 1_000_000
    let channels = ["url:streams.example/first", "url:streams.example/second", "url:streams.example/third", "url:streams.example/fourth"]
    var rows: [ThreadBinding] = []
    var things: [Int64: Thing] = [:]
    for (index, key) in channels.enumerated() {
      let id = Int64(index + 1)
      rows.append(ThreadBinding(threadID: 1, thingID: id, dayStart: now, seconds: 1_800, captures: 30, activities: 5))
      things[id] = seen(id, key, at: now - 86_400 + Double(index) * 3_600)
    }
    rows.append(ThreadBinding(threadID: 1, thingID: 9, dayStart: now, seconds: 1_200, captures: 20, activities: 4))
    things[9] = seen(9, "url:wiki.example/league/teams", at: now - 86_400)
    let scores = ResumeRanking.scores(threadID: 1, bindings: rows, everyBinding: rows, things: things, now: now)
    #expect(Set(ResumeRanking.plan(scores).map(\.thing.key)) == ["url:streams.example/fourth", "url:wiki.example/league/teams"])
  }

  /// Two pull requests open side by side are not a crowd: both belong to the work.
  @Test func twoSiblingPagesBothComeForward() {
    let now: Double = 1_000_000
    let rows = [
      ThreadBinding(threadID: 1, thingID: 1, dayStart: now, seconds: 900, captures: 15, activities: 3),
      ThreadBinding(threadID: 1, thingID: 2, dayStart: now, seconds: 600, captures: 10, activities: 3),
    ]
    let things: [Int64: Thing] = [
      1: seen(1, "url:github.com/acme/widgets/pull/12", at: now), 2: seen(2, "url:github.com/acme/widgets/pull/13", at: now - 60),
    ]
    let scores = ResumeRanking.scores(threadID: 1, bindings: rows, everyBinding: rows, things: things, now: now)
    #expect(ResumeRanking.plan(scores).count == 2)
  }

  /// A session typed into for a few minutes while a stream played for hours is not what the stream's thread is.
  @Test func aPlaceFarBelowTheThreadsTopIsLeftOut() {
    let now: Double = 1_000_000
    let rows = [
      ThreadBinding(threadID: 1, thingID: 1, dayStart: now, seconds: 7_200, captures: 120, activities: 9),
      ThreadBinding(threadID: 1, thingID: 2, dayStart: now, seconds: 180, captures: 3, activities: 2),
      ThreadBinding(threadID: 1, thingID: 3, dayStart: now, seconds: 1_800, captures: 30, activities: 4),
    ]
    let things: [Int64: Thing] = [
      1: seen(1, "url:streams.example/channel", at: now), 2: seen(2, "claude:abc", at: now), 3: seen(3, "url:wiki.example/league", at: now),
    ]
    let scores = ResumeRanking.scores(threadID: 1, bindings: rows, everyBinding: rows, things: things, now: now)
    #expect(ResumeRanking.plan(scores).map(\.thing.id) == [1, 3])
  }

  @Test func aFrameOnAGeneratedHostIsNeverAPlace() {
    #expect(ThingKey.isGeneratedFrame("url:k3x9qa7m2p8w4z6t1v5b0n7c.ext-streams.example/k3x9qa7m2p8w4z6t1v5b0n7c/overlay.html"))
    #expect(!ThingKey.isGeneratedFrame("url:streams.example/somechannel"))
    #expect(!ThingKey.isGeneratedFrame("url:acme-dashboard.vercel.app/settings"))
    #expect(!ThingKey.isGeneratedFrame("win:com.apple.Notes|k3x9qa7m2p8w4z6t1v5b0n7c"))
    #expect(ThingKey.parent(of: "url:streams.example/somechannel") == "url:streams.example")
    #expect(ThingKey.parent(of: "url:streams.example") == nil)
    #expect(ThingKey.parent(of: "claude:abc") == nil)
  }
}

@Suite struct ResumeFreshnessTests {
  let now: Double = 1_000_000

  func row(_ thread: Int64, _ thing: Int64, _ seconds: Double) -> ThreadBinding {
    ThreadBinding(threadID: thread, thingID: thing, dayStart: now, seconds: seconds, captures: 1, activities: 2)
  }

  /// A place belongs to the thread that holds most of its time; a page shared evenly belongs to nobody.
  @Test func aPlaceBelongsToTheThreadWithMostOfItsTime() {
    let owners = ResumeFreshness.owners(
      bindings: [row(1, 10, 3_000), row(2, 10, 200), row(1, 20, 500), row(2, 20, 500)], now: now)
    #expect(owners[10] == 1)
    #expect(owners[20] == nil)
  }

  /// A thread watched a minute ago, in screenshots no activity holds yet, shows as seen a minute ago.
  @Test func anUnsortedScreenshotMovesItsThreadsLastSeenTime() {
    let owners: [Int64: Int64] = [10: 1, 30: 3]
    let seen = [
      ResumeFreshness.Seen(at: now - 300, thingID: 10), ResumeFreshness.Seen(at: now - 60, thingID: 10),
      ResumeFreshness.Seen(at: now - 30, thingID: 99), ResumeFreshness.Seen(at: now - 20, thingID: nil),
    ]
    let last = ResumeFreshness.lastSeen(seen, owners: owners)
    #expect(last == [1: now - 60])
  }

  /// The thread in front is the owner of the newest place on screen.
  @Test func theThreadInFrontIsTheOwnerOfTheNewestPlace() {
    let owners: [Int64: Int64] = [10: 1, 30: 3]
    let seen = [ResumeFreshness.Seen(at: now - 200, thingID: 10), ResumeFreshness.Seen(at: now - 40, thingID: 30)]
    #expect(ResumeFreshness.current(seen, owners: owners, now: now) == 3)
    // Ten minutes on, nothing on screen is recent enough to say.
    #expect(ResumeFreshness.current(seen, owners: owners, now: now + 700) == nil)
  }

  /// Moving from a stream to a window no thread owns, such as the Claude window, leaves no thread in front, so the
  /// stream's thread stays first in the list instead of going last as the one being worked in.
  @Test func aPlaceNoThreadOwnsLeavesNoThreadInFront() {
    let owners: [Int64: Int64] = [10: 1]
    let seen = [ResumeFreshness.Seen(at: now - 60, thingID: 10), ResumeFreshness.Seen(at: now - 5, thingID: 99)]
    #expect(ResumeFreshness.current(seen, owners: owners, now: now) == nil)
    let fresh = [ResumeFreshness.Seen(at: now - 60, thingID: 10), ResumeFreshness.Seen(at: now - 5, thingID: nil)]
    #expect(ResumeFreshness.current(fresh, owners: owners, now: now) == nil)
  }

  /// Screenshots after the latest settled activity are the unsorted ones: an open activity, or one given its thread
  /// only provisionally, does not count as settled.
  @Test func onlyAClosedActivityWithAFinalThreadIsSettled() throws {
    let (_, database) = try temporaryStore()
    var thread = ActivityThread(
      name: "Streams", summary: "", category: .leisure, createdAt: 0, lastSeenAt: 0, activityCount: 1, captions: [])
    try database.writer.write { db in try thread.insert(db) }
    for (id, start, open, provisional) in [("a", 1_000.0, false, false), ("b", 2_000.0, false, true), ("c", 3_000.0, true, false)] {
      try database.insert(
        Capture(
          id: id, at: start, trigger: .timer, displayID: 1, isFocusedDisplay: true,
          context: ForegroundContext(bundleID: "company.thebrowser.dia", appName: "Dia", windowTitle: "x", urlHost: "streams.example", urlPath: "/a"),
          framePath: nil, thumbPath: nil, pixelWidth: 100, pixelHeight: 100, dHash: 0, duplicateOf: nil, ocrState: .done))
      _ = try database.insert(
        Activity(
          firstCaptureID: id, lastCaptureID: id, startAt: start, endAt: start + 60, captureCount: 1, isOpen: open,
          threadID: thread.id, isThreadProvisional: provisional))
    }
    #expect(try database.latestSettledActivityEnd() == 1_060)
  }
}
