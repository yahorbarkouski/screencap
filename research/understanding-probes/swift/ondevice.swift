// On-device probe: Apple Foundation Models availability + naming latency, NLEmbedding sentence-embedding retrieval. Synthetic text only.
import Foundation
import NaturalLanguage
#if canImport(FoundationModels)
import FoundationModels
#endif

let threads: [String: String] = [
 "T01": "weather-widget: personal TypeScript side project (forecast merging, DST bugs), repo weather-widget, GitHub, code editor",
 "T02": "budget-tracker at Acme: day-job React + Postgres app, repo acme/budget-tracker, charts and reports",
 "T03": "Learning Rust: The Rust Book, Rust playground, exercism exercises, tutorials",
 "T04": "Watching chess content: YouTube chess videos and Twitch chess streams",
 "T05": "Baking sourdough: starter feeding, recipes, buying flour",
 "T06": "Lisbon trip planning: flights, hotels, itinerary for November",
 "T07": "Interview prep for Globex: system design notes, algorithm practice",
 "T08": "Family chat: messages with Mom and Dad, sharing photos",
 "T09": "Household bills: electricity, internet, rent payments and receipts",
 "T11": "Acme Q4 planning: roadmap drafts, OKRs, planning docs",
 "T14": "Reading the sci-fi novel 'The Long Orbit' on Kindle",
 "T16": "Apartment renovation: bathroom tiles, contractor emails, quotes",
]
let queries: [(String, String)] = [
 ("T01", "Chrome stackoverflow.com 'Intl.DateTimeFormat returns wrong offset after DST change'; then Code editor weather-widget src/forecast/fetch.ts"),
 ("T02", "Code editor acme-budget-tracker src/reports/MonthlyChart.tsx; Terminal psql budget_dev 'SELECT category, sum(amount)'"),
 ("T03", "Chrome exercism.org Rust track: 'Lifetimes' exercise, failing test output"),
 ("T04", "Twitch 'GM blitz marathon — 3+0 arena' live stream, chat scrolling"),
 ("T05", "Chrome bakers-forum.example 'rye starter hydration too wet?'"),
 ("T06", "Chrome booking.example 'Hotels in Alfama, 12–16 Nov'"),
 ("T07", "Chrome leetcode.example 'LRU Cache — Medium'; Notes 'Globex onsite: system design checklist'"),
 ("T08", "WhatsApp chat 'Dad': 'happy birthday! here are the photos from the lake'"),
 ("T09", "Chrome isp.example.com 'Pay invoice — October internet service'"),
 ("T11", "Google Sheets 'Acme Q4 OKRs' editing key results"),
 ("T14", "Kindle 'The Long Orbit — Chapter 14: Perihelion'"),
 ("T16", "Mail 'Re: bathroom tile quote — revised' from contractor"),
]

func now() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1e6 }

if let emb = NLEmbedding.sentenceEmbedding(for: .english) {
    let t0 = now()
    var hits = 0
    for (truth, q) in queries {
        var best = ("", Double.infinity)
        for (id, card) in threads { let d = emb.distance(between: q, and: card, distanceType: .cosine); if d < best.1 { best = (id, d) } }
        if best.0 == truth { hits += 1 }
    }
    print("NLEmbedding.sentenceEmbedding dim=\(emb.dimension) recall@1=\(hits)/\(queries.count) total_ms=\(Int(now() - t0)) for \(queries.count * threads.count) pair distances")
} else { print("NLEmbedding sentence embedding unavailable") }

if #available(macOS 14.0, *) {
    if let ce = NLContextualEmbedding(language: .english) {
        print("NLContextualEmbedding english: dim=\(ce.dimension) hasAvailableAssets=\(ce.hasAvailableAssets) maxSeqLen=\(ce.maximumSequenceLength)")
    }
}

#if canImport(FoundationModels)
if #available(macOS 26.0, *) {
    let model = SystemLanguageModel.default
    print("FoundationModels availability: \(model.availability)")
    if case .available = model.availability {
        let sem = DispatchSemaphore(value: 0)
        Task {
            let instructions = "You name threads of computer activity. Reply with a 2 to 5 word title only."
            let inputs = [
                "Activities: editing weather-widget src/forecast/merge.ts; running npm test (DST shift failing); reading MDN Intl.DateTimeFormat timeZone; opening PR 'Fix DST shift in mergeForecasts'.",
                "Activities: Twitch 'GM blitz marathon'; YouTube 'Top 10 chess blunders of 2026'; YouTube 'Magnus vs Hikaru recap'.",
                "Activities: recipes.example 'Sourdough starter feeding schedule'; shop.example 'Rye flour 1kg'; bakers-forum 'rye starter hydration'.",
            ]
            for inp in inputs {
                let session = LanguageModelSession(instructions: instructions)
                let t0 = now()
                do {
                    let r = try await session.respond(to: inp)
                    print("FM name: \(r.content.trimmingCharacters(in: .whitespacesAndNewlines))  [\(Int(now() - t0)) ms]")
                } catch { print("FM error: \(error)") }
            }
            sem.signal()
        }
        sem.wait()
    }
}
#else
print("FoundationModels not importable")
#endif
