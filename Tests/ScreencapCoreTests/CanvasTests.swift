import CoreGraphics
import Foundation
import Testing

@testable import ScreencapCore

private let browser = "company.thebrowser.dia"

@Suite struct SiteNamesTests {
  func seen(_ title: String, _ host: String?, _ path: String? = "/", thread: Int64? = 1, count: Int = 1, bundle: String = browser) -> SeenTitle {
    SeenTitle(bundleID: bundle, appName: "Browser", host: host, path: path, title: title, threadID: thread, count: count)
  }

  @Test func aSiteIsCalledWhatItsTitlesCallIt() {
    let names = SiteNames([
      seen("Harbour cam - StreamHub", "www.streamhub.example", "/harbour"), seen("Night trains - StreamHub", "www.streamhub.example", "/trains"),
    ])
    #expect(names.name("streamhub.example") == "StreamHub")
    #expect(names.label(title: "Harbour cam - StreamHub", host: "streamhub.example", bundleID: browser) == "Harbour cam")
  }

  @Test func aSiteWithNoNameOfItsOwnIsItsDomain() {
    let names = SiteNames([])
    #expect(names.name("acme-tools.example") == "Acme tools")
    #expect(names.name("mail.acme.co.uk") == "Acme")
    #expect(names.name("preview-build.vercel.app") == "Preview build")
    #expect(names.name("127.0.0.1:3000") == "localhost")
  }

  @Test func severalPlacesOfOneCompanyKeepTheirOwnNames() {
    let names = SiteNames([seen("A", "docs.acme.example"), seen("B", "meet.acme.example"), seen("C", "calendar.acme.example")])
    #expect(names.name("docs.acme.example") == "Acme Docs")
  }

  @Test func theProfileABrowserWritesInFrontIsNotPartOfTheTitle() {
    let names = SiteNames((0..<20).map { seen("Home: (\($0)) Page \($0)", "site.example", "/\($0)") })
    #expect(names.stable("Home: (3) Trains", bundleID: browser) == "Trains")
    #expect(names.stable("Chapter 2: Trains", bundleID: browser) == "Chapter 2: Trains")
  }

  @Test func aTitleTheBrowserCutIsFilledInFromAnotherScreenshot() {
    let names = SiteNames([seen("How bridges are built, part one - StreamHub", "streamhub.example", "/watch"), seen("Other - StreamHub", "streamhub.example")])
    #expect(names.label(title: "How bridges are bui…", host: "streamhub.example", bundleID: browser) == "How bridges are built, part one")
    #expect(names.label(title: "harbour_cam - Str…", host: "streamhub.example", bundleID: browser) == "harbour_cam")
    #expect(names.label(title: "harbour_cam -…", host: "streamhub.example", bundleID: browser) == "harbour_cam")
  }

  @Test func aFrameStandsForThePageItIsIn() {
    let names = SiteNames([
      seen("Harbour cam - StreamHub", "www.streamhub.example", "/harbour", count: 20),
      seen("Harbour cam - StreamHub", "k3x9qa7m2p8w4z6t1v5b0n7c.ext-streamhub.example", "/overlay.html", count: 80),
      seen("Harbour cam - StreamHub", "chat.ext-streamhub.example", "/", count: 9),
    ])
    for host in ["k3x9qa7m2p8w4z6t1v5b0n7c.ext-streamhub.example", "chat.ext-streamhub.example"] {
      #expect(
        names.page(host: host, path: "/overlay.html", title: "(4) Harbour cam - StreamHub", bundleID: browser)
          == SiteNames.Page(host: "streamhub.example", path: "/harbour"))
    }
    // A window whose address was not read is the page its title belongs to.
    #expect(names.page(host: nil, path: nil, title: "Harbour cam - StreamHub", bundleID: browser)?.host == "streamhub.example")
  }

  @Test func anAddressOfManyPagesIsTold() {
    let names = SiteNames((0..<10).map { seen("Video \($0) - StreamHub", "streamhub.example", "/watch") } + [seen("Mine", "streamhub.example", "/me")])
    #expect(names.ambiguous == ["streamhub.example/watch"])
  }
}

@Suite struct CanvasGrouperTests {
  let day = 1_000_000.0

  func capture(
    _ id: String, at: Double, app: String = "Browser", bundle: String = browser, title: String?, host: String? = nil, path: String? = nil,
    hash: Int64 = 0, duplicateOf: String? = nil
  ) -> Capture {
    Capture(
      id: id, at: day + at, trigger: .timer, displayID: 1, isFocusedDisplay: true,
      context: ForegroundContext(bundleID: bundle, appName: app, windowTitle: title, urlHost: host, urlPath: path), framePath: "f/\(id)",
      thumbPath: duplicateOf == nil ? "t/\(id)" : nil, pixelWidth: 1600, pixelHeight: 1000, dHash: hash, duplicateOf: duplicateOf, ocrState: .done)
  }

  func activity(_ id: Int64, thread: Int64?, from: Double, to: Double, title: String? = nil) -> Activity {
    Activity(
      id: id, firstCaptureID: "", lastCaptureID: "", startAt: day + from, endAt: day + to, captureCount: 1, isOpen: false, threadID: thread,
      title: title)
  }

