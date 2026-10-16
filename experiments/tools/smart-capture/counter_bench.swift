// Times the input reads a trigger poll would make: window-server event counters and seconds since the last event of
// each type. Run: DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift counter_bench.swift

import CoreGraphics
import Foundation

let types: [CGEventType] = [
  .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .mouseMoved, .leftMouseDragged,
]
let rounds = 20_000
var sink: UInt64 = 0
var usage = rusage()
getrusage(RUSAGE_SELF, &usage)
let before = Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1e6
let started = Date()
for _ in 0..<rounds {
  for type in types {
    sink &+= UInt64(CGEventSource.counterForEventType(.combinedSessionState, eventType: type))
  }
  sink &+= UInt64(CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown))
}
getrusage(RUSAGE_SELF, &usage)
let after = Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1e6
let perPoll = (after - before) / Double(rounds)
print(String(format: "per poll (7 counters + 1 idle read): %.1f µs CPU, %.1f µs wall; at 1 Hz: %.4f%% of a core",
  perPoll * 1e6, Date().timeIntervalSince(started) / Double(rounds) * 1e6, perPoll * 100), sink % 2)
