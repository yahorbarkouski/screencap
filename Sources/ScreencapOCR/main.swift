// OCR helper. Reads one JSON object per line on stdin, {"id": "...", "path": "/abs/frame.heic"}, recognizes the
// text of each frame and writes one JSON object per line on stdout, {"id", "lines": [...], "ms"} or {"id", "error"}.
// It runs one batch and exits, so Vision's ~240 MB model leaves memory with the process.
import CoreGraphics
import Foundation
import ImageIO
import Vision

struct Job: Decodable {
  let id: String
  let path: String
}

struct Line: Encodable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct Result: Encodable {
  let id: String
  var lines: [Line]? = nil
  var ms: Int? = nil
  var error: String? = nil
}

/// Frames are read at 1280 px on the long side: the resolution of the old app's frames that every measured result
/// used, and about 30% less CPU than 1x for 90% of 1x's words.
let ocrMaxPixels = 1280

func recognize(_ path: String) throws -> [Line] {
  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: ocrMaxPixels,
    kCGImageSourceCreateThumbnailWithTransform: true,
  ]
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
    let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  else { throw NSError(domain: "ocr", code: 1, userInfo: [NSLocalizedDescriptionKey: "cannot decode \(path)"]) }
  // Accurate without language correction: correction triples CPU and rewrites identifiers and URLs.
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  try VNImageRequestHandler(cgImage: image).perform([request])
  return (request.results ?? []).compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    func rounded(_ v: CGFloat) -> Double { (Double(v) * 1000).rounded() / 1000 }
    return Line(
      text: candidate.string, x: rounded(box.minX), y: rounded(1 - box.maxY), width: rounded(box.width),
      height: rounded(box.height))
  }
}

let encoder = JSONEncoder()
let decoder = JSONDecoder()
while let input = readLine(strippingNewline: true) {
  guard !input.isEmpty, let job = try? decoder.decode(Job.self, from: Data(input.utf8)) else { continue }
  var result = Result(id: job.id)
  let started = DispatchTime.now().uptimeNanoseconds
  do {
    result.lines = try autoreleasepool { try recognize(job.path) }
    result.ms = Int((DispatchTime.now().uptimeNanoseconds - started) / 1_000_000)
  } catch {
    result.error = error.localizedDescription
  }
  if let data = try? encoder.encode(result) {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  }
}