  func grouper(_ seen: [SeenTitle] = []) -> CanvasGrouper { CanvasGrouper(seen: seen, sessions: ClaudeSessionIndex(sessions: [])) }

  func canvas(_ grouper: CanvasGrouper, _ activities: [Activity], _ captures: [Capture]) -> CanvasDay {
    grouper.day(activities: activities, captures: captures, threads: [1: "Streams", 2: "Work"], from: day, to: day + 86_400)
  }

  /// A minute apart, each screen unlike the one before.
  func minutes(_ prefix: String, from: Double, count: Int, title: String, host: String, path: String) -> [Capture] {
    (0..<count).map { index in
      capture(
        "\(prefix)\(index)", at: from + Double(index) * 60, title: title, host: host, path: path, hash: index.isMultiple(of: 2) ? 0 : -1)
    }
  }

  @Test func comingBackToAStreamIsOneThing() throws {
    var activities: [Activity] = []
    var captures: [Capture] = []
    for visit in 0..<3 {
      let start = Double(visit) * 1200
      activities.append(activity(Int64(visit * 2 + 1), thread: 1, from: start, to: start + 600, title: "Name \(visit)"))
      captures += minutes("s\(visit)-", from: start, count: 10, title: "(\(visit)) Harbour cam", host: "streamhub.example", path: "/harbour")
      activities.append(activity(Int64(visit * 2 + 2), thread: 2, from: start + 600, to: start + 1200))
      captures += minutes("w\(visit)-", from: start + 600, count: 10, title: "Spec", host: "docs.example", path: "/spec")
    }
    let result = canvas(grouper(), activities, captures)
    #expect(result.threads.map(\.name) == ["Streams", "Work"])
    let things = result.threads[0].things
    #expect(things.map(\.title) == ["Harbour cam"])
    #expect(things[0].seconds == 1800)
    #expect(things[0].visits.count == 3)
    #expect(things[0].shots.count == 30)
    #expect(things[0].searchText.contains("name 1"))
  }

  @Test func shortPagesFoldIntoTheirSiteAndPassingOnesIntoTheLastGroup() throws {
    var captures = minutes("a", from: 0, count: 20, title: "Spec", host: "docs.example", path: "/spec")
    for page in 0..<2 { captures += minutes("b\(page)", from: 1200 + Double(page) * 120, count: 2, title: "Post \(page)", host: "feed.example", path: "/\(page)") }
    captures += minutes("c", from: 1440, count: 1, title: "Map", host: "maps.example", path: "/")
    captures += minutes("d", from: 1500, count: 1, title: "Weather", host: "sky.example", path: "/")
    let things = canvas(grouper(), [activity(1, thread: 2, from: 0, to: 1560)], captures).threads[0].things
    #expect(things.map(\.kind) == [.page, .site, .rest])
    #expect(things.map(\.title) == ["Spec", "Feed", "Sky, Maps"] || things.map(\.title) == ["Spec", "Feed", "Maps, Sky"])
    #expect(things.reduce(0) { $0 + $1.seconds } == 1560)
  }

  @Test func aScreenshotBelongsToTheActivityItFallsIn() {
    let activities = [activity(1, thread: 1, from: 0, to: 300), activity(2, thread: 2, from: 300, to: 600)]
    let captures =
      minutes("a", from: 0, count: 5, title: "Harbour cam", host: "streamhub.example", path: "/harbour")
      + minutes("b", from: 300, count: 5, title: "Spec", host: "docs.example", path: "/spec")
    let result = canvas(grouper(), activities, captures)
    for thread in result.threads {
      #expect(thread.things.flatMap(\.shots).allSatisfy { $0.activityID == thread.id })
      #expect(thread.seconds == 300)
    }
  }

  @Test func aTitleSeenInManyThreadsIsThePlace() {
    let seen = (0..<6).map {
      SeenTitle(bundleID: "chat.app", appName: "Chat", title: "Me @ account", threadID: Int64($0), count: 1)
    }
    let captures = (0..<5).map {
      capture("c\($0)", at: Double($0) * 60, app: "Chat", bundle: "chat.app", title: "Me @ account", hash: $0.isMultiple(of: 2) ? 0 : -1)
    }
    let things = canvas(grouper(seen), [activity(1, thread: 1, from: 0, to: 300)], captures).threads[0].things
    #expect(things.map(\.title) == ["Chat"])
    #expect(things[0].place == "")
  }

  @Test func aTitleNeverShownWholeTakesTheNameOfTheActivityItFilled() {
    let captures = minutes("a", from: 0, count: 10, title: "How bridges are bui…", host: "streamhub.example", path: "/bridges")
    let things = canvas(grouper(), [activity(1, thread: 1, from: 0, to: 600, title: "Bridge documentary")], captures).threads[0].things
    #expect(things[0].title == "Bridge documentary")
    #expect(things[0].place == "Streamhub")
  }

