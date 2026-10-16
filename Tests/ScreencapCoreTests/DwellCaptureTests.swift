import CoreGraphics
import Foundation
import GRDB
import Testing

@testable import ScreencapCore

@Suite struct DwellSchedulerTests {
  /// Polls once a second from `from` up to `to`, returning the first trigger due and when.
  func firstDue(_ scheduler: inout DwellScheduler, from: Double, to: Double) -> (CaptureTrigger, Double)? {
    var t = from
    while t <= to {
      if let trigger = scheduler.due(at: t) { return (trigger, t) }
      t += 1
    }
    return nil
  }

  @Test func capturesAtOnceThenAMinuteAfterTheLastCapture() {
    var s = DwellScheduler()
    let result1 = s.due(at: 0)
    #expect(result1 == .timer)
    s.captured(.timer, place: "A", at: 0)
    let next = firstDue(&s, from: 1, to: 120)
    #expect(next?.0 == .timer && next?.1 == 60)
  }

  @Test func aViewIsCapturedOnceItHasHeldTenSeconds() {
    var s = DwellScheduler()
    s.captured(.timer, place: "A", at: 0)
    s.viewChanged(at: 20)
    s.viewChanged(at: 24)
    let next = firstDue(&s, from: 21, to: 59)
    #expect(next?.0 == .view && next?.1 == 34)
  }

  @Test func theScreenIsCapturedTenSecondsAfterItSettles() {
    var s = DwellScheduler()
    s.captured(.timer, place: "A", at: 0)
    s.observe(.init(clicks: 1), at: 20)
    s.observe(.init(scrolls: 12), at: 25)
    let next = firstDue(&s, from: 21, to: 59)
    #expect(next?.0 == .settle && next?.1 == 35)
  }

  @Test func typingIsCapturedThreeSecondsAfterABurst() {
    var s = DwellScheduler()
    s.captured(.timer, place: "A", at: 0)
    for t in [20.0, 21, 22] { s.observe(.init(keys: 3), at: t) }
    let next = firstDue(&s, from: 23, to: 59)
    #expect(next?.0 == .typing && next?.1 == 25)
    s.captured(.typing, place: "A", at: 25)
    // The settle that would follow the same keys was served by the typing capture.
    let result11 = firstDue(&s, from: 26, to: 90)
    #expect(result11?.1 == 85)
  }

  @Test func aFewKeysAreNotABurst() {
    var s = DwellScheduler()
    s.captured(.timer, place: "A", at: 0)
    s.observe(.init(keys: 2), at: 20)
    let next = firstDue(&s, from: 21, to: 59)
    #expect(next?.0 == .settle && next?.1 == 30)
  }

  @Test func eventCapturesAreSpacedTenSecondsApart() {
    var s = DwellScheduler()
    s.captured(.timer, place: "A", at: 0)
    s.viewChanged(at: 0.5)
    let result12 = firstDue(&s, from: 1, to: 59)
    #expect(result12?.1 == 11)
    s.captured(.view, place: "A", at: 11)
    s.observe(.init(clicks: 1), at: 12)
    // Quiet from 12 is due at 22, which is past the spacing.
    let result13 = firstDue(&s, from: 12, to: 59)
    #expect(result13?.1 == 22)
  }

  @Test func aBurstOfEventCapturesIsCapped() {
    var s = DwellScheduler()
    s.captured(.timer, place: "A", at: 0)
    var t = 0.0
    var times: [Double] = []
    for _ in 0..<10 {
      s.viewChanged(at: t + 1)
      guard let (trigger, at) = firstDue(&s, from: t + 1, to: t + 59), trigger == .view else { break }
      s.captured(.view, place: "A", at: at)
      times.append(at)
      t = at
    }
    // A page a second for two minutes: seven captures at the 10 s spacing, then the allowance (4, refilled at 3 a
    // minute) spaces them out towards one every 20 s.
    #expect(times == [11, 22, 33, 44, 55, 66, 77, 92, 111, 131])
  }

  @Test func aBlockedAttemptWaitsForTheNextChangeOrMinute() {
    var s = DwellScheduler()
    s.captured(.timer, place: "A", at: 0)
    s.viewChanged(at: 10)
    let result2 = s.due(at: 20)
    #expect(result2 == .view)
    s.blocked(at: 20)
    let result14 = firstDue(&s, from: 21, to: 79)
    #expect(result14 == nil)
    let result3 = s.due(at: 80)
    #expect(result3 == .timer)
  }

  @Test func anchorsAreTimerFramesNewPlacesAndOneAMinute() {
    var s = DwellScheduler()
    let result4 = s.captured(.timer, place: "A", at: 0)
    #expect(result4)
    let result8 = s.captured(.view, place: "A", at: 15)
    #expect(!result8)
    let result9 = s.captured(.settle, place: "A", at: 40)
    #expect(!result9)
    let result5 = s.captured(.view, place: "B", at: 50)
    #expect(result5)
    let result10 = s.captured(.settle, place: "B", at: 70)
    #expect(!result10)
    let result6 = s.captured(.settle, place: "B", at: 105)
    #expect(result6)
    let result7 = s.captured(.contextSwitch, place: "B", at: 110)
    #expect(result7)
  }
}

@Suite struct EvidenceReadingTests {
  let base = [(CGRect(x: 100, y: 100, width: 600, height: 400), CGFloat(0.2))]

