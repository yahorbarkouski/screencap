// Saves a PNG of each on-screen window of a process: window-shot <pid> <output-prefix>
// Used to keep visual evidence of the app's surfaces (docs/screens).
import CoreGraphics
import Foundation

let pid = Int32(CommandLine.arguments[1])!
let prefix = CommandLine.arguments[2]
let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
var index = 0
for window in windows where (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid {
  guard let id = window[kCGWindowNumber as String] as? NSNumber,
    let bounds = (window[kCGWindowBounds as String] as? NSDictionary).flatMap({ CGRect(dictionaryRepresentation: $0) }),
    bounds.width > 200, bounds.height > 150
  else { continue }
  let out = "\(prefix)-\(index).png"
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  task.arguments = ["-x", "-o", "-l", "\(id.intValue)", out]
  try task.run()
  task.waitUntilExit()
  print("\(out) \(Int(bounds.width))x\(Int(bounds.height)) layer \((window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1)")
  index += 1
}
