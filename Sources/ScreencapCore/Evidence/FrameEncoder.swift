import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

public enum FrameEncoderError: Error {
  case encodingFailed(String)
  case decodingFailed(String)
}

/// Image encoding for stored frames, thumbnails and the decision model's input.
public enum FrameEncoder {
  /// HEIC at quality 0.6 at 1x: about 135 KB and 9 ms of CPU per frame through the hardware encoder.
  public static let frameQuality = 0.6
  public static let thumbnailMaxPixels = 480
  public static let thumbnailQuality = 0.5
  /// What the decision model sees: 1024 px JPEG, as in the experiments.
  public static let modelMaxPixels = 1024
  public static let modelQuality = 0.72

  public static func writeHEIC(_ image: CGImage, to url: URL, quality: Double = frameQuality) throws {
    try write(image, to: url, type: .heic, quality: quality)
  }

  public static func writeThumbnail(_ image: CGImage, to url: URL) throws {
    let scaled = try scale(image, maxPixels: thumbnailMaxPixels)
    try write(scaled, to: url, type: .heic, quality: thumbnailQuality)
  }

  /// A JPEG of a stored frame, downscaled for a model request.
  /// The frame at `url` cut to `crop` (when it is worth cutting to) with its longer side at most `maxPixels`; the
  /// frame is decoded at the size the cut needs, never larger than it is stored.
  public static func image(at url: URL, maxPixels: Int, crop: ScreenRect?) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let crop = crop.flatMap { $0.isWorthCropping ? $0 : nil }
    let scale = crop.map { 1 / max($0.width, $0.height) } ?? 1
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceThumbnailMaxPixelSize: Int((Double(maxPixels) * scale).rounded(.up)),
      kCGImageSourceCreateThumbnailWithTransform: true,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    guard let crop else { return image }
    return image.cropping(to: crop.rect(width: image.width, height: image.height)) ?? image
  }

  /// A JPEG of the frame cut to `crop`, for a model to look at.
  public static func modelJPEG(from url: URL, maxPixels: Int = modelMaxPixels, crop: ScreenRect?) throws -> Data {
    guard let image = image(at: url, maxPixels: maxPixels, crop: crop) else { throw FrameEncoderError.decodingFailed(url.path) }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
      throw FrameEncoderError.encodingFailed("jpeg")
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: modelQuality] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw FrameEncoderError.encodingFailed("jpeg") }
    return data as Data
  }

  public static func modelJPEG(from url: URL, maxPixels: Int = modelMaxPixels) throws -> Data {
    if url.pathExtension.lowercased() == "jpg", let data = try? Data(contentsOf: url),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let w = props[kCGImagePropertyPixelWidth] as? Int, let h = props[kCGImagePropertyPixelHeight] as? Int,
      max(w, h) <= maxPixels
    {
      return data
    }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
      throw FrameEncoderError.decodingFailed(url.path)
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
      kCGImageSourceCreateThumbnailWithTransform: true,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      throw FrameEncoderError.decodingFailed(url.path)
    }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
      throw FrameEncoderError.encodingFailed("jpeg")
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: modelQuality] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw FrameEncoderError.encodingFailed("jpeg") }
    return data as Data
  }

  static func write(_ image: CGImage, to url: URL, type: UTType, quality: Double) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let staging = url.appendingPathExtension("partial")
    guard let destination = CGImageDestinationCreateWithURL(staging as CFURL, type.identifier as CFString, 1, nil) else {
      throw FrameEncoderError.encodingFailed(url.path)
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw FrameEncoderError.encodingFailed(url.path) }
    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    try FileManager.default.moveItem(at: staging, to: url)
  }

  static func scale(_ image: CGImage, maxPixels: Int) throws -> CGImage {
    let longest = max(image.width, image.height)
    guard longest > maxPixels else { return image }
    let factor = Double(maxPixels) / Double(longest)
    let width = max(1, Int(Double(image.width) * factor))
    let height = max(1, Int(Double(image.height) * factor))
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { throw FrameEncoderError.encodingFailed("thumbnail context") }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let scaled = context.makeImage() else { throw FrameEncoderError.encodingFailed("thumbnail") }
    return scaled
  }
}
