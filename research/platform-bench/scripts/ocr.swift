import CoreGraphics
import Foundation
import ImageIO
import Vision

// OCR benchmark with the Swift Vision API (RecognizeTextRequest, macOS 15+).
// Usage: ocr <label> <files...>   (env HALF=1 also runs each image at half width)
// Reports wall/CPU/energy per image for fast vs accurate, with and without language correction,
// and fast's word recall against accurate.

func load(_ path: String) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
}

func resize(_ img: CGImage, width: Int) -> CGImage {
  let height = Int((Double(img.height) * Double(width) / Double(img.width)).rounded())
  let ctx = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: width, height: height))
  return ctx.makeImage()!
}

func words(_ text: String) -> [String] {
  text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init).filter { $0.count >= 3 }
}

func recall(reference: [String], candidate: [String]) -> Double {
  guard !reference.isEmpty else { return 1 }
  var bag: [String: Int] = [:]
  for w in candidate { bag[w, default: 0] += 1 }
  var hit = 0
  for w in reference where (bag[w] ?? 0) > 0 { bag[w]! -= 1; hit += 1 }
  return Double(hit) / Double(reference.count)
}

struct Config {
  let name: String
  let level: RecognizeTextRequest.RecognitionLevel
  let lc: Bool
}

@main struct OCRBench {
  static func main() async throws {
    let label = CommandLine.arguments[1]
    let files = Array(CommandLine.arguments.dropFirst(2))
    var images: [(String, CGImage)] = files.compactMap { p in load(p).map { (p, $0) } }
    if ProcessInfo.processInfo.environment["HALF"] != nil {
      images = images.map { ($0.0, resize($0.1, width: $0.1.width / 2)) }
    }
    let dims = Set(images.map { "\($0.1.width)x\($0.1.height)" })
    print("[\(label)] \(images.count) images, sizes \(dims.sorted())")

    if ProcessInfo.processInfo.environment["SCALES"] != nil {
      // Cross-scale legibility: share of words read at native resolution that are still read at
      // lower resolutions (accurate, no language correction), pooled over all images.
      var hits: [String: Int] = [:]
      var total = 0
      var lat: [String: [Double]] = [:]
      for (_, img) in images {
        func read(_ im: CGImage) async throws -> ([String], Double) {
          var r = RecognizeTextRequest(); r.usesLanguageCorrection = false
          let t = DispatchTime.now().uptimeNanoseconds
          let o = try await r.perform(on: im)
          return (words(o.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")), ms(DispatchTime.now().uptimeNanoseconds - t))
        }
        let (ref, tn) = try await read(img)
        total += ref.count
        lat["native", default: []].append(tn)
        for (name, w) in [("half", img.width / 2), ("1280w", 1280), ("1024w", 1024)] {
          let (c, tl) = try await read(resize(img, width: w))
          hits[name, default: 0] += Int((recall(reference: ref, candidate: c) * Double(ref.count)).rounded())
          lat[name, default: []].append(tl)
        }
      }
      print("native words: \(total); native accurate latency median \(fmt(Stats(values: lat["native"]!).median)) ms")
      for name in ["half", "1280w", "1024w"] {
        print("  \(name): \(fmt(Double(hits[name]!) / Double(total) * 100))% of native words recovered; accurate latency median \(fmt(Stats(values: lat[name]!).median)) ms")
      }
      return
    }
    let probe = RecognizeTextRequest()
    if label.hasPrefix("lang") {
      print("accurate languages: \(probe.supportedRecognitionLanguages.map { $0.maximalIdentifier })")
      var f = RecognizeTextRequest(); f.recognitionLevel = .fast
      print("fast languages: \(f.supportedRecognitionLanguages.map { $0.maximalIdentifier })")
      return
    }

    // Cold start: first request in the process.
    do {
      var req = RecognizeTextRequest()
      req.recognitionLevel = .accurate
      let t = DispatchTime.now().uptimeNanoseconds
      _ = try await req.perform(on: images[0].1)
      print("cold first accurate request: \(fmt(ms(DispatchTime.now().uptimeNanoseconds - t))) ms")
      var f = RecognizeTextRequest()
      f.recognitionLevel = .fast
      let t2 = DispatchTime.now().uptimeNanoseconds
      _ = try await f.perform(on: images[0].1)
      print("cold first fast request: \(fmt(ms(DispatchTime.now().uptimeNanoseconds - t2))) ms")
    }

    let configs = [
      Config(name: "fast, no LC", level: .fast, lc: false),
      Config(name: "fast, LC", level: .fast, lc: true),
      Config(name: "accurate, no LC", level: .accurate, lc: false),
      Config(name: "accurate, LC", level: .accurate, lc: true),
    ]
    var texts: [String: [String]] = [:]
    for c in configs {
      var wall: [Double] = []
      var cpu: [Double] = []
      var energy: [Double] = []
      var chars: [Double] = []
      var peak: UInt64 = 0
      var out: [String] = []
      for (_, img) in images {
        var req = RecognizeTextRequest()
        req.recognitionLevel = c.level
        req.usesLanguageCorrection = c.lc
        // The Swift API defaults minimumTextHeightFraction to 1/32; fast honours it and then finds
        // no screenshot text at all, so lower it.
        if c.level == .fast { req.minimumTextHeightFraction = 0 }
        let u0 = Usage.of()!
        let obs = try await req.perform(on: img)
        let u1 = Usage.of()!
        let d = u1 - u0
        wall.append(ms(d.wall))
        cpu.append(ms(d.cpuNs))
        energy.append(Double(d.energyNj) / 1e6)
        peak = max(peak, u1.physFootprint)
        let text = obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        chars.append(Double(text.count))
        out.append(text)
      }
      texts[c.name] = out
      print("\(c.name.padding(toLength: 16, withPad: " ", startingAt: 0)) wall med \(fmt(Stats(values: wall).median)) p90 \(fmt(Stats(values: wall).p90)) ms | cpu med \(fmt(Stats(values: cpu).median)) ms | energy med \(fmt(Stats(values: energy).median)) mJ | chars med \(fmt(Stats(values: chars).median, 0)) | footprint \(peak / 1_048_576) MB")
    }
    if let acc = texts["accurate, no LC"], let fast = texts["fast, no LC"], let accLC = texts["accurate, LC"] {
      let r = zip(acc, fast).map { recall(reference: words($0.0), candidate: words($0.1)) }
      let r2 = zip(acc, accLC).map { recall(reference: words($0.0), candidate: words($0.1)) }
      print("fast word recall vs accurate: mean \(fmt(Stats(values: r).mean * 100))% min \(fmt((r.min() ?? 0) * 100))%; accurate+LC vs accurate: mean \(fmt(Stats(values: r2).mean * 100))%")
      let bytes = acc.map { Double($0.utf8.count) }
      print("accurate OCR text bytes per image: median \(fmt(Stats(values: bytes).median, 0)) mean \(fmt(Stats(values: bytes).mean, 0))")
    }
  }
}
