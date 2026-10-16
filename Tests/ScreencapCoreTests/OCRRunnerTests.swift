import CoreGraphics
import CoreText
import Foundation
import Testing

@testable import ScreencapCore

/// Runs the real OCR helper that `swift build` puts in `.build/debug` (scripts/verify.sh builds before testing).
@Suite struct OCRRunnerTests {
  static let helper = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent(".build/debug/screencap-ocr")

  /// A white frame with one line of black text.
  static func frame(_ text: String) -> CGImage {
    let context = CGContext(
      data: nil, width: 1600, height: 900, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 1600, height: 900))
    let attributes: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, 56, nil),
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 0, green: 0, blue: 0, alpha: 1),
    ]
    context.textPosition = CGPoint(x: 120, y: 420)
    CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes)), context)
    return context.makeImage()!
  }

  func add(_ text: String, at: Double, to location: StoreLocation, _ database: AppDatabase) throws -> Capture {
    let path = "Frames/\(UUID().uuidString).heic"
    try FrameEncoder.writeHEIC(Self.frame(text), to: location.url(path))
    let capture = Capture(
      at: at, trigger: .timer, displayID: 1, isFocusedDisplay: true, context: ForegroundContext(appName: "Preview"),
      framePath: path, thumbPath: nil, pixelWidth: 1600, pixelHeight: 900, dHash: 0, duplicateOf: nil, ocrState: .pending)
    try database.insert(capture)
    return capture
  }

  @Test func oneHelperReadsSeveralBatchesAndARestartedOneCarriesOn() async throws {
    try #require(FileManager.default.isExecutableFile(atPath: Self.helper.path), "run swift build first")
    let (location, database) = try temporaryStore()
    try FileManager.default.createDirectory(at: location.url("Frames"), withIntermediateDirectories: true)
    let runner = OCRRunner(database: database, location: location, helperURL: Self.helper)

    let first = try add("Quarterly lease annex", at: 1, to: location, database)
    #expect(try await runner.runBatch() == [first.id])
    let helper = try #require(await runner.helperProcessID)
    let second = try add("Second frame of text", at: 2, to: location, database)
    #expect(try await runner.runBatch() == [second.id])
    #expect(await runner.helperProcessID == helper)
    #expect(await runner.liveHelperCPUSeconds() > 0)
    #expect(try database.ocrLines(captureID: first.id).map(\.text).joined(separator: " ").contains("lease"))

    // A helper that died while idle is replaced, and the next frame still gets its text.
    kill(helper, SIGKILL)
    try await Task.sleep(for: .milliseconds(300))
    let third = try add("Third frame after a crash", at: 3, to: location, database)
    #expect(try await runner.runBatch() == [third.id])
    #expect(try database.capture(id: third.id)?.ocrState == .done)
    #expect(await runner.helperProcessID != helper)

    await runner.stopHelper()
    #expect(await runner.helperProcessID == nil)
  }
}
