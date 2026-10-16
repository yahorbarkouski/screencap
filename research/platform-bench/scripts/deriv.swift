import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Size of small "keep forever" derivatives (HEIC) from lossless native captures.
func resize(_ img: CGImage, width: Int) -> CGImage {
  let h = Int((Double(img.height) * Double(width) / Double(img.width)).rounded())
  let ctx = CGContext(data: nil, width: width, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: width, height: h))
  return ctx.makeImage()!
}
@main struct Deriv { static func main() {
  var sizes: [String: [Double]] = [:]
  for p in CommandLine.arguments.dropFirst() {
    let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil)!
    let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
    for w in [960, 640, 480] { for q in [0.5, 0.6] {
      let d = NSMutableData()
      let dest = CGImageDestinationCreateWithData(d, UTType.heic.identifier as CFString, 1, nil)!
      CGImageDestinationAddImage(dest, resize(img, width: w), [kCGImageDestinationLossyCompressionQuality: q] as CFDictionary)
      CGImageDestinationFinalize(dest)
      sizes["heic \(w)w q\(q)", default: []].append(Double(d.length) / 1024)
    } }
  }
  for k in sizes.keys.sorted() { print("\(k): mean \(fmt(Stats(values: sizes[k]!).mean)) KB median \(fmt(Stats(values: sizes[k]!).median)) KB") }
}}
