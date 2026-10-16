import CoreGraphics
import Foundation
import GRDB
import Testing

@testable import ScreencapCore

/// Two days of a person's history in Los Angeles, read by the agent tools through a read-only connection:
///
/// | Activity | When (local) | Thread | Screens |
/// |---|---|---|---|
/// | 1 "Fushimi Inari" | 2026-10-14 10:00–10:20 | Kyoto trip | Safari on Wikipedia: kept 10:00 (a frame with a window), duplicate 10:10, kept 10:19 |
/// | 2 "Ownership chapter" | 2026-10-15 09:00–09:30 | Rust book | Safari on the Rust book: 09:00, 09:15 |
/// | 3 "Kyoto hotels" | 2026-10-15 09:30–09:45 | Kyoto trip | Safari on booking.com: 09:30 |
/// | 4, open | 2026-10-15 14:50–14:59 | none yet | Xcode: 14:50, 14:58 (a frame) |
///
/// "Now" is 2026-10-15 15:00.
struct AgentFixture {
  let directory: URL
  let location: StoreLocation
  let writable: AppDatabase
  let tools: AgentTools
  let time = AgentTime(timeZone: TimeZone(identifier: "America/Los_Angeles")!)
  let ids: [String: Int64]

  func at(_ text: String) -> Double { time.moment(text, now: 0)! }

  init() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("agents-\(UUID().uuidString)")
    let location = StoreLocation(root: directory)
    let writable = try location.openDatabase()
    let time = AgentTime(timeZone: TimeZone(identifier: "America/Los_Angeles")!)
    func at(_ text: String) -> Double { time.moment(text, now: 0)! }

    var kyoto = ActivityThread(
      name: "Kyoto trip", summary: "Planning a week in Kyoto.", category: .chores, createdAt: at("2026-10-14 10:00"),
      lastSeenAt: at("2026-10-15 09:45"), activityCount: 2,
      captions: ["Read about the torii trail at Fushimi Inari.", "Compared hotels near Gion."])
    var rust = ActivityThread(
      name: "Rust book", summary: "Working through the Rust book.", category: .study, createdAt: at("2026-10-15 09:00"),
      lastSeenAt: at("2026-10-15 09:30"), activityCount: 1, captions: ["Read the Rust book's chapter on ownership."])
    try writable.writer.write { db in
      try kyoto.insert(db)
      try rust.insert(db)
      var merged = ActivityThread(name: "Kyoto temples", summary: "", createdAt: 0, lastSeenAt: 0, mergedInto: kyoto.id)
      try merged.insert(db)
    }
    var ids = ["kyoto": kyoto.id!, "rust": rust.id!, "merged": kyoto.id! + 2]

