import CryptoKit
import Foundation

// AES-GCM (CryptoKit) seal cost for one 1x HEIC-sized frame and an hourly pack. Synthetic bytes.
@main struct CryptoBench {
  static func main() throws {
    let key = SymmetricKey(size: .bits256)
    for (label, size) in [("frame 136 KB", 136 * 1024), ("hourly pack 5 MB", 5 * 1024 * 1024), ("daily pack 60 MB", 60 * 1024 * 1024)] {
      var bytes = [UInt8](repeating: 0, count: size)
      for i in 0..<size { bytes[i] = UInt8(truncatingIfNeeded: i &* 2654435761 >> 13) }
      let data = Data(bytes)
      var t: [Double] = []
      var out = 0
      for _ in 0..<20 {
        let s = DispatchTime.now().uptimeNanoseconds
        let box = try AES.GCM.seal(data, using: key)
        out = box.combined!.count
        t.append(ms(DispatchTime.now().uptimeNanoseconds - s))
      }
      let med = Stats(values: t).median
      print("\(label): seal median \(fmt(med, 3)) ms (\(fmt(Double(size) / 1_048_576 / (med / 1000), 0)) MB/s), overhead \(out - size) bytes")
    }
  }
}
