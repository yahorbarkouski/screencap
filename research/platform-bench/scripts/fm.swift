import Foundation
import FoundationModels
import NaturalLanguage

// Apple Foundation Models + NaturalLanguage embedding benchmark on SYNTHETIC text evidence only.
// Usage: fm

@Generable
struct ThreadLabel {
  @Guide(description: "A 2-6 word name for the activity thread, like a task title")
  var title: String
  @Guide(description: "One sentence, at most 14 words, saying what the person did")
  var caption: String
  @Guide(.anyOf(["coding", "writing", "communication", "research", "meeting", "media", "admin", "other"]))
  var category: String
}

let smallEvidence = """
Activity evidence, 14:02-14:31 (synthetic):
- 14:02 Xcode, workspace "Ledger", window "InvoiceExporter.swift"
- 14:05 Safari, github.com/acme/ledger/pull/412 "Fix CSV export rounding"
- 14:09 Xcode, window "InvoiceExporterTests.swift"; OCR: "testRoundingHalfEven failed"
- 14:15 Terminal, title "swift test --filter InvoiceExporterTests"
- 14:22 Slack, channel #ledger-dev; OCR: "pushed a fix for the rounding bug"
- 14:28 Safari, github.com/acme/ledger/pull/412 "All checks have passed"
"""

func bigEvidence(_ repeats: Int) -> String {
  var s = "Activity evidence (synthetic), many captures:\n"
  for i in 0..<repeats {
    s += "- 1\(i % 10):\(10 + i % 50) Xcode \"Ledger\" InvoiceExporter.swift; OCR: func exportCSV(rows: [Invoice]) throws -> Data { let formatter = NumberFormatter(); formatter.roundingMode = .halfEven }\n"
    s += "- 1\(i % 10):\(11 + i % 48) Safari github.com/acme/ledger/pull/412 \"Fix CSV export rounding\"; OCR: review comments, approve, checks passed\n"
  }
  return s
}

@main struct FMBench {
  static func main() async throws {
    let model = SystemLanguageModel.default
    print("availability: \(model.availability)")
    if case .available = model.availability { try await runFM(model) }
    try await runEmbeddings()
  }

  static func runFM(_ model: SystemLanguageModel) async throws {
    print("contextSize: \(model.contextSize) tokens; supported languages: \(model.supportedLanguages.count)")
    let instructions = "You label a person's computer activity from evidence. Be concrete and brief. Never invent facts."
    print("tokens: small evidence \(try await model.tokenCount(for: Prompt(smallEvidence))), instructions \(try await model.tokenCount(for: Instructions(instructions)))")

    // Cold: first session, no prewarm.
    do {
      let s = LanguageModelSession(instructions: instructions)
      let t = DispatchTime.now().uptimeNanoseconds
      let r = try await s.respond(to: "Write a one-line caption (max 14 words) for this activity.\n" + smallEvidence)
      print("COLD plain caption: \(fmt(ms(DispatchTime.now().uptimeNanoseconds - t))) ms -> \(r.content)")
    }
    // Warm plain caption, 5 runs, with time to first token via streaming.
    var ttft: [Double] = []
    var total: [Double] = []
    for _ in 0..<5 {
      let s = LanguageModelSession(instructions: instructions)
      s.prewarm()
      try await Task.sleep(nanoseconds: 300_000_000)
      let t = DispatchTime.now().uptimeNanoseconds
      var first: UInt64 = 0
      var last = ""
      for try await partial in s.streamResponse(to: "Write a one-line caption (max 14 words) for this activity.\n" + smallEvidence) {
        if first == 0 { first = DispatchTime.now().uptimeNanoseconds }
        last = partial.content
      }
      ttft.append(ms(first - t))
      total.append(ms(DispatchTime.now().uptimeNanoseconds - t))
      _ = last
    }
    print("WARM plain caption (~\(try await model.tokenCount(for: Prompt(smallEvidence))) prompt tokens): ttft med \(fmt(Stats(values: ttft).median)) ms, total med \(fmt(Stats(values: total).median)) ms")

    // Guided generation.
    var g: [Double] = []
    var lastLabel: ThreadLabel?
    for _ in 0..<5 {
      let s = LanguageModelSession(instructions: instructions)
      let t = DispatchTime.now().uptimeNanoseconds
      let r = try await s.respond(to: "Name this activity thread.\n" + smallEvidence, generating: ThreadLabel.self)
      g.append(ms(DispatchTime.now().uptimeNanoseconds - t))
      lastLabel = r.content
    }
    print("GUIDED ThreadLabel: med \(fmt(Stats(values: g).median)) ms p90 \(fmt(Stats(values: g).p90)) ms -> \(lastLabel.map { "\($0.title) | \($0.caption) | \($0.category)" } ?? "nil")")

    // Prompt-size scaling.
    for reps in [10, 25, 40] {
      let ev = bigEvidence(reps)
      let n = try await model.tokenCount(for: Prompt(ev))
      let s = LanguageModelSession(instructions: instructions)
      let t = DispatchTime.now().uptimeNanoseconds
      do {
        let r = try await s.respond(to: "Name this activity thread.\n" + ev, generating: ThreadLabel.self)
        print("GUIDED with \(n) prompt tokens: \(fmt(ms(DispatchTime.now().uptimeNanoseconds - t))) ms -> \(r.content.title)")
      } catch {
        print("GUIDED with \(n) prompt tokens: error \(error)")
      }
    }

  }

  static func runEmbeddings() async throws {
    // Embeddings.
    let sentence = "Fixing CSV export rounding in the Ledger app: Xcode InvoiceExporter.swift, GitHub PR 412, Slack #ledger-dev."
    if let e = NLEmbedding.sentenceEmbedding(for: .english) {
      var w: [Double] = []
      for _ in 0..<50 {
        let t = DispatchTime.now().uptimeNanoseconds
        _ = e.vector(for: sentence)
        w.append(Double(DispatchTime.now().uptimeNanoseconds - t) / 1000)
      }
      print("NLEmbedding.sentenceEmbedding(english): dim \(e.dimension), median \(fmt(Stats(values: w).median)) us")
    }
    if let ce = NLContextualEmbedding(language: .english) {
      print("NLContextualEmbedding(english): dim \(ce.dimension), maxSeqLen \(ce.maximumSequenceLength), hasAvailableAssets \(ce.hasAvailableAssets), model \(ce.modelIdentifier)")
      if ce.hasAvailableAssets {
        try ce.load()
        var w: [Double] = []
        for _ in 0..<20 {
          let t = DispatchTime.now().uptimeNanoseconds
          let r = try ce.embeddingResult(for: sentence, language: .english)
          var sum = [Double](repeating: 0, count: ce.dimension)
          r.enumerateTokenVectors(in: sentence.startIndex..<sentence.endIndex) { v, _ in
            for i in 0..<v.count { sum[i] += v[i] }
            return true
          }
          w.append(ms(DispatchTime.now().uptimeNanoseconds - t))
        }
        print("NLContextualEmbedding mean-pooled sentence: median \(fmt(Stats(values: w).median, 2)) ms")
      }
    }
  }
}
