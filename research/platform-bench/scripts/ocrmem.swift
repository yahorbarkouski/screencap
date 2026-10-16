import CoreGraphics
import Foundation
import ImageIO
import Vision
import Carbon

// Memory footprint of one accurate OCR pass at 1x, and the cost of IsSecureEventInputEnabled.
@main struct OCRMem {
  static func main() async throws {
    let base = Usage.of()!.physFootprint
    let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil)!
    let full = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)!
    let ctx = CGContext(data: nil, width: full.width / 2, height: full.height / 2, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(full, in: CGRect(x: 0, y: 0, width: full.width / 2, height: full.height / 2))
    let img = ctx.makeImage()!
    let loaded = Usage.of()!.physFootprint
    var peak: UInt64 = 0
    for _ in 0..<3 {
      var r = RecognizeTextRequest(); r.usesLanguageCorrection = false
      _ = try await r.perform(on: img)
      peak = max(peak, Usage.of()!.physFootprint)
    }
    try await Task.sleep(nanoseconds: 5_000_000_000)
    let after = Usage.of()!.physFootprint
    print("footprint MB: base \(base / 1_048_576), images loaded \(loaded / 1_048_576), after 3 accurate OCRs \(peak / 1_048_576), 5 s later \(after / 1_048_576)")
    var t: [Double] = []
    for _ in 0..<1000 { let s = DispatchTime.now().uptimeNanoseconds; _ = IsSecureEventInputEnabled(); t.append(Double(DispatchTime.now().uptimeNanoseconds - s)) }
    print("IsSecureEventInputEnabled: median \(fmt(Stats(values: t).median, 0)) ns, now=\(IsSecureEventInputEnabled())")
  }
}
