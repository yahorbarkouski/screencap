import Accelerate
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// Follow-up capture benchmark. Usage: capture2 <outDir>
// 1. macOS 26 captureScreenshot with fileURL: does SCK write the file, and how big is it?
// 2. Change detection: probe capture + 64-bit dHash, and Hamming noise on an unchanged screen.
// 3. A/B system cost: replayd + WindowServer CPU over 30 s with 1 capture/s vs 30 s idle.

func pids(_ name: String) -> [pid_t] {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
  p.arguments = ["-x", name]
  let pipe = Pipe()
  p.standardOutput = pipe
  try? p.run()
  p.waitUntilExit()
  let s = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  return s.split(separator: "\n").compactMap { pid_t($0) }
}

/// Cumulative CPU seconds via ps (works for WindowServer, which runs as another user).
func psCPUSeconds(_ pid: pid_t) -> Double {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/bin/ps")
  p.arguments = ["-o", "time=", "-p", "\(pid)"]
  let pipe = Pipe()
  p.standardOutput = pipe
  try? p.run()
  p.waitUntilExit()
  let s = (String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "")
    .trimmingCharacters(in: .whitespacesAndNewlines)
  var total = 0.0
  for part in s.split(separator: ":") { total = total * 60 + (Double(part) ?? 0) }
  return total
}

func gray(_ image: CGImage, width: Int, height: Int) -> [UInt8] {
  var buf = [UInt8](repeating: 0, count: width * height)
  let ctx = CGContext(
    data: &buf, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  return buf
}

func dHash(_ g: [UInt8]) -> UInt64 {
  var h: UInt64 = 0
  for y in 0..<8 { for x in 0..<8 { h = (h << 1) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0) } }
  return h
}

/// Mean absolute difference between two 64x40 grayscale thumbnails (0...255).
func mad(_ a: [UInt8], _ b: [UInt8]) -> Double {
  var s = 0
  for i in 0..<a.count { s += abs(Int(a[i]) - Int(b[i])) }
  return Double(s) / Double(a.count)
}

@main struct Capture2 {
  static func main() async throws {
    let outDir = URL(fileURLWithPath: CommandLine.arguments[1])
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let display = content.displays[0]
    let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

    // 1. File output.
    let fcfg = SCScreenshotConfiguration()
    fcfg.width = display.width
    fcfg.height = display.height
    fcfg.showsCursor = false
    fcfg.contentType = UTType.heic as UTTypeReference
    let url = outDir.appendingPathComponent("sck26_file.heic")
    fcfg.fileURL = url
    let out = try await SCScreenshotManager.captureScreenshot(contentFilter: filter, configuration: fcfg)
    try await Task.sleep(nanoseconds: 1_000_000_000)
    let exists = FileManager.default.fileExists(atPath: url.path)
    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? -1
    print("captureScreenshot fileURL: output.fileURL=\(out.fileURL?.path ?? "nil") exists=\(exists) size=\(size) sdr=\(out.sdrImage != nil)")

    // 2. Probe + hash timing and noise.
    let probeCfg = SCStreamConfiguration()
    probeCfg.width = 64
    probeCfg.height = 40
    probeCfg.showsCursor = false
    var hashMs: [Double] = []
    var probeMs: [Double] = []
    var prevG: [UInt8]? = nil
    var prevH: UInt64? = nil
    var hams: [Int] = []
    var mads: [Double] = []
    for _ in 0..<15 {
      let t0 = DispatchTime.now().uptimeNanoseconds
      let img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: probeCfg)
      let t1 = DispatchTime.now().uptimeNanoseconds
      let g9 = gray(img, width: 9, height: 8)
      let h = dHash(g9)
      let g = gray(img, width: 64, height: 40)
      let t2 = DispatchTime.now().uptimeNanoseconds
      probeMs.append(ms(t1 - t0))
      hashMs.append(Double(t2 - t1) / 1000)
      if let ph = prevH { hams.append((ph ^ h).nonzeroBitCount) }
      if let pg = prevG { mads.append(mad(pg, g)) }
      prevH = h
      prevG = g
      try await Task.sleep(nanoseconds: 300_000_000)
    }
    print("probe 64x40 capture median \(fmt(Stats(values: probeMs).median))ms; dHash+64x40 gray median \(fmt(Stats(values: hashMs).median, 1))us")
    print("consecutive probes (screen as-is, 0.3s apart): hamming=\(hams) mad=\(mads.map { fmt($0, 2) })")

    // Full-res downscale cost for hashing an already-captured frame.
    let fullCfg = SCStreamConfiguration()
    fullCfg.width = display.width * 2
    fullCfg.height = display.height * 2
    let full = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: fullCfg)
    var fm: [Double] = []
    for _ in 0..<10 {
      let t0 = DispatchTime.now().uptimeNanoseconds
      let g = gray(full, width: 64, height: 40)
      _ = dHash(gray(full, width: 9, height: 8))
      _ = g
      fm.append(Double(DispatchTime.now().uptimeNanoseconds - t0) / 1000)
    }
    print("hash+thumb from native \(full.width)x\(full.height) CGImage: median \(fmt(Stats(values: fm).median, 0))us")

    // 3. A/B system cost.
    guard let replayd = pids("replayd").first, let ws = pids("WindowServer").first else { return }
    let cfg = SCStreamConfiguration()
    cfg.width = display.width
    cfg.height = display.height
    cfg.showsCursor = false
    func window(capture: Bool) async throws -> (Double, Double, Double) {
      let r0 = Usage.of(pid: replayd)!
      let w0 = psCPUSeconds(ws)
      let s0 = Usage.of()!
      for _ in 0..<30 {
        if capture { _ = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg) }
        try await Task.sleep(nanoseconds: 1_000_000_000)
      }
      try await Task.sleep(nanoseconds: 2_000_000_000)
      let r = Usage.of(pid: replayd)! - r0
      let w = psCPUSeconds(ws) - w0
      let s = Usage.of()! - s0
      return (ms(r.cpuNs), w * 1000, ms(s.cpuNs))
    }
    for round in 0..<2 {
      let idle = try await window(capture: false)
      let cap = try await window(capture: true)
      print("round \(round): idle  replayd=\(fmt(idle.0))ms WindowServer=\(fmt(idle.1))ms self=\(fmt(idle.2))ms over 32s")
      print("round \(round): 30cap replayd=\(fmt(cap.0))ms WindowServer=\(fmt(cap.1))ms self=\(fmt(cap.2))ms over 32s")
    }
  }
}