    let safari = ("com.apple.Safari", "Safari")
    func capture(
      _ id: String, _ time: String, app: (String, String) = safari, title: String, host: String? = nil, path: String? = nil,
      duplicateOf: String? = nil, frame: CGImage? = nil, window: ScreenRect? = nil, lines: [String] = []
    ) throws {
      let moment = at(time)
      var framePath: String?
      if let frame {
        framePath = location.frameRelativePath(captureID: id, at: moment)
        try FrameEncoder.writeHEIC(frame, to: location.url(framePath!))
      }
      try writable.insert(
        Capture(
          id: id, at: moment, trigger: .timer, displayID: 1, isFocusedDisplay: true,
          context: ForegroundContext(bundleID: app.0, appName: app.1, windowTitle: title, urlHost: host, urlPath: path),
          framePath: framePath ?? (duplicateOf == nil ? "Frames/missing/\(id).heic" : nil), thumbPath: nil, pixelWidth: 1600,
          pixelHeight: 1000, dHash: 0, duplicateOf: duplicateOf, ocrState: duplicateOf == nil ? .pending : .notNeeded, window: window))
      if !lines.isEmpty {
        let ocr = lines.enumerated().map { OCRLine(text: $1, x: 0.1, y: 0.1 + Double($0) * 0.05, width: 0.5, height: 0.03) }
        try writable.saveOCR(captureID: id, lines: ocr, milliseconds: 10)
      }
    }
    let wiki = (title: "Fushimi Inari-taisha - Wikipedia", host: "en.wikipedia.org", path: "/wiki/Fushimi_Inari-taisha")
    try capture(
      "c1", "2026-10-14 10:00", title: wiki.title, host: wiki.host, path: wiki.path, frame: Self.image(width: 1600, height: 1000),
      window: ScreenRect(x: 0.1, y: 0.1, width: 0.5, height: 0.6),
      lines: ["Fushimi Inari-taisha", "The torii trail winds up the mountain", "Thousands of torii gates"])
    try capture("c2", "2026-10-14 10:10", title: wiki.title, host: wiki.host, path: wiki.path, duplicateOf: "c1")
    try capture(
      "c3", "2026-10-14 10:19", title: wiki.title, host: wiki.host, path: wiki.path,
      lines: ["The torii trail winds up the mountain", "Opening hours"])
    let rustPage = (title: "What Is Ownership? - The Rust Programming Language", host: "doc.rust-lang.org", path: "/book/ch04-01-what-is-ownership.html")
    try capture(
      "c4", "2026-10-15 09:00", title: rustPage.title, host: rustPage.host, path: rustPage.path,
      lines: ["What Is Ownership?", "Each value in Rust has an owner"])
    try capture(
      "c5", "2026-10-15 09:15", title: rustPage.title, host: rustPage.host, path: rustPage.path,
      lines: ["Each value in Rust has an owner", String(repeating: "borrow ", count: 100)])
    try capture("c6", "2026-10-15 09:30", title: "Hotels near Gion", host: "www.booking.com", path: "/searchresults.html", lines: ["Hotels near Gion", "Ryokan with a torii view"])
    let xcode = ("com.apple.dt.Xcode", "Xcode")
    try capture("c7", "2026-10-15 14:50", app: xcode, title: "AgentTools.swift", lines: ["func search(_ args: Arguments)"])
    try capture("c8", "2026-10-15 14:58", app: xcode, title: "AgentTools.swift", frame: Self.image(width: 800, height: 500), lines: ["func search(_ args: Arguments)"])

    func activity(_ first: String, _ last: String, _ start: String, _ end: String, thread: Int64?, title: String?, caption: String?, open: Bool = false) throws -> Int64 {
      try writable.insert(
        Activity(
          firstCaptureID: first, lastCaptureID: last, startAt: at(start), endAt: at(end), captureCount: 1, isOpen: open,
          threadID: thread, caption: caption, title: title)
      ).id!
    }
    ids["a1"] = try activity("c1", "c3", "2026-10-14 10:00", "2026-10-14 10:20", thread: kyoto.id, title: "Fushimi Inari", caption: "Read about the torii trail at Fushimi Inari.")
    ids["a2"] = try activity("c4", "c5", "2026-10-15 09:00", "2026-10-15 09:30", thread: rust.id, title: "Ownership chapter", caption: "Read the Rust book's chapter on ownership.")
    ids["a3"] = try activity("c6", "c6", "2026-10-15 09:30", "2026-10-15 09:45", thread: kyoto.id, title: "Kyoto hotels", caption: "Compared hotels near Gion.")
    ids["a4"] = try activity("c7", "c8", "2026-10-15 14:50", "2026-10-15 14:59", thread: nil, title: nil, caption: nil, open: true)

