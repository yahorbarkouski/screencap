import Darwin
import Foundation

/// Process resource counters from proc_pid_rusage (RUSAGE_INFO_V6).
/// Energy is the kernel's per-task estimate on Apple Silicon (nanojoules).
struct Usage {
  var cpuNs: UInt64
  var energyNj: UInt64
  var instructions: UInt64
  var physFootprint: UInt64
  var wall: UInt64

  static func of(pid: pid_t = getpid()) -> Usage? {
    var info = rusage_info_v6()
    let rc = withUnsafeMutablePointer(to: &info) { ptr in
      ptr.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
        proc_pid_rusage(pid, RUSAGE_INFO_V6, $0)
      }
    }
    guard rc == 0 else { return nil }
    var tb = mach_timebase_info_data_t()
    mach_timebase_info(&tb)
    let toNs = { (t: UInt64) in t * UInt64(tb.numer) / UInt64(tb.denom) }
    return Usage(
      cpuNs: toNs(info.ri_user_time + info.ri_system_time),
      energyNj: info.ri_energy_nj,
      instructions: info.ri_instructions,
      physFootprint: info.ri_phys_footprint,
      wall: DispatchTime.now().uptimeNanoseconds)
  }

  static func - (a: Usage, b: Usage) -> Usage {
    Usage(
      cpuNs: a.cpuNs &- b.cpuNs, energyNj: a.energyNj &- b.energyNj,
      instructions: a.instructions &- b.instructions, physFootprint: a.physFootprint,
      wall: a.wall &- b.wall)
  }
}

struct Stats {
  var values: [Double]
  var median: Double {
    let s = values.sorted()
    return s.isEmpty ? .nan : s[s.count / 2]
  }
  var p90: Double {
    let s = values.sorted()
    return s.isEmpty ? .nan : s[min(s.count - 1, Int(Double(s.count) * 0.9))]
  }
  var mean: Double { values.isEmpty ? .nan : values.reduce(0, +) / Double(values.count) }
}

func fmt(_ v: Double, _ digits: Int = 1) -> String { String(format: "%.\(digits)f", v) }

func ms(_ ns: UInt64) -> Double { Double(ns) / 1_000_000 }
