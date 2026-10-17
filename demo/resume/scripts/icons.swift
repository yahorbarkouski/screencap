// Writes the icons of the apps the demo's dock and app switcher show, as this Mac draws them, into
// public/generated/icons/<bundle id>.png. They are read from the installed apps each time rather than kept in the
// repository, because they belong to those apps.
//
//   swift scripts/icons.swift
import AppKit

let bundleIDs = [
  "com.apple.finder", "company.thebrowser.dia", "com.anthropic.claudefordesktop", "com.mitchellh.ghostty",
  "com.tinyspeck.slackmacgap", "com.apple.mail", "com.apple.Notes", "com.apple.iCal", "com.apple.Maps",
  "com.spotify.client", "com.apple.MobileSMS", "com.linear",
]
let out = URL(fileURLWithPath: "public/generated/icons", isDirectory: true)
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let side = 256
for id in bundleIDs {
  guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else {
    print("missing \(id)")
    continue
  }
  let icon = NSWorkspace.shared.icon(forFile: app.path)
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  icon.draw(in: NSRect(x: 0, y: 0, width: side, height: side))
  NSGraphicsContext.restoreGraphicsState()
  try rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent("\(id).png"))
  print("wrote \(id)")
}