    let reader = try AppDatabase(readingAt: location.databaseURL.path)
    let now = at("2026-10-15 15:00")
    self.directory = directory
    self.location = location
    self.writable = writable
    self.ids = ids
    tools = AgentTools(database: reader, location: location, time: time, now: { now })
  }

  static func image(width: Int, height: Int) -> CGImage {
    let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    context.setFillColor(CGColor(red: 0.2, green: 0.4, blue: 0.6, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()!
  }

  func call(_ tool: String, _ arguments: JSONValue = [:]) throws -> JSONValue {
    try tools.call(tool, arguments: arguments).structured
  }

  func problem(_ tool: String, _ arguments: JSONValue) -> String? {
    do {
      _ = try tools.call(tool, arguments: arguments)
      return nil
    } catch let problem as AgentTools.Problem {
      return problem.message
    } catch {
      return "unexpected \(error)"
    }
  }
}

@Suite struct AgentToolsTests {
  @Test func searchGivesOneResultPerActivityWithTheMatchMarked() throws {
    let f = try AgentFixture()
    let result = try f.call("search", ["query": "torii trail", "sort": "newest"])
    #expect(result["total"] == 1)
    #expect(result["matched_screens"] == 2)
    let first = try #require(result["results"]?.array?.first)
    #expect(first["activity"] == .number(Double(f.ids["a1"]!)))
    #expect(first["title"] == "Fushimi Inari")
    #expect(first["caption"] == "Read about the torii trail at Fushimi Inari.")
    #expect(first["thread"] == ["id": .number(Double(f.ids["kyoto"]!)), "name": "Kyoto trip"])
    #expect(first["when"] == "2026-10-14 10:00–10:20")
    #expect(first["screens"] == 2)
    #expect(first["match"]?["app"] == "Safari")
    #expect(first["match"]?["url"] == "en.wikipedia.org/wiki/Fushimi_Inari-taisha")
    #expect(first["match"]?["text"]?.string?.contains("The «torii» «trail» winds") == true)
    #expect(result["more"] == false)
  }

  @Test func searchSortsFiltersAndPages() throws {
    let f = try AgentFixture()
    let newest = try f.call("search", ["query": "torii", "sort": "newest"])
    #expect(newest["results"]?.array?.compactMap { $0["activity"]?.number } == [Double(f.ids["a3"]!), Double(f.ids["a1"]!)])
    #expect(newest["matched_screens"] == 3)
    let oldest = try f.call("search", ["query": "torii", "sort": "oldest"])
    #expect(oldest["results"]?.array?.compactMap { $0["activity"]?.number } == [Double(f.ids["a1"]!), Double(f.ids["a3"]!)])

    let today = try f.call("search", ["query": "torii", "from": "today"])
    #expect(today["from"] == "2026-10-15")
    #expect(today["results"]?.array?.count == 1)
    #expect(try f.call("search", ["query": "torii", "to": "2026-10-14"])["total"] == 1)
    #expect(try f.call("search", ["query": "torii", "app": "booking.com"])["total"] == 1)

    let page = try f.call("search", ["query": "torii", "limit": 1])
    #expect(page["results"]?.array?.count == 1)
    #expect(page["more"] == true)
    #expect(page["next_offset"] == 1)
    let second = try f.call("search", ["query": "torii", "limit": 1, "offset": 1])
    #expect(second["more"] == false)
    #expect(second["results"]?.array?.first?["activity"] != page["results"]?.array?.first?["activity"])

    let open = try f.call("search", ["query": "func search", "app": "xcode"])
    #expect(open["results"]?.array?.first?["activity"] == .number(Double(f.ids["a4"]!)))
    #expect(open["results"]?.array?.first?["screens"] == 2)
  }

  @Test func searchWithNoMatchSaysWhatToTry() throws {
    let f = try AgentFixture()
    let result = try f.call("search", ["query": "okonomiyaki"])
    #expect(result["total"] == 0)
    #expect(result["hint"]?.string?.hasPrefix("No screen held every word") == true)
    #expect(f.problem("search", ["query": "  "]) == "search needs query.")
    #expect(f.problem("search", ["query": "torii", "from": "last week"])?.hasPrefix("Could not read from “last week”") == true)
    #expect(f.problem("search", ["query": "torii", "colour": "red"]) == "search has no parameter colour. It takes query, from, to, app, sort, limit, offset.")
  }

  @Test func dayTellsTheStoryInOrder() throws {
    let f = try AgentFixture()
    let day = try f.call("day", ["date": "2026-10-15"])
    #expect(day["date"] == "2026-10-15")
    #expect(day["weekday"] == "Thursday")
    #expect(day["headline"] == nil)
    #expect(day["active_minutes"] == 54)
    #expect(day["span"] == "09:00–14:59")
    #expect(
      day["threads"]
        == [
          ["id": .number(Double(f.ids["rust"]!)), "name": "Rust book", "category": "Study", "minutes": 30, "when": "09:00–09:30"],
          ["id": .number(Double(f.ids["kyoto"]!)), "name": "Kyoto trip", "category": "Chores", "minutes": 15, "when": "09:30–09:45"],
        ])
    #expect(
      day["activities"]
        == [
          ["id": .number(Double(f.ids["a2"]!)), "when": "09:00–09:30", "title": "Ownership chapter", "thread": .number(Double(f.ids["rust"]!))],
          ["id": .number(Double(f.ids["a3"]!)), "when": "09:30–09:45", "title": "Kyoto hotels", "thread": .number(Double(f.ids["kyoto"]!))],
          ["id": .number(Double(f.ids["a4"]!)), "when": "14:50–14:59", "open": true],
        ])
    #expect(day["places"] == [["place": "Xcode", "minutes": 4], ["place": "doc.rust-lang.org", "minutes": 4], ["place": "www.booking.com", "minutes": 2]])
    #expect(try f.call("day", ["date": "yesterday"])["activities"]?.array?.count == 1)
    #expect(try f.call("day")["date"] == "2026-10-15")
    #expect(day["previous_day"] == "2026-10-14")
    #expect(day["next_day"] == nil)
    let before = try f.call("day", ["date": "2026-10-10"])
    #expect(before["note"] == "Nothing was captured on this day. The history begins on 2026-10-14.")
    #expect(before["previous_day"] == nil && before["next_day"] == "2026-10-14")
    let after = try f.call("day", ["date": "2026-10-20"])
    #expect(after["previous_day"] == "2026-10-15")
    #expect(after["note"] == "Nothing was captured on this day. previous_day is the latest day with history.")
    #expect(try f.call("day", ["date": "2026-10-12"])["note"] == "Nothing was captured on this day. The history begins on 2026-10-14.")
    #expect(f.problem("day", ["date": "2026-10-15 09:00"])?.hasPrefix("Could not read date") == true)
  }

  @Test func dayCarriesTheHeadlineTheAppWrote() throws {
    let f = try AgentFixture()
    let start = f.at("2026-10-15")
    let timeline = DayTimeline(activities: try f.writable.activities(from: start, to: start + 86_400), dayStart: start, dayEnd: start + 86_400)
    let input = try #require(
      UnderstandingEngine.dayStoryInput(
        timeline, threadNames: [f.ids["kyoto"]!: "Kyoto trip", f.ids["rust"]!: "Rust book"], clock: TimeFormatter(timeZone: f.time.timeZone)))
    try f.writable.record(
      DecisionRecord(
        kind: "day-story", subject: UnderstandingEngine.dayStorySubject(input), answer: #"{"headline":"Rust and a Kyoto hotel"}"#,
        probability: nil, model: "test", inputTokens: 0, costUSD: 0, latencyMS: 0, createdAt: 0))
    #expect(try f.call("day", ["date": "today"])["headline"] == "Rust and a Kyoto hotel")
  }

  @Test func threadsListTheRangeMostTimeFirst() throws {
    let f = try AgentFixture()
    let week = try f.call("threads")
    #expect(week["from"] == "2026-10-09")
    #expect(week["to"] == "2026-10-15 15:00")
    #expect(
      week["threads"]
        == [
          [
            "id": .number(Double(f.ids["kyoto"]!)), "name": "Kyoto trip", "category": "Chores", "summary": "Planning a week in Kyoto.",
            "minutes": 35, "days": 2, "last_seen": "2026-10-15 09:45",
          ],
          [
            "id": .number(Double(f.ids["rust"]!)), "name": "Rust book", "category": "Study", "summary": "Working through the Rust book.",
            "minutes": 30, "days": 1, "last_seen": "2026-10-15 09:30",
          ],
        ])
    let gion = try f.call("threads", ["query": "gion"])
    #expect(gion["from"] == "all time")
    #expect(gion["threads"]?.array?.map { $0["name"] } == ["Kyoto trip"])
    #expect(try f.call("threads", ["category": "study"])["threads"]?.array?.map { $0["name"] } == ["Rust book"])
    #expect(try f.call("threads", ["from": "2026-10-15", "to": "2026-10-15"])["threads"]?.array?.first?["minutes"] == 30)
    #expect(f.problem("threads", ["category": "Hobby"])?.hasPrefix("Unknown category “Hobby”") == true)
  }

  @Test func threadShowsItsActivitiesAcrossDays() throws {
    let f = try AgentFixture()
    let thread = try f.call("thread", ["id": .number(Double(f.ids["kyoto"]!))])
    #expect(thread["name"] == "Kyoto trip")
    #expect(thread["first_seen"] == "2026-10-14 10:00")
    #expect(thread["last_seen"] == "2026-10-15 09:45")
    #expect(thread["minutes"] == 35)
    #expect(thread["days"] == [["date": "2026-10-15", "minutes": 15], ["date": "2026-10-14", "minutes": 20]])
    #expect(thread["activities"]?.array?.map { $0["when"] } == ["2026-10-15 09:30–09:45", "2026-10-14 10:00–10:20"])
    #expect(thread["activities"]?.array?.first?["caption"] == "Compared hotels near Gion.")

    let merged = try f.call("thread", ["id": .number(Double(f.ids["merged"]!))])
    #expect(merged["id"] == .number(Double(f.ids["kyoto"]!)))
    #expect(merged["merged_from"] == .number(Double(f.ids["merged"]!)))
    let page = try f.call("thread", ["id": .string(String(f.ids["kyoto"]!)), "limit": 1])
    #expect(page["activities"]?.array?.count == 1)
    #expect(page["next_offset"] == 1)
    #expect(f.problem("thread", ["id": 999]) == "There is no thread 999. `threads` lists threads with their ids.")
  }

  @Test func activityGivesPlacesAndDistinctScreenText() throws {
    let f = try AgentFixture()
    let activity = try f.call("activity", ["id": .number(Double(f.ids["a1"]!))])
    #expect(activity["when"] == "2026-10-14 10:00–10:20")
    #expect(activity["minutes"] == 20)
    #expect(activity["thread"] == ["id": .number(Double(f.ids["kyoto"]!)), "name": "Kyoto trip"])
    #expect(
      activity["places"]
        == [
          [
            "app": "Safari", "window": "Fushimi Inari-taisha - Wikipedia", "url": "en.wikipedia.org/wiki/Fushimi_Inari-taisha",
            "at": "2026-10-14 10:00:00", "screens": 3,
          ]
        ])
    #expect(activity["screenshot_at"] == "2026-10-14 10:00:00")
    #expect(activity["screen_text"] == "Fushimi Inari-taisha\nThe torii trail winds up the mountain\nThousands of torii gates\nOpening hours")
    #expect(activity["text_truncated"] == nil)

    let long = try f.call("activity", ["id": .number(Double(f.ids["a2"]!)), "text_limit": 10])
    #expect(long["screen_text"]?.string?.count == 500)
    #expect(long["text_truncated"] == true)
    #expect(f.problem("activity", ["id": 999])?.hasPrefix("There is no activity 999.") == true)
  }

  @Test func nowSaysWhatIsInFrontOfThePerson() throws {
    let f = try AgentFixture()
    let now = try f.call("now")
    #expect(now["now"] == "2026-10-15 15:00")
    #expect(now["time_zone"] == "America/Los_Angeles (UTC-07:00)")
    #expect(now["capture"] == "capturing")
    #expect(now["history_since"] == "2026-10-14 10:00")
    #expect(now["screen"] == ["at": "2026-10-15 14:58:00", "app": "Xcode", "window": "AgentTools.swift", "text": "func search(_ args: Arguments)"])
    #expect(now["activity"] == ["id": .number(Double(f.ids["a4"]!)), "since": "2026-10-15 14:50"])
    #expect(now["earlier_today"]?.array?.map { $0["title"] } == ["Kyoto hotels", "Ownership chapter"])

    try f.writable.insert(Marker(at: f.at("2026-10-15 14:59"), kind: .paused))
    #expect(try f.call("now")["capture"] == "paused by the person")
  }

  @Test func screenshotIsCutToItsWindow() throws {
    let f = try AgentFixture()
    let window = try f.tools.call("screenshot", arguments: ["at": "2026-10-14 10:05"])
    #expect(window.structured["at"] == "2026-10-14 10:00:00")
    #expect(window.structured["crop"] == "window")
    #expect(window.structured["crop_note"] == nil)
    #expect(window.structured["width"] == 800 && window.structured["height"] == 600)
    #expect(window.image?.mimeType == "image/jpeg")
    #expect(window.image?.data.prefix(3) == Data([0xFF, 0xD8, 0xFF]))

    // A duplicate shows the frame it repeats.
    #expect(try f.call("screenshot", ["at": "2026-10-14 10:15:30"])["at"] == "2026-10-14 10:10:00")
    let screen = try f.call("screenshot", ["at": "2026-10-14 10:05", "crop": "screen"])
    #expect(screen["crop"] == "screen" && screen["width"] == 1568 && screen["height"] == 980)
    #expect(screen["crop_note"] == nil)
    let latest = try f.call("screenshot", ["at": "now"])
    #expect(latest["at"] == "2026-10-15 14:58:00")
    #expect(latest["crop"] == "screen")
    #expect(latest["crop_note"] == "Screencap did not record where the window was, so this is the whole display.")

    #expect(
      f.problem("screenshot", ["at": "2026-10-14 12:00"])
        == "No screenshot in the 10 minutes before 2026-10-14 12:00:00; the person was away or capture was off. The latest one before it is at 2026-10-14 10:19:00.")
    #expect(f.problem("screenshot", ["at": "2026-10-14 10:19:30"]) == "The screenshot at 2026-10-14 10:19:00 is no longer on this Mac.")
    #expect(f.problem("screenshot", ["at": "noon"])?.hasPrefix("Could not read “noon”") == true)
  }

  @Test func readOnlyStoreRefusesWrites() throws {
    let f = try AgentFixture()
    #expect(throws: (any Error).self) {
      try f.tools.database.writer.write { db in try db.execute(sql: "DELETE FROM activity") }
    }
    #expect(try f.writable.activities(from: 0, to: .greatestFiniteMagnitude).count == 4)
  }

  @Test func aStoreTheAppClosedStillOpensReadOnly() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("closed-\(UUID().uuidString)")
    let location = StoreLocation(root: directory)
    var app: AppDatabase? = try location.openDatabase()
    try app?.insert(Marker(at: 1, kind: .paused))
    try app?.writer.close()
    app = nil
    let reader = try AppDatabase(readingAt: location.databaseURL.path)
    #expect(try reader.reader.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM marker") } == 1)
  }
}

