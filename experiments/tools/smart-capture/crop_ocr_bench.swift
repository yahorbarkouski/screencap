// Measures what OCR of only the changed region of a frame costs and keeps, against OCR of the whole frame.
//
// Reads "previous<TAB>next" frame paths on stdin: consecutive kept frames of one place. For each pair it decodes both
// at 1280 px (as the OCR helper does), finds the tiles that changed, crops the next frame to the changed regions and
// runs the same Vision request on the whole next frame and on the crops, timing process CPU for each. It then checks
// that the text of the whole frame is recovered by the crops' text plus the previous frame's text outside them.
// Prints one JSON line per pair with areas, CPU times and word overlap; never any recognized text.
//
// Build: DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swiftc -O crop_ocr_bench.swift -o crop_ocr_bench

import CoreGraphics
import Foundation
import ImageIO
import Vision

let ocrMaxPixels = 1280
let tile = 16
let tileThreshold = 6.0  // mean absolute grey difference in a tile, out of 255

struct Word {
  let text: String
  let box: CGRect  // pixels, top-left origin
}

func decode(_ path: String) -> CGImage? {
  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: ocrMaxPixels,
    kCGImageSourceCreateThumbnailWithTransform: true,
  ]
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
  return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
}

func grey(_ image: CGImage) -> [UInt8] {
  var pixels = [UInt8](repeating: 0, count: image.width * image.height)
  let context = CGContext(
    data: &pixels, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width,
    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  return pixels
}

func cpuSeconds() -> Double {
  var usage = rusage()
  getrusage(RUSAGE_SELF, &usage)
  return Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec)
    + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1e6
}

/// Words of the image with boxes in the given frame's pixel space, offset by the crop origin.
func recognize(_ image: CGImage, offset: CGPoint = .zero) -> [Word] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: image).perform([request])
  let w = CGFloat(image.width)
  let h = CGFloat(image.height)
  var words: [Word] = []
  for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let b = observation.boundingBox
    let box = CGRect(x: offset.x + b.minX * w, y: offset.y + (1 - b.maxY) * h, width: b.width * w, height: b.height * h)
    for part in candidate.string.split(whereSeparator: { $0.isWhitespace }) {
      words.append(Word(text: String(part), box: box))
    }
  }
  return words
}

/// Bounding rects of connected groups of changed tiles, padded by one tile, overlapping rects merged.
func changedRects(_ a: [UInt8], _ b: [UInt8], width: Int, height: Int) -> [CGRect] {
  let cols = (width + tile - 1) / tile
  let rows = (height + tile - 1) / tile
  var changed = [Bool](repeating: false, count: cols * rows)
  for r in 0..<rows {
    for c in 0..<cols {
      var sum = 0
      var count = 0
      for y in (r * tile)..<min(height, (r + 1) * tile) {
        let base = y * width
        for x in (c * tile)..<min(width, (c + 1) * tile) {
          sum += abs(Int(a[base + x]) - Int(b[base + x]))
          count += 1
        }
      }
      changed[r * cols + c] = Double(sum) / Double(max(1, count)) > tileThreshold
    }
  }
  var seen = [Bool](repeating: false, count: cols * rows)
  var rects: [CGRect] = []
  for start in 0..<(cols * rows) where changed[start] && !seen[start] {
    var stack = [start]
    seen[start] = true
    var minC = cols, maxC = 0, minR = rows, maxR = 0
    while let i = stack.popLast() {
      let r = i / cols, c = i % cols
      minC = min(minC, c); maxC = max(maxC, c); minR = min(minR, r); maxR = max(maxR, r)
      for dr in -2...2 {
        for dc in -2...2 {
          let rr = r + dr, cc = c + dc
          guard rr >= 0, rr < rows, cc >= 0, cc < cols else { continue }
          let j = rr * cols + cc
          if changed[j] && !seen[j] {
            seen[j] = true
            stack.append(j)
          }
        }
      }
    }
    let x0 = max(0, (minC - 1) * tile), y0 = max(0, (minR - 1) * tile)
    let x1 = min(width, (maxC + 2) * tile), y1 = min(height, (maxR + 2) * tile)
    rects.append(CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0))
  }
  var merged = true
  while merged {
    merged = false
    outer: for i in 0..<rects.count {
      for j in (i + 1)..<rects.count where rects[i].intersects(rects[j]) {
        rects[i] = rects[i].union(rects[j])
        rects.remove(at: j)
        merged = true
        break outer
      }
    }
  }
  return rects
}

func overlap(_ reference: [Word], _ candidate: [Word]) -> (recall: Double, precision: Double) {
  var ref: [String: Int] = [:]
  for w in reference { ref[w.text, default: 0] += 1 }
  var cand: [String: Int] = [:]
  for w in candidate { cand[w.text, default: 0] += 1 }
  var common = 0
  for (word, n) in ref { common += min(n, cand[word] ?? 0) }
  return (Double(common) / Double(max(1, reference.count)), Double(common) / Double(max(1, candidate.count)))
}

var warmed = false
while let line = readLine() {
  let parts = line.split(separator: "\t").map(String.init)
  guard parts.count == 2, let previous = decode(parts[0]), let next = decode(parts[1]),
    previous.width == next.width, previous.height == next.height
  else { continue }
  if !warmed {
    _ = recognize(next)
    warmed = true
  }
  let width = next.width, height = next.height
  let rects = changedRects(grey(previous), grey(next), width: width, height: height)
  let area = rects.reduce(0.0) { $0 + Double($1.width * $1.height) } / Double(width * height)

  var t = cpuSeconds()
  let full = recognize(next)
  let fullCPU = cpuSeconds() - t

  t = cpuSeconds()
  var cropWords: [Word] = []
  for rect in rects {
    guard rect.width >= 8, rect.height >= 8, let crop = next.cropping(to: rect) else { continue }
    cropWords += recognize(crop, offset: rect.origin)
  }
  let cropCPU = cpuSeconds() - t

  let before = recognize(previous)
  let kept = before.filter { word in !rects.contains { $0.intersects(word.box) } }
  let rebuilt = kept + cropWords
  let check = overlap(full, rebuilt)
  let reuseOnly = overlap(full, before)
  let result: [String: Any] = [
    "area": (area * 1000).rounded() / 1000, "rects": rects.count, "full_cpu_ms": Int(fullCPU * 1000),
    "crop_cpu_ms": Int(cropCPU * 1000), "words": full.count, "recall": (check.recall * 1000).rounded() / 1000,
    "precision": (check.precision * 1000).rounded() / 1000,
    "previous_recall": (reuseOnly.recall * 1000).rounded() / 1000,
  ]
  let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
  fflush(stdout)
}
