import Accelerate
import CoreGraphics
import Foundation

/// A cheap signature of a frame for recognising an unchanged screen.
///
/// Both parts come from a 64 × 40 area-averaged grayscale downscale with the menu-bar strip blanked, because the
/// menu-bar clock changes every minute while the content does not. Measured on this Mac, consecutive captures of an
/// unchanged screen give identical signatures.
public struct FrameFingerprint: Sendable, Equatable {
  public static let width = 64
  public static let height = 40
  /// Rows of the 40-row thumbnail covering the menu bar (37 pt of 1117 is 3.3%).
  static let maskedTopRows = 2

  /// 64-bit difference hash of a 9 × 8 downscale.
  public let dHash: UInt64
  /// The 64 × 40 grayscale thumbnail.
  public let gray: [UInt8]

  public init(dHash: UInt64, gray: [UInt8]) {
    self.dHash = dHash
    self.gray = gray
  }

  public init?(image: CGImage) {
    guard var thumbnail = Self.grayscale(image, width: Self.width, height: Self.height) else { return nil }
    for i in 0..<(Self.maskedTopRows * Self.width) { thumbnail[i] = 0 }
    let small = Self.boxResample(thumbnail, width: Self.width, height: Self.height, toWidth: 9, toHeight: 8)
    var hash: UInt64 = 0
    for y in 0..<8 {
      for x in 0..<8 { hash = (hash << 1) | (small[y * 9 + x] > small[y * 9 + x + 1] ? 1 : 0) }
    }
    self.init(dHash: hash, gray: thumbnail)
  }

  /// Mean absolute difference between two thumbnails, 0...255.
  public func meanDifference(to other: FrameFingerprint) -> Double {
    guard gray.count == other.gray.count, !gray.isEmpty else { return .infinity }
    var sum = 0
    for i in gray.indices { sum += abs(Int(gray[i]) - Int(other.gray[i])) }
    return Double(sum) / Double(gray.count)
  }

  /// Share of the thumbnail's cells (menu bar excluded) whose grey level moved by more than `threshold`. A typed line
  /// moves a row of cells (under 3%); a new page or a scrolled feed moves most of them.
  public func changedShare(from other: FrameFingerprint, threshold: Int = 12) -> Double {
    guard gray.count == other.gray.count, !gray.isEmpty else { return 1 }
    let start = Self.maskedTopRows * Self.width
    guard start < gray.count else { return 1 }
    var changed = 0
    for i in start..<gray.count where abs(Int(gray[i]) - Int(other.gray[i])) > threshold { changed += 1 }
    return Double(changed) / Double(gray.count - start)
  }

  /// The screen shows the same thing: identical hash and a thumbnail difference below what one changed line of
  /// small text produces.
  public func isSameScreen(as other: FrameFingerprint) -> Bool {
    dHash == other.dHash && meanDifference(to: other) < 0.75
  }

  /// Area-averaged grayscale downscale through vImage (Core Graphics interpolation aliases at these ratios).
  static func grayscale(_ image: CGImage, width: Int, height: Int) -> [UInt8]? {
    guard
      var format = vImage_CGImageFormat(
        bitsPerComponent: 8, bitsPerPixel: 8, colorSpace: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue))
    else { return nil }
    var source = vImage_Buffer()
    guard vImageBuffer_InitWithCGImage(&source, &format, nil, image, vImage_Flags(kvImageNoFlags)) == kvImageNoError
    else { return nil }
    defer { free(source.data) }
    var output = [UInt8](repeating: 0, count: width * height)
    let status = output.withUnsafeMutableBytes { bytes -> vImage_Error in
      var destination = vImage_Buffer(
        data: bytes.baseAddress, height: vImagePixelCount(height), width: vImagePixelCount(width), rowBytes: width)
      return vImageScale_Planar8(&source, &destination, nil, vImage_Flags(kvImageHighQualityResampling))
    }
    return status == kvImageNoError ? output : nil
  }

  /// Box-filter resample of an 8-bit buffer to a smaller size.
  static func boxResample(_ pixels: [UInt8], width: Int, height: Int, toWidth: Int, toHeight: Int) -> [UInt8] {
    var out = [UInt8](repeating: 0, count: toWidth * toHeight)
    for oy in 0..<toHeight {
      let y0 = oy * height / toHeight
      let y1 = max(y0 + 1, (oy + 1) * height / toHeight)
      for ox in 0..<toWidth {
        let x0 = ox * width / toWidth
        let x1 = max(x0 + 1, (ox + 1) * width / toWidth)
        var sum = 0
        for y in y0..<y1 { for x in x0..<x1 { sum += Int(pixels[y * width + x]) } }
        out[oy * toWidth + ox] = UInt8(sum / ((y1 - y0) * (x1 - x0)))
      }
    }
    return out
  }
}
