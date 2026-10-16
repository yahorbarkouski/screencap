import CryptoKit
import Foundation

/// A thread's cover: of a few of its screenshots (one per place it happened at), the one a person would recognise the
/// thread by. Its biggest place is often a conversation about the work (a chat with a coding agent, a Slack thread)
/// while the work itself is a page, a document or a design, so the decision model looks at the candidates, each cut
/// to its window, and picks. One question per candidate set, kept in the decision log. In Text-only mode no model
/// sees them and the first candidate, the place the thread spent longest at, is the cover.
extension UnderstandingEngine {
  static let coverQuestion =
    "Which screenshot would a person recognise this thread by at a glance? Pick the one showing the thing itself the "
    + "thread is about (the page, product, document, design, video, game or code), and a conversation about it only "
    + "when nothing else shows it."

  public func cover(for thread: ActivityThread, candidates: [Capture], now: Double) async throws -> String? {
    guard let threadID = thread.id else { return nil }
    let usable = try candidates.filter { capture in
      guard let path = capture.framePath, FileManager.default.fileExists(atPath: location.url(path).path) else { return false }
      return try !database.ocrLines(captureID: capture.id).contains { SecretScrubber.hadSecret($0.text) }
    }
    // Text-only mode sends no screenshots, so the cover is the main place's frame, chosen here.
    guard usable.count > 1, !config.textOnly else { return usable.first?.id }
    let digest = SHA256.hash(data: Data(usable.map(\.id).joined(separator: ",").utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    let subject = "thread:\(threadID):\(digest)"
    if let earlier = try database.decision(kind: "cover", subject: subject) { return earlier.answer }
    var state: [StatePart] = [.text("Thread: \(thread.name). \(thread.summary)")]
    var options: [ChoiceOption] = []
    for (index, capture) in usable.enumerated() {
      guard let path = capture.framePath,
        let jpeg = try? FrameEncoder.modelJPEG(from: location.url(path), maxPixels: 640, crop: capture.window)
      else { continue }
      state += [.text("Screenshot \(index + 1) (\(capture.context.appName ?? "app")\(capture.context.urlHost.map { ", \($0)" } ?? "")):"), .image(jpeg)]
      options.append(ChoiceOption(key: capture.id, criterion: "Screenshot \(index + 1)"))
    }
    guard options.count > 1 else { return options.first?.key }
    let result = try await decider.decide(state: state, questions: [("cover", .choice(Self.coverQuestion, options))])
    guard let choice = result.answers["cover"]?.choice else { throw ModelError.malformed("cover answer") }
    try database.record(
      DecisionRecord(kind: "cover", subject: subject, answer: choice.key, probability: choice.probability, usage: result.usage, at: now))
    return choice.key
  }
}
