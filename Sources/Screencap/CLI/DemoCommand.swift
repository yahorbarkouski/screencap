import Foundation
import ScreencapCore

/// `Screencap demo-store --store DIR --pages DIR`: fills an empty folder with the made-up yesterday (`DemoStore`),
/// its frames built by `FakeScreens` from the public pages captured into `--pages` by `scripts/capture-pages.sh`, reads
/// their text with the OCR helper, then writes the day's headline and the thread covers with stand-ins for the models. The README's screenshots are taken
/// on it, so they show the app on a day that is nobody's, and no model is ever asked.
@MainActor
enum DemoCommand {
  static let headline = "SwiftUI, a Kyoto plan and the Rust book"

  static func run(location: StoreLocation, pages: URL) async throws {
    guard !FileManager.default.fileExists(atPath: location.databaseURL.path) else {
      throw CocoaError(.fileWriteFileExists, userInfo: [NSLocalizedDescriptionKey: "\(location.root.path) already holds a store"])
    }
    let database = try location.openDatabase()
    let result = try DemoStore.build(database: database, location: location) { try FakeScreens.image($0, pages: pages) }
    let ocr = OCRRunner(database: database, location: location, helperURL: Helpers.ocr)
    while try await !ocr.runBatch().isEmpty {}
    await ocr.stopHelper()
    let engine = UnderstandingEngine(
      database: database, location: location, decider: DemoDecider(preferred: result.heroCaptures),
      writer: DemoWriter(headline: headline), config: UnderstandingConfig())
    let model = AppModel(database: database, location: location, settings: SettingsStore(defaults: UserDefaults(suiteName: "com.screencaping.demo")!))
    model.understanding = UnderstandingDriver(engine: engine, database: database)
    model.go(toDay: result.day)
    for _ in 0..<100 where model.story == nil { try await Task.sleep(for: .milliseconds(100)) }
    model.section = .threads
    model.refresh()
    for _ in 0..<200 where model.isLoadingCovers { try await Task.sleep(for: .milliseconds(100)) }
    let frames = try FileManager.default.subpathsOfDirectory(atPath: location.root.appendingPathComponent("Frames").path).filter { $0.hasSuffix(".heic") }
    print("demo-store: \(result.threadIDs.count) threads, \(model.timeline.items.count) timeline items, \(frames.count) frames, headline \"\(model.story?.headline ?? "none")\", \(model.covers.count) covers")
  }
}
