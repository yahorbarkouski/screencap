import CoreGraphics
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// Capture-cost benchmark. Usage: capture <outDir> [iterations]
// Measures wall time, in-process CPU and energy, and replayd (the ScreenCaptureKit daemon)
// CPU and energy per capture for several output sizes and APIs.

func replaydPID() -> pid_t? {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
  p.arguments = ["-x", "replayd"]
  let pipe = Pipe()
  p.standardOutput = pipe
  try? p.run()
  p.waitUntilExit()
  let s = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  return s.split(separator: "\n").first.flatMap { pid_t($0) }
}

struct Row {
  var name: String
  var wall: [Double] = []
  var selfCpu = 0.0
  var selfEnergy = 0.0
  var daemonCpu = 0.0
  var daemonEnergy = 0.0
  var n = 0
}

func printRow(_ r: Row) {
  let s = Stats(values: r.wall)
  print(
    "\(r.name.padding(toLength: 44, withPad: " ", startingAt: 0)) wall_med=\(fmt(s.median))ms p90=\(fmt(s.p90))ms "
      + "self_cpu=\(fmt(r.selfCpu / Double(r.n)))ms self_mJ=\(fmt(r.selfEnergy / Double(r.n), 2)) "
      + "replayd_cpu=\(fmt(r.daemonCpu / Double(r.n)))ms replayd_mJ=\(fmt(r.daemonEnergy / Double(r.n), 2))")
}

func measure(_ name: String, iterations: Int, daemon: pid_t?, _ body: () async throws -> Void)
  async rethrows -> Row
{
  try await body()  // warm-up
  var row = Row(name: name)
  let s0 = Usage.of()!
  let d0 = daemon.flatMap { Usage.of(pid: $0) }
  for _ in 0..<iterations {
    let t = DispatchTime.now().uptimeNanoseconds
    try await body()
    row.wall.append(ms(DispatchTime.now().uptimeNanoseconds - t))
    try? await Task.sleep(nanoseconds: 150_000_000)
  }
  let s1 = Usage.of()!
  let ds = s1 - s0
  row.selfCpu = ms(ds.cpuNs)
  row.selfEnergy = Double(ds.energyNj) / 1e6
  if let d0, let daemon, let d1 = Usage.of(pid: daemon) {
    let dd = d1 - d0
    row.daemonCpu = ms(dd.cpuNs)
    row.daemonEnergy = Double(dd.energyNj) / 1e6
  }
  row.n = iterations
  printRow(row)
  return row
}

func gray(_ image: CGImage, width: Int, height: Int) -> [UInt8] {
  var buf = [UInt8](repeating: 0, count: width * height)
  let ctx = CGContext(
    data: &buf, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  ctx.interpolationQuality = .medium
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  return buf
}

/// 64-bit difference hash: 9x8 grayscale, compare horizontal neighbours.
func dHash(_ image: CGImage) -> UInt64 {
  let g = gray(image, width: 9, height: 8)
  var h: UInt64 = 0
  for y in 0..<8 {
    for x in 0..<8 {
      h = (h << 1) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0)
    }
  }
  return h
}

func writePNG(_ image: CGImage, _ url: URL) {
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  CGImageDestinationFinalize(dest)
}

final class FirstFrame: NSObject, SCStreamOutput, @unchecked Sendable {
  var continuation: CheckedContinuation<CMSampleBuffer, Never>?
  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, let c = continuation else { return }
    guard
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false)
        as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int,
      SCFrameStatus(rawValue: raw) == .complete
    else { return }
    continuation = nil
    c.resume(returning: sb)
  }
}

