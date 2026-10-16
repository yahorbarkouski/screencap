import AppKit

// context <out.jpg> <icon.png>...: each candidate icon in a Dock row between Apple's own apps, on a light and a dark
// wallpaper, drawn the way the system draws app icons (NSWorkspace) at the Dock's default 64 pt, shown at 2x.
let args = CommandLine.arguments
let out = URL(fileURLWithPath: args[1])
let candidates = args[2...].map { NSImage(contentsOfFile: $0)! }
let neighbours = ["Finder", "Safari", "Messages", "Mail", "Notes", "Calendar", "Music", "System Settings"].map { name -> NSImage in
  let path = name == "Finder" ? "/System/Library/CoreServices/Finder.app" : (name == "Safari" ? "/Applications/Safari.app" : "/System/Applications/\(name).app")
  return NSWorkspace.shared.icon(forFile: path)
}
let cell: CGFloat = 128, pad: CGFloat = 16
let rowW = CGFloat(neighbours.count + 1) * (cell + pad) + pad * 3
let rowH = cell + pad * 2
let W = Int(rowW * 2 + 60), H = Int(CGFloat(candidates.count) * (rowH + 30) + 40)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
ctx.imageInterpolation = .high
for (col, dark) in [false, true].enumerated() {
  let x0 = 20 + CGFloat(col) * (rowW + 20)
  let wall = NSRect(x: x0, y: 0, width: rowW, height: CGFloat(H))
  NSGradient(colors: dark ? [NSColor(srgbRed: 0.10, green: 0.11, blue: 0.20, alpha: 1), NSColor(srgbRed: 0.20, green: 0.12, blue: 0.24, alpha: 1)]
    : [NSColor(srgbRed: 0.80, green: 0.84, blue: 0.93, alpha: 1), NSColor(srgbRed: 0.93, green: 0.84, blue: 0.86, alpha: 1)])!.draw(in: wall, angle: 90)
  for (i, candidate) in candidates.enumerated() {
    let y = CGFloat(H) - 40 - CGFloat(i + 1) * (rowH + 30) + 30
    let dock = NSRect(x: x0 + pad, y: y, width: rowW - pad * 2, height: rowH)
    (dark ? NSColor(white: 0.12, alpha: 0.55) : NSColor(white: 1, alpha: 0.45)).setFill()
    NSBezierPath(roundedRect: dock, xRadius: 44, yRadius: 44).fill()
    var x = dock.minX + pad
    for (j, icon) in neighbours.enumerated() {
      if j == 4 {
        candidate.draw(in: NSRect(x: x, y: dock.minY + pad, width: cell, height: cell))
        x += cell + pad
      }
      icon.draw(in: NSRect(x: x, y: dock.minY + pad, width: cell, height: cell))
      x += cell + pad
    }
  }
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9])!.write(to: out)
