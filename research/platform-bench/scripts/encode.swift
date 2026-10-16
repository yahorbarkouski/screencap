import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

// Encoding benchmark. Usage: encode <mode> <files...>
//   mode "lossless": inputs are lossless screenshots (PNG). Each is tested at native, 1x (half) and
//                    1280 px wide; OCR word recall is measured against accurate OCR of the lossless
//                    image at the same scale.
//   mode "webp":     inputs are the old app's 1280 px WebP originals; measures decode time and
//                    re-encode size/time, OCR recall against the decoded WebP.
// WebP encode uses libwebp (WebPEncodeBGRA, default method 4) linked in-process; everything else ImageIO.

struct Variant {
  let name: String
  let encode: (CGImage) -> Data?
}

func imageIOEncode(_ img: CGImage, type: UTType, quality: Double?) -> Data? {
  let data = NSMutableData()
  guard let dest = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
  var props: [CFString: Any] = [:]
  if let quality { props[kCGImageDestinationLossyCompressionQuality] = quality }
  CGImageDestinationAddImage(dest, img, props as CFDictionary)
  guard CGImageDestinationFinalize(dest) else { return nil }
  return data as Data
}

func bgra(_ img: CGImage) -> (UnsafeMutablePointer<UInt8>, Int) {
  let stride = img.width * 4
  let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: stride * img.height)
  let ctx = CGContext(
    data: buf, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: stride,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
  return (buf, stride)
}

func webpEncode(_ img: CGImage, quality: Float) -> Data? {
  let (buf, stride) = bgra(img)
  defer { buf.deallocate() }
  var out: UnsafeMutablePointer<UInt8>? = nil
  let n = WebPEncodeBGRA(buf, Int32(img.width), Int32(img.height), Int32(stride), quality, &out)
  guard n > 0, let out else { return nil }
  defer { WebPFree(out) }
  return Data(bytes: out, count: n)
}

func decode(_ data: Data) -> CGImage? {
  guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
}

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

func ocrWords(_ img: CGImage) async -> [String] {
  var req = RecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  guard let obs = try? await req.perform(on: img) else { return [] }
  let text = obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
  return text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    .filter { $0.count >= 3 }
}

/// Multiset recall of reference words found in candidate words.
func recall(reference: [String], candidate: [String]) -> Double {
  guard !reference.isEmpty else { return 1 }
  var bag: [String: Int] = [:]
  for w in candidate { bag[w, default: 0] += 1 }
  var hit = 0
  for w in reference where (bag[w] ?? 0) > 0 {
    bag[w]! -= 1
    hit += 1
  }
  return Double(hit) / Double(reference.count)
}

let variants: [Variant] = [
  Variant(name: "png") { imageIOEncode($0, type: .png, quality: nil) },
  Variant(name: "jpeg q0.6") { imageIOEncode($0, type: .jpeg, quality: 0.6) },
  Variant(name: "jpeg q0.8") { imageIOEncode($0, type: .jpeg, quality: 0.8) },
  Variant(name: "heic q0.4") { imageIOEncode($0, type: .heic, quality: 0.4) },
  Variant(name: "heic q0.6") { imageIOEncode($0, type: .heic, quality: 0.6) },
  Variant(name: "heic q0.8") { imageIOEncode($0, type: .heic, quality: 0.8) },
  Variant(name: "avif q0.4") { imageIOEncode($0, type: UTType("public.avif")!, quality: 0.4) },
  Variant(name: "avif q0.6") { imageIOEncode($0, type: UTType("public.avif")!, quality: 0.6) },
  Variant(name: "webp q60") { webpEncode($0, quality: 60) },
  Variant(name: "webp q80") { webpEncode($0, quality: 80) },
]

struct Acc {
  var bytes: [Double] = []
  var encMs: [Double] = []
  var decMs: [Double] = []
  var cpuMs: [Double] = []
  var recall: [Double] = []
  var hits = 0
  var refWords = 0
}

@main struct EncodeBench {
  static func main() async {
    let mode = CommandLine.arguments[1]
    let files = Array(CommandLine.arguments.dropFirst(2))
    var acc: [String: Acc] = [:]
    var order: [String] = []
    var sourceBytes: [Double] = []
    var sourceDecode: [Double] = []
    let doOCR = ProcessInfo.processInfo.environment["NO_OCR"] == nil

    for path in files {
      let raw = try! Data(contentsOf: URL(fileURLWithPath: path))
      sourceBytes.append(Double(raw.count))
      let t0 = DispatchTime.now().uptimeNanoseconds
      guard let src = decode(raw) else { continue }
      sourceDecode.append(ms(DispatchTime.now().uptimeNanoseconds - t0))

      var scales: [(String, CGImage)] = []
      if mode == "lossless" {
        scales = [("native \(src.width)w", src), ("half \(src.width / 2)w", resize(src, width: src.width / 2)), ("1280w", resize(src, width: 1280))]
      } else {
        scales = [("\(src.width)w", src)]
      }
      for (scaleName, img) in scales {
        let ref = doOCR ? await ocrWords(img) : []
        for v in variants {
          let key = "\(scaleName) | \(v.name)"
          if acc[key] == nil { acc[key] = Acc(); order.append(key) }
          let u0 = Usage.of()!
          let e0 = DispatchTime.now().uptimeNanoseconds
          guard let data = v.encode(img) else { continue }
          let e1 = DispatchTime.now().uptimeNanoseconds
          let u1 = Usage.of()!
          let d0 = DispatchTime.now().uptimeNanoseconds
          let back = decode(data)
          let d1 = DispatchTime.now().uptimeNanoseconds
          acc[key]!.bytes.append(Double(data.count))
          acc[key]!.encMs.append(ms(e1 - e0))
          acc[key]!.decMs.append(ms(d1 - d0))
          acc[key]!.cpuMs.append(ms((u1 - u0).cpuNs))
          if doOCR, let back, !ref.isEmpty, v.name != "png" {
            let cand = await ocrWords(back)
            let r = recall(reference: ref, candidate: cand)
            acc[key]!.recall.append(r)
            acc[key]!.hits += Int((r * Double(ref.count)).rounded())
            acc[key]!.refWords += ref.count
          }
        }
      }
    }
    print("inputs: \(files.count) files, source mean \(fmt(Stats(values: sourceBytes).mean / 1024)) KB, source decode median \(fmt(Stats(values: sourceDecode).median)) ms")
    print("variant | median KB | mean KB | enc median ms | enc cpu median ms | dec median ms | OCR word recall vs lossless/source")
    for key in order {
      let a = acc[key]!
      let r = a.recall.isEmpty ? "-" : "pooled \(fmt(Double(a.hits) / Double(max(a.refWords, 1)) * 100))% of \(a.refWords) words, per-image median \(fmt(Stats(values: a.recall).median * 100))%"
      print("\(key) | \(fmt(Stats(values: a.bytes).median / 1024)) | \(fmt(Stats(values: a.bytes).mean / 1024)) | \(fmt(Stats(values: a.encMs).median)) | \(fmt(Stats(values: a.cpuMs).median)) | \(fmt(Stats(values: a.decMs).median)) | \(r)")
    }
  }
}