@main struct CaptureBench {
  static func main() async throws {
    let outDir = URL(fileURLWithPath: CommandLine.arguments[1])
    let n = CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2])! : 10
    let daemon = replaydPID()
    print("preflight screen capture access: \(CGPreflightScreenCaptureAccess())  replayd pid: \(daemon.map(String.init) ?? "nil")")

    var t = DispatchTime.now().uptimeNanoseconds
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    print("SCShareableContent first fetch: \(fmt(ms(DispatchTime.now().uptimeNanoseconds - t)))ms displays=\(content.displays.count) windows=\(content.windows.count) apps=\(content.applications.count)")
    _ = await measure("SCShareableContent (on-screen windows)", iterations: n, daemon: daemon) {
      _ = try! await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    }

    let display = content.displays[0]
    let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    let scale = Int(filter.pointPixelScale)
    let nativeW = Int(filter.contentRect.width) * scale
    let nativeH = Int(filter.contentRect.height) * scale
    print("display \(display.displayID): points \(display.width)x\(display.height), native \(nativeW)x\(nativeH), scale \(scale)")

    // Filter that excludes several apps (simulates a privacy exclusion list).
    let excludedApps = Array(content.applications.prefix(5))
    let excludingFilter = SCContentFilter(display: display, excludingApplications: excludedApps, exceptingWindows: [])

    let sizes: [(String, Int, Int)] = [
      ("native", nativeW, nativeH),
      ("1x points", nativeW / 2, nativeH / 2),
      ("1280w", 1280, 1280 * nativeH / nativeW),
      ("256w probe", 256, 256 * nativeH / nativeW),
      ("64w probe", 64, 64 * nativeH / nativeW),
    ]
    var lastNative: CGImage?
    for (label, w, h) in sizes {
      let cfg = SCStreamConfiguration()
      cfg.width = w
      cfg.height = h
      cfg.showsCursor = false
      cfg.capturesAudio = false
      _ = await measure("captureImage \(label) \(w)x\(h)", iterations: n, daemon: daemon) {
        let img = try! await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
        if label == "native" { lastNative = img }
      }
    }
    do {
      let cfg = SCStreamConfiguration()
      cfg.width = nativeW / 2
      cfg.height = nativeH / 2
      cfg.showsCursor = false
      _ = await measure("captureImage 1x, excluding 5 apps", iterations: n, daemon: daemon) {
        _ = try! await SCScreenshotManager.captureImage(contentFilter: excludingFilter, configuration: cfg)
      }
    }

    // macOS 26 API: SCScreenshotConfiguration / SCScreenshotOutput.
    print("SCScreenshotConfiguration.supportedContentTypes: \(SCScreenshotConfiguration.supportedContentTypes.map(\.identifier))")
    do {
      let cfg = SCScreenshotConfiguration()
      cfg.width = nativeW / 2
      cfg.height = nativeH / 2
      cfg.showsCursor = false
      cfg.dynamicRange = .sdr
      _ = await measure("captureScreenshot(26) 1x sdr CGImage", iterations: n, daemon: daemon) {
        _ = try! await SCScreenshotManager.captureScreenshot(contentFilter: filter, configuration: cfg)
      }
      let fcfg = SCScreenshotConfiguration()
      fcfg.width = nativeW / 2
      fcfg.height = nativeH / 2
      fcfg.showsCursor = false
      fcfg.contentType = UTType.heic as UTTypeReference
      var i = 0
      _ = await measure("captureScreenshot(26) 1x -> HEIC file", iterations: n, daemon: daemon) {
        i += 1
        fcfg.fileURL = outDir.appendingPathComponent("sck26_\(i).heic")
        let out = try! await SCScreenshotManager.captureScreenshot(contentFilter: filter, configuration: fcfg)
        _ = out.fileURL
      }
      let size = (try? FileManager.default.attributesOfItem(atPath: outDir.appendingPathComponent("sck26_1.heic").path)[.size] as? Int) ?? -1
      print("  SCK-written 1x HEIC size: \(size / 1024) KB")
      let hcfg = SCScreenshotConfiguration()
      hcfg.dynamicRange = .bothSDRAndHDR
      hcfg.showsCursor = false
      let o = try await SCScreenshotManager.captureScreenshot(contentFilter: filter, configuration: hcfg)
      print("  bothSDRAndHDR: sdr=\(o.sdrImage.map { "\($0.width)x\($0.height) bpc\($0.bitsPerComponent)" } ?? "nil") hdr=\(o.hdrImage.map { "\($0.width)x\($0.height) bpc\($0.bitsPerComponent)" } ?? "nil")")
    }

    // macOS 15.2 API: rect capture without a filter.
    let rect = CGRect(x: 0, y: 0, width: display.width, height: display.height)
    _ = await measure("captureImage(in: rect) full display", iterations: n, daemon: daemon) {
      _ = try! await SCScreenshotManager.captureImage(in: rect)
    }

    // SCStream single frame: start, wait for first complete frame, stop.
    do {
      let cfg = SCStreamConfiguration()
      cfg.width = nativeW / 2
      cfg.height = nativeH / 2
      cfg.showsCursor = false
      cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
      cfg.queueDepth = 3
      _ = await measure("SCStream start+first frame+stop 1x", iterations: max(3, n / 2), daemon: daemon) {
        let out = FirstFrame()
        let stream = SCStream(filter: filter, configuration: cfg, delegate: nil)
        try! stream.addStreamOutput(out, type: .screen, sampleHandlerQueue: .global())
        try! await stream.startCapture()
        _ = await withCheckedContinuation { out.continuation = $0 }
        try! await stream.stopCapture()
      }
    }

    // Change detection cost.
    if let img = lastNative {
      writePNG(img, outDir.appendingPathComponent("native_capture.png"))
      var hashes: [Double] = []
      for _ in 0..<20 {
        let t0 = DispatchTime.now().uptimeNanoseconds
        _ = dHash(img)
        hashes.append(ms(DispatchTime.now().uptimeNanoseconds - t0))
      }
      print("dHash from native CGImage (CGContext downscale to 9x8): median \(fmt(Stats(values: hashes).median, 2))ms")
      let cfg = SCStreamConfiguration()
      cfg.width = 64
      cfg.height = 64 * nativeH / nativeW
      cfg.showsCursor = false
      let probe = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
      var ph: [Double] = []
      for _ in 0..<20 {
        let t0 = DispatchTime.now().uptimeNanoseconds
        _ = dHash(probe)
        ph.append(ms(DispatchTime.now().uptimeNanoseconds - t0))
      }
      print("dHash from 64w probe: median \(fmt(Stats(values: ph).median, 3))ms  hash(native)=\(String(dHash(img), radix: 16)) hash(probe)=\(String(dHash(probe), radix: 16))")
    }

    // Idle baseline for the daemon over the same period as one capture series.
    if let daemon {
      let d0 = Usage.of(pid: daemon)!
      try await Task.sleep(nanoseconds: UInt64(n) * 150_000_000)
      let dd = Usage.of(pid: daemon)! - d0
      print("replayd idle baseline over \(fmt(Double(n) * 0.15))s: cpu=\(fmt(ms(dd.cpuNs)))ms energy=\(fmt(Double(dd.energyNj) / 1e6, 2))mJ")
    }
    let u = Usage.of()!
    print("bench process phys_footprint at end: \(u.physFootprint / 1_048_576) MB")
  }
}