  @Test func unchangedScreensAreShownOnceAndCountAsTime() {
    var captures = [capture("a", at: 0, title: "Spec", host: "docs.example", path: "/spec")]
    for index in 1..<10 { captures.append(capture("d\(index)", at: Double(index) * 60, title: "Spec", host: "docs.example", path: "/spec", duplicateOf: "a")) }
    let things = canvas(grouper(), [activity(1, thread: 2, from: 0, to: 600)], captures).threads[0].things
    #expect(things[0].shots.count == 1)
    #expect(things[0].seconds == 600)
    #expect(things[0].visits.count == 1)
  }

  @Test func activitiesWithNoThreadAreOneBlock() {
    let captures =
      minutes("a", from: 0, count: 5, title: "Spec", host: "docs.example", path: "/spec")
      + minutes("b", from: 300, count: 20, title: "New", host: "new.example", path: "/a")
    let result = canvas(grouper(), [activity(1, thread: 2, from: 0, to: 300), activity(2, thread: nil, from: 300, to: 1500)], captures)
    #expect(result.threads.map(\.name) == ["Not sorted yet", "Work"])
  }

  @Test func aPictureIsCutToTheWindowAndTheFrameIsFilled() {
    let shot = CanvasShot(
      captureID: "a", activityID: 1, at: 0, thumbPath: "t", framePath: nil, pixelWidth: 1600, pixelHeight: 1000,
      crop: ScreenRect(x: 0.2, y: 0.1, width: 0.4, height: 0.8))
    #expect(abs(shot.aspect - 0.8) < 1e-9)
    let fill = shot.fill(1.6)
    // As wide as the window, from its top, and as tall as the frame's shape allows.
    #expect(fill.x == 0.2 && fill.y == 0.1 && fill.width == 0.4)
    #expect(abs(fill.height - 0.4) < 1e-9)
    let wide = CanvasShot(captureID: "b", activityID: 1, at: 0, thumbPath: "t", framePath: nil, pixelWidth: 3200, pixelHeight: 1000, crop: nil).fill(1.6)
    #expect(wide.x == 0.25 && wide.width == 0.5 && wide.height == 1)
  }
}

@Suite struct CanvasLayoutTests {
  func thing(_ id: String, minutes: Double, kind: CanvasThing.Kind = .page) -> CanvasThing {
    let shot = CanvasShot(captureID: id, activityID: 1, at: 0, thumbPath: "t", framePath: nil, pixelWidth: 1600, pixelHeight: 1000, crop: nil)
    return CanvasThing(
      id: id, kind: kind, title: id, place: "", icon: .app("a"), bundleID: nil, seconds: minutes * 60, visits: [], shots: [shot], cover: 0, searchText: "")
  }

  func thread(_ id: Int64, _ things: [CanvasThing]) -> CanvasThread {
    CanvasThread(id: id, name: "T\(id)", seconds: things.reduce(0) { $0 + $1.seconds }, things: things)
  }

  func layout(_ threads: [CanvasThread], _ size: CGSize = CGSize(width: 1440, height: 800)) -> CanvasLayout {
    CanvasLayout(CanvasDay(threads: threads, span: 0...1), fitting: size)
  }

  @Test func aThreadIsAsWideAsItsTime() {
    let result = layout([thread(1, [thing("a", minutes: 120)]), thread(2, [thing("b", minutes: 20)]), thread(3, [thing("c", minutes: 2)])])
    #expect(result.blocks.map(\.size) == [.large, .medium, .small])
    #expect(result.blocks[0].frame.width > result.blocks[1].frame.width * 2)
    #expect(result.blocks.allSatisfy { $0.frame.maxX <= result.size.width && $0.frame.maxY <= result.size.height })
  }

  @Test func nothingOverlaps() {
    var threads = [thread(1, [thing("a", minutes: 100)] + (0..<12).map { thing("a\($0)", minutes: 4) })]
    for index in 2..<30 { threads.append(thread(Int64(index), (0..<(index % 5 + 1)).map { thing("\(index)-\($0)", minutes: Double(40 - index)) })) }
    let result = layout(threads)
    #expect(result.blocks.count == 29)
    for (index, a) in result.blocks.enumerated() {
      for b in result.blocks.dropFirst(index + 1) { #expect(!a.frame.intersects(b.frame), "\(a.thread.name) and \(b.thread.name)") }
      for plate in a.plates { #expect(a.frame.insetBy(dx: -1, dy: -1).contains(plate.frame)) }
    }
    // What has no picture is still named.
    #expect(result.blocks[0].plates.count + result.blocks[0].also.count == 13)
  }

  @Test func theDayIsShapedToTheWindow() {
    let threads = (1..<20).map { thread(Int64($0), [thing("\($0)", minutes: 15)]) }
    let wide = layout(threads, CGSize(width: 2400, height: 700)), tall = layout(threads, CGSize(width: 700, height: 1400))
    #expect(wide.size.width / wide.size.height > tall.size.width / tall.size.height)
  }

  @Test func anEmptyDayHasNothing() {
    #expect(layout([]).blocks.isEmpty)
  }
}