@Suite struct AgentTimeTests {
  let time = AgentTime(timeZone: TimeZone(identifier: "America/Los_Angeles")!)

  @Test func readsTheFormsAgentsWrite() {
    let now = time.moment("2026-10-15 15:00", now: 0)!
    #expect(time.moment("2026-10-15T15:00:00", now: 0) == now)
    #expect(time.moment("2026-10-15T22:00:00Z", now: 0) == now)
    #expect(time.moment("2026-10-15 18:00-04:00", now: 0) == now)
    #expect(time.moment("now", now: now) == now)
    #expect(time.moment("today", now: now) == time.moment("2026-10-15", now: 0))
    #expect(time.moment("Yesterday", now: now) == time.moment("2026-10-14", now: 0))
    #expect(time.moment("2026-02-30", now: 0) == nil)
    #expect(time.moment("15:00", now: 0) == nil)
    #expect(time.isDay("2026-10-15") && time.isDay("today") && !time.isDay("2026-10-15 09:00"))
  }

  @Test func writesLocalTimes() {
    let start = time.moment("2026-10-15 23:50", now: 0)!
    #expect(time.moment(start) == "2026-10-15 23:50:00")
    #expect(time.span(start, start + 600) == "2026-10-15 23:50–00:00")
    #expect(time.span(start, start + 1200) == "2026-10-15 23:50–2026-10-16 00:10")
    #expect(time.weekday(start) == "Thursday")
    // The day daylight saving ends is 25 hours long.
    let dst = time.moment("2026-11-01", now: 0)!
    #expect(time.startOfNextDay(dst) - dst == 25 * 3600)
  }
}