  func frame(_ title: String, at: Double, anchor: Bool, boxes extra: [(CGRect, CGFloat)] = []) -> CapturedFrame {
    CapturedFrame(
      image: screen(boxes: base + extra), displayID: 1, isFocusedDisplay: true,
      context: ForegroundContext(bundleID: "company.thebrowser.dia", appName: "Dia", windowTitle: title),
      trigger: anchor ? .timer : .view, at: at, isAnchor: anchor)
  }

  @Test func evidenceIsReadOnlyWhenNewAndWithinTheAllowance() async throws {
    let (location, database) = try temporaryStore()
    let recorder = CaptureRecorder(database: database, location: location)
    let anchor = try await recorder.record(frame("Feed", at: 1000, anchor: true))
    // One typed line on the same page: kept, but the text is the anchor's.
    let typed = try await recorder.record(
      frame("Feed", at: 1015, anchor: false, boxes: [(CGRect(x: 100, y: 600, width: 900, height: 18), 0.1)]))
    let page1 = try await recorder.record(frame("Post 1", at: 1030, anchor: false))
    let page2 = try await recorder.record(frame("Post 2", at: 1045, anchor: false))
    // Two reads in a row, then one per five minutes.
    let page3 = try await recorder.record(frame("Post 3", at: 1060, anchor: false))
    let page4 = try await recorder.record(frame("Post 4", at: 1360, anchor: false))
    #expect(anchor.ocrState == .pending)
    #expect(typed.framePath != nil && typed.ocrState == .skipped)
    #expect([page1, page2, page3, page4].map(\.ocrState) == [.pending, .pending, .skipped, .pending])
    #expect(try database.capturesAwaitingOCR(limit: 10).map(\.id) == [anchor.id, page1.id, page2.id, page4.id])
    #expect(try database.capture(id: typed.id)?.isAnchor == false)
  }

  @Test func aScreenThatMostlyChangedIsRead() async throws {
    let (location, database) = try temporaryStore()
    let recorder = CaptureRecorder(database: database, location: location)
    _ = try await recorder.record(frame("Feed", at: 1000, anchor: true))
    let scrolled = try await recorder.record(
      frame("Feed", at: 1020, anchor: false, boxes: [(CGRect(x: 0, y: 40, width: 1280, height: 700), 0.5)]))
    #expect(scrolled.ocrState == .pending)
  }
}

@Suite struct AnchorBoundaryTests {
  func add(_ h: Harness, _ app: String, at: Double, anchor: Bool) throws -> Capture {
    let capture = Capture(
      at: at, trigger: anchor ? .timer : .settle, displayID: 1, isFocusedDisplay: true,
      context: ForegroundContext(bundleID: "app.\(app)", appName: app, windowTitle: anchor ? "\(app) window" : "\(app) sidebar"),
      framePath: nil, thumbPath: nil, pixelWidth: 10, pixelHeight: 10, dHash: 0, duplicateOf: nil,
      ocrState: anchor ? .pending : .skipped, isAnchor: anchor)
    try h.database.insert(capture)
    if anchor {
      try h.database.saveOCR(captureID: capture.id, lines: [OCRLine(text: "\(app) content", x: 0.1, y: 0.3, width: 0.3, height: 0.02)], milliseconds: 1)
    }
    return capture
  }

  @Test func onlyAnchorsAreAskedAndEvidenceJoinsTheActivityBeforeIt() async throws {
    let h = try Harness()
    let plan: [(String, Double, Bool)] = [
      ("Cursor", 1000, true), ("Cursor", 1020, false), ("Cursor", 1060, true), ("Dia", 1120, true),
      ("Dia", 1140, false), ("Dia", 1180, true), ("Dia", 1240, true),
    ]
    var captures: [Capture] = []
    for (app, at, anchor) in plan { captures.append(try add(h, app, at: at, anchor: anchor)) }
    try await h.engine.advance(now: 2000)
    let sources = try h.database.boundaries(rightCaptureIDs: captures.map(\.id))
    #expect(sources[captures[1].id]?.source == .evidence)
    #expect(sources[captures[4].id]?.source == .evidence)
    #expect(sources[captures[2].id]?.leftCaptureID == captures[0].id)
    #expect(sources[captures[3].id]?.isBoundary == true)
    let boundaryCalls = h.decider.calls.filter { $0.keys == ["g"] }
    #expect(boundaryCalls.count == 4)
    let windows = boundaryCalls.map { $0.state.compactMap { if case .text(let t) = $0 { t } else { nil } }.joined() }
    #expect(windows.allSatisfy { !$0.contains("sidebar") })
    #expect(try h.activities().map(\.captureCount) == [3, 4])
  }

  @Test func evidenceAfterABreakStartsANewActivity() async throws {
    let h = try Harness()
    _ = try add(h, "Cursor", at: 1000, anchor: true)
    _ = try add(h, "Cursor", at: 1060, anchor: true)
    try h.database.insert(Marker(at: 1070, kind: .screenLocked))
    let evidence = try add(h, "Cursor", at: 1080, anchor: false)
    _ = try add(h, "Cursor", at: 1100, anchor: true)
    try await h.engine.advance(now: 2000)
    let decision = try h.database.boundary(rightCaptureID: evidence.id)
    #expect(decision?.source == .hardBreak && decision?.isBoundary == true)
  }
}
