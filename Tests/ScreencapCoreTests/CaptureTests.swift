import CoreGraphics
import Foundation
import Testing

@testable import ScreencapCore

/// A synthetic "screen": a background with optional filled rectangles (top-left origin, in pixels).
func screen(width: Int = 1280, height: Int = 800, gray: CGFloat = 0.95, boxes: [(CGRect, CGFloat)] = []) -> CGImage {
  let context = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  context.setFillColor(CGColor(gray: gray, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  for (rect, shade) in boxes {
    context.setFillColor(CGColor(gray: shade, alpha: 1))
    context.fill(CGRect(x: rect.minX, y: CGFloat(height) - rect.maxY, width: rect.width, height: rect.height))
  }
  return context.makeImage()!
}

func temporaryStore() throws -> (StoreLocation, AppDatabase) {
  let location = StoreLocation(
    root: FileManager.default.temporaryDirectory.appendingPathComponent("screencap-tests-\(UUID().uuidString)"))
  return (location, try location.openDatabase())
}

@Suite struct FingerprintTests {
  let editor = [(CGRect(x: 100, y: 100, width: 600, height: 400), CGFloat(0.2))]

  @Test func identicalScreensMatch() {
    let a = FrameFingerprint(image: screen(boxes: editor))!
    let b = FrameFingerprint(image: screen(boxes: editor))!
    #expect(a.isSameScreen(as: b))
  }

  @Test func changedContentDoesNotMatch() {
    let a = FrameFingerprint(image: screen(boxes: editor))!
    let b = FrameFingerprint(image: screen(boxes: editor + [(CGRect(x: 800, y: 300, width: 300, height: 300), 0.1)]))!
    #expect(!a.isSameScreen(as: b))
  }

  @Test func menuBarClockIsIgnored() {
    let a = FrameFingerprint(image: screen(boxes: editor + [(CGRect(x: 1180, y: 2, width: 90, height: 18), 0.1)]))!
    let b = FrameFingerprint(image: screen(boxes: editor + [(CGRect(x: 1180, y: 2, width: 90, height: 18), 0.6)]))!
    #expect(a.isSameScreen(as: b))
  }
}

@Suite struct CaptureGateTests {
  @Test func capturesByDefault() {
    #expect(CaptureGate.evaluate(.init()) == .capture)
  }

  @Test func blocksWithTheRightMarker() {
    var state = CaptureGate.State()
    state.secondsSinceInput = 301
    #expect(CaptureGate.evaluate(state) == .blocked(.idle))
    state = .init()
    state.isSecureInputOn = true
    #expect(CaptureGate.evaluate(state) == .blocked(.secureInput))
    state = .init()
    state.context = ForegroundContext(bundleID: "com.1Password.1password")
    state.excludedBundleIDs = Settings.alwaysExcludedBundleIDs
    #expect(CaptureGate.evaluate(state) == .blocked(.excluded))
    state = .init()
    state.context = ForegroundContext(bundleID: "com.google.Chrome", windowTitle: "New Tab - Google Chrome (Incognito)")
    #expect(CaptureGate.evaluate(state) == .blocked(.excluded))
    state = .init()
    state.isPaused = true
    state.secondsSinceInput = 1000
    #expect(CaptureGate.evaluate(state) == .blocked(.paused))
  }

  @Test func blocksPasswordVaultPages() {
    #expect(CaptureGate.isPasswordPage(host: "vault.bitwarden.com", path: "/"))
    #expect(CaptureGate.isPasswordPage(host: "password-manager", path: "/passwords"))
    #expect(CaptureGate.isPasswordPage(host: "settings", path: "/passwords"))
    #expect(CaptureGate.isPasswordPage(host: "lastpass.com", path: "/vault/"))
    #expect(!CaptureGate.isPasswordPage(host: "lastpass.com", path: "/pricing"))
    #expect(!CaptureGate.isPasswordPage(host: "settings", path: "/appearance"))
    #expect(!CaptureGate.isPasswordPage(host: "github.com", path: "/settings/passwords"))
    var state = CaptureGate.State()
    state.context = ForegroundContext(bundleID: "com.google.Chrome", urlHost: "passwords.google.com")
    #expect(CaptureGate.evaluate(state) == .blocked(.excluded))
  }
}

@Suite struct RecorderTests {
  let context = ForegroundContext(bundleID: "com.todesktop.230313mzl4w4u92", appName: "Cursor", windowTitle: "main.rs")

  @Test func unchangedScreenBecomesDuplicateRow() async throws {
    let (location, database) = try temporaryStore()
    let recorder = CaptureRecorder(database: database, location: location)
    let image = screen(boxes: [(CGRect(x: 100, y: 100, width: 600, height: 400), 0.2)])
    let first = try await recorder.record(.init(image: image, displayID: 1, isFocusedDisplay: true, context: context, trigger: .timer, at: 1000))
    let second = try await recorder.record(.init(image: image, displayID: 1, isFocusedDisplay: true, context: context, trigger: .timer, at: 1060))
    #expect(first.framePath != nil)
    #expect(FileManager.default.fileExists(atPath: location.url(first.framePath!).path))
    #expect(FileManager.default.fileExists(atPath: location.url(first.thumbPath!).path))
    #expect(second.duplicateOf == first.id)
    #expect(second.framePath == nil)
    #expect(second.ocrState == .notNeeded)
    let jobs = try database.dueBackupJobs(now: Date().timeIntervalSince1970 + 1, limit: 10)
    #expect(jobs.count == 1)
  }

  @Test func sameScreenInAnotherContextIsKept() async throws {
    let (location, database) = try temporaryStore()
    let recorder = CaptureRecorder(database: database, location: location)
    let image = screen()
    _ = try await recorder.record(.init(image: image, displayID: 1, isFocusedDisplay: true, context: context, trigger: .timer, at: 1000))
    var other = context
    other.windowTitle = "lib.rs"
    let second = try await recorder.record(.init(image: image, displayID: 1, isFocusedDisplay: true, context: other, trigger: .contextSwitch, at: 1020))
    #expect(second.duplicateOf == nil)
  }
}

@Suite struct StoreTests {
  @Test func ocrTextIsSharedWithDuplicatesAndSearchable() async throws {
    let (location, database) = try temporaryStore()
    let recorder = CaptureRecorder(database: database, location: location)
    let context = ForegroundContext(bundleID: "company.thebrowser.dia", appName: "Dia", windowTitle: "Hotels in Kyoto - Booking.com", urlHost: "www.booking.com")
    let image = screen()
    let first = try await recorder.record(.init(image: image, displayID: 1, isFocusedDisplay: true, context: context, trigger: .timer, at: 1000))
    let second = try await recorder.record(.init(image: image, displayID: 1, isFocusedDisplay: true, context: context, trigger: .timer, at: 1060))
    #expect(try database.capturesAwaitingOCR(limit: 10).map(\.id) == [first.id])
    try database.saveOCR(captureID: first.id, lines: [OCRLine(text: "Ryokan availability results", x: 0.1, y: 0.2, width: 0.3, height: 0.02)], milliseconds: 250)
    #expect(try database.capturesAwaitingOCR(limit: 10).isEmpty)
    #expect(try database.ocrLines(captureID: second.id).map(\.text) == ["Ryokan availability results"])
    #expect(try database.search("ryok").map(\.captureID) == [first.id])
    #expect(Set(try database.search("kyoto").map(\.captureID)) == [first.id, second.id])
    #expect(try database.search("nothing here").isEmpty)
  }
}

@Suite struct CaptureTextTests {
  func line(_ text: String, y: Double, x: Double = 0.1) -> OCRLine { OCRLine(text: text, x: x, y: y, width: 0.2, height: 0.02) }

  @Test func readingOrderDropsMenuBarAndFragments() {
    let lines = [line("File Edit View", y: 0.01), line("Second", y: 0.5), line("First", y: 0.2), line("ab", y: 0.3), line("Right", y: 0.5, x: 0.6)]
    #expect(CaptureText.readingOrder(lines) == ["First", "Second", "Right"])
  }

  @Test func newTextKeepsOnlyChangedLines() {
    let before = [line("Kyoto hotels Booking.com search", y: 0.1), line("Reading the reviews", y: 0.3)]
    let after = [line("Kyoto hotels Bookng.com search", y: 0.1), line("Ryokan availability results for Gion", y: 0.4)]
    #expect(CaptureText.newText(after, previous: before) == "Ryokan availability results for Gion")
    #expect(CaptureText.newText(before, previous: before) == "(no new text)")
  }

  @Test func windowLineMatchesExperimentFormat() {
    let utc = TimeFormatter(timeZone: TimeZone(identifier: "UTC")!)
    let capture = Capture(
      at: 1_792_000_000, trigger: .timer, displayID: 1, isFocusedDisplay: true,
      context: ForegroundContext(appName: "Dia", windowTitle: "Main: What Is Ownership? - The Rust Programming Language", urlHost: "doc.rust-lang.org"),
      framePath: nil, thumbPath: nil, pixelWidth: 1, pixelHeight: 1, dHash: 0, duplicateOf: nil, ocrState: .done)
    let evidence = CaptureEvidence(capture: capture, lines: [line("Each value in Rust has an owner", y: 0.2)])
    #expect(CaptureText.windowLine(evidence, previous: nil, clock: utc) == "17:46 | Dia | Main: What Is Ownership? - The Rust Programming Language | doc.rust-lang.org | new text: Each value in Rust has an owner")
    #expect(CaptureText.activityLine(evidence, ocrLimit: 0, clock: utc) == "[17:46] Dia — Main: What Is Ownership? - The Rust Programming Language — doc.rust-lang.org")
  }
}

@Suite struct PrivateWindowsTests {
  @Test func eachBrowserFamilysMarkerIsRecognised() {
    #expect(PrivateWindows.isPrivate(bundleID: "com.google.Chrome", title: "Privacy - Wikipedia - Google Chrome (Incognito)"))
    #expect(PrivateWindows.isPrivate(bundleID: "com.google.Chrome", title: "Datenschutz – Google Chrome (anonym)"))
    #expect(PrivateWindows.isPrivate(bundleID: "com.brave.Browser", title: "Search - Brave (Private)"))
    #expect(PrivateWindows.isPrivate(bundleID: "company.thebrowser.dia", title: "Work: Inbox", identifier: "bigIncognitoBrowserWindow_1F2E"))
    #expect(PrivateWindows.isPrivate(bundleID: "com.apple.Safari", title: "Apple, Private Browsing"))
    #expect(PrivateWindows.isPrivate(bundleID: "org.mozilla.firefox", title: nil, windowName: "Mozilla Firefox — Private Browsing"))
    #expect(PrivateWindows.isPrivate(bundleID: "org.mozilla.firefox", title: "Wikipedia — Tryb prywatny"))
  }

  @Test func normalWindowsAndOtherAppsAreNot() {
    #expect(!PrivateWindows.isPrivate(bundleID: "com.google.Chrome", title: "Incognito mode explained - Google Chrome"))
    #expect(!PrivateWindows.isPrivate(bundleID: "company.thebrowser.dia", title: "Work: Inbox", identifier: "bigBrowserWindow_1F2E"))
    #expect(!PrivateWindows.isPrivate(bundleID: "com.apple.Safari", title: "Private Browsing on Mac - Apple Support"))
    #expect(!PrivateWindows.isPrivate(bundleID: "com.apple.TextEdit", title: "Notes (Incognito)"))
    #expect(!PrivateWindows.isPrivate(bundleID: nil, title: "Page - Google Chrome (Incognito)"))
  }
}
