import AppKit

// contact <dirs> <out> [overview.jpg]: lays out the renders from render.sh as contact sheets: one per direction (hero, the six
// appearances, every size on light and dark, the glyph in light and dark menu bars at 1x and 2x) and an overview.

let dirsURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outURL = URL(fileURLWithPath: CommandLine.arguments[2])
let overviewName = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "overview.jpg"

struct Direction {
  let folder: URL
  let name: String
  let note: String
  func image(_ file: String) -> NSImage { NSImage(contentsOf: folder.appendingPathComponent("r/\(file)"))! }
}

let directions: [Direction] = try! FileManager.default.contentsOfDirectory(at: dirsURL, includingPropertiesForKeys: nil)
  .filter { FileManager.default.fileExists(atPath: $0.appendingPathComponent("r/icon-a0-v0-1024.png").path) }
  .compactMap { folder in
    guard let data = try? Data(contentsOf: folder.appendingPathComponent("meta.json")),
      let meta = try? JSONSerialization.jsonObject(with: data) as? [String: String]
    else { return nil }
    return Direction(folder: folder, name: meta["name"]!, note: meta["note"]!)
  }
  .sorted { (order($0.name), $0.name) < (order($1.name), $1.name) }

func order(_ name: String) -> Int {
  ["Now", "Bar", "Gradient", "Tall", "Lanes", "Barcode", "Track", "Bead", "Rise", "Tiles", "Caret", "Keep", "Keep B", "Keep Ink", "Window", "Threads", "Threads Cross", "Strip II", "Stack", "Orb", "Journal", "Dial", "Chosen", "Strip", "Moment", "Lens", "Lift", "Week", "Columns", "Ring", "Coil", "Braid", "Tiles", "Knot", "Aurora"].firstIndex(of: name) ?? 99
}

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
  NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

/// A bitmap canvas with a top-left origin.
final class Canvas {
  let rep: NSBitmapImageRep
  let context: NSGraphicsContext
  init(width: Int, height: Int, background: NSColor) {
    rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    context = NSGraphicsContext(bitmapImageRep: rep)!
    let cg = context.cgContext
    cg.translateBy(x: 0, y: CGFloat(height))
    cg.scaleBy(x: 1, y: -1)
    context.imageInterpolation = .high
    draw { background.setFill(); NSRect(x: 0, y: 0, width: width, height: height).fill() }
  }
  func draw(_ body: () -> Void) {
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
    body()
    NSGraphicsContext.restoreGraphicsState()
  }
  func write(_ url: URL) { try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9])!.write(to: url) }
  var image: NSImage {
    let image = NSImage(size: NSSize(width: rep.pixelsWide, height: rep.pixelsHigh))
    image.addRepresentation(rep)
    return image
  }
}

func place(_ image: NSImage, _ rect: NSRect, crisp: Bool = false) {
  let ctx = NSGraphicsContext.current!
  let old = ctx.imageInterpolation
  if crisp { ctx.imageInterpolation = .none }
  image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
  ctx.imageInterpolation = old
}

func text(_ string: String, _ point: NSPoint, size: CGFloat, weight: NSFont.Weight = .regular, color fg: NSColor, width: CGFloat? = nil, mono: Bool = false) {
  let font = mono ? NSFont.monospacedDigitSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
  let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: fg]
  if let width {
    NSAttributedString(string: string, attributes: attributes).draw(with: NSRect(x: point.x, y: point.y, width: width, height: 400), options: [.usesLineFragmentOrigin])
  } else {
    NSAttributedString(string: string, attributes: attributes).draw(at: point)
  }
}

func tinted(_ image: NSImage, _ fill: NSColor, size: NSSize) -> NSImage {
  NSImage(size: size, flipped: false) { rect in
    image.draw(in: rect)
    fill.set()
    rect.fill(using: .sourceAtop)
    return true
  }
}

/// A slice of the menu bar at a scale: our glyph among the system's extras and the clock, template-tinted the way the
/// bar tints them.
func menuBar(_ d: Direction, dark: Bool, scale: CGFloat, width: CGFloat) -> (image: NSImage, glyphX: CGFloat) {
  let h = 24 * scale
  let canvas = Canvas(width: Int(width), height: Int(h), background: dark ? color(0x1E1F24) : color(0xE9E9EE))
  let fg = dark ? NSColor.white : NSColor(white: 0, alpha: 0.86)
  var glyphX: CGFloat = 0
  canvas.draw {
    var x = width - 12 * scale
    let clock = NSAttributedString(string: "Thu 15 Oct  21:58", attributes: [.font: NSFont.systemFont(ofSize: 13 * scale, weight: .medium), .foregroundColor: fg])
    x -= clock.size().width
    clock.draw(at: NSPoint(x: x, y: (h - clock.size().height) / 2))
    x -= 14 * scale
    for name in ["switch.2", "magnifyingglass", "wifi", "battery.75percent", "GLYPH", "speaker.wave.2.fill"] {
      let image: NSImage
      var size: NSSize
      if name == "GLYPH" {
        image = d.image(scale == 1 ? "glyph-1x.png" : "glyph-2x.png")
        let rep = image.representations[0]
        size = NSSize(width: rep.pixelsWide, height: rep.pixelsHigh)
      } else {
        let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
        image = NSImage(systemSymbolName: name, accessibilityDescription: nil)!.withSymbolConfiguration(config)!
        size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
      }
      x -= size.width
      if name == "GLYPH" { glyphX = x.rounded() }
      let y = ((h - size.height) / 2).rounded()
      place(tinted(image, fg, size: size), NSRect(x: x.rounded(), y: y, width: size.width, height: size.height), crisp: name == "GLYPH")
      x -= 16 * scale
    }
  }
  return (canvas.image, glyphX)
}

let labels = ["Default", "Dark", "Clear light", "Clear dark", "Tinted light", "Tinted dark"]
let variants = ["a0-v0", "a1-v0", "a0-v2", "a1-v2", "a0-v2-2563eb", "a1-v2-2563eb"]

func wallpaper(_ rect: NSRect) {
  NSGraphicsContext.saveGraphicsState()
  defer { NSGraphicsContext.restoreGraphicsState() }
  NSBezierPath(rect: rect).setClip()
  NSGradient(colors: [color(0x6E7FA6), color(0x9C7FA8), color(0x5E9A9A)])!.draw(in: rect, angle: -30)
}

func aurora(_ rect: NSRect) {
  NSGraphicsContext.saveGraphicsState()
  defer { NSGraphicsContext.restoreGraphicsState() }
  NSBezierPath(rect: rect).setClip()
  color(0x08090E).setFill()
  rect.fill()
  for (hex, cx, cy, r) in [(UInt32(0x6366F1), 0.15, 0.1, 0.9), (0x8B5CF6, 0.9, 0.2, 0.8), (0x14B8A6, 0.8, 1.0, 0.8), (0xDB2777, 0.1, 1.0, 0.7)] {
    let center = NSPoint(x: rect.minX + rect.width * cx, y: rect.minY + rect.height * cy)
    NSGradient(colors: [color(hex, 0.55), color(hex, 0)])!.draw(fromCenter: center, radius: 0, toCenter: center, radius: max(rect.width, rect.height) * r * 0.6, options: [])
  }
}

// MARK: Detail sheet per direction

func detail(_ d: Direction) {
  let W = 2400, H = 1500
  let canvas = Canvas(width: W, height: H, background: color(0x111216))
  canvas.draw {
    let white = NSColor.white, dim = NSColor(white: 1, alpha: 0.55)
    text(d.name, NSPoint(x: 60, y: 44), size: 48, weight: .bold, color: white)
    text(d.note, NSPoint(x: 60, y: 112), size: 24, color: dim, width: 1600)
    // Hero on the README's aurora.
    let hero = NSRect(x: 60, y: 180, width: 700, height: 700)
    aurora(hero)
    place(d.image("icon-a0-v0-1024.png"), hero.insetBy(dx: 40, dy: 40))
    // Six appearances on a wallpaper.
    let app = NSRect(x: 800, y: 180, width: 1540, height: 700)
    wallpaper(app)
    for (i, v) in variants.enumerated() {
      let col = CGFloat(i % 3), row = CGFloat(i / 3)
      let cell = NSRect(x: app.minX + 30 + col * 500, y: app.minY + 20 + row * 340, width: 300, height: 300)
      place(d.image("icon-\(v)-512.png"), NSRect(x: cell.minX + 70, y: cell.minY, width: 290, height: 290))
      text(labels[i], NSPoint(x: cell.minX + 120, y: cell.maxY - 12), size: 20, weight: .medium, color: white)
    }
    // Every size at its real pixel size, light and dark.
    for (j, dark) in [false, true].enumerated() {
      let band = NSRect(x: 60, y: 910 + CGFloat(j) * 150, width: 1150, height: 140)
      (dark ? color(0x1E1E1E) : color(0xF2F2F5)).setFill()
      band.fill()
      var x = band.minX + 30
      for px in [128, 64, 32, 16] {
        let image = d.image("icon-\(dark ? "a1" : "a0")-v0-\(px).png")
        place(image, NSRect(x: x, y: band.midY - CGFloat(px) / 2, width: CGFloat(px), height: CGFloat(px)), crisp: true)
        text("\(px)", NSPoint(x: x + CGFloat(px) + 8, y: band.midY - 10), size: 16, color: dark ? dim : NSColor(white: 0, alpha: 0.5), mono: true)
        x += CGFloat(px) + 70
      }
      // 16 and 32 magnified 4x, pixels kept, so their crispness can be judged.
      let z16 = d.image("icon-\(dark ? "a1" : "a0")-v0-16.png"), z32 = d.image("icon-\(dark ? "a1" : "a0")-v0-32.png")
      place(z32, NSRect(x: band.maxX - 330, y: band.midY - 64, width: 128, height: 128), crisp: true)
      place(z16, NSRect(x: band.maxX - 170, y: band.midY - 32, width: 64, height: 64), crisp: true)
      text("32 ×4", NSPoint(x: band.maxX - 330, y: band.maxY - 4), size: 14, color: dim, mono: true)
      text("16 ×4", NSPoint(x: band.maxX - 170, y: band.maxY - 4), size: 14, color: dim, mono: true)
    }
    // Menu bars: 2x, 1x, and 1x magnified.
    var y: CGFloat = 910
    for dark in [false, true] {
      let two = menuBar(d, dark: dark, scale: 2, width: 1060).image
      place(two, NSRect(x: 1280, y: y, width: 1060, height: 48))
      let (one, gx) = menuBar(d, dark: dark, scale: 1, width: 530)
      place(one, NSRect(x: 1280, y: y + 60, width: 530, height: 24), crisp: true)
      // Magnify the glyph's neighbourhood of the 1x bar.
      let crop = NSImage(size: NSSize(width: 120, height: 24), flipped: false) { _ in
        one.draw(in: NSRect(x: 0, y: 0, width: 120, height: 24), from: NSRect(x: gx - 50, y: 0, width: 120, height: 24), operation: .copy, fraction: 1)
        return true
      }
      place(crop, NSRect(x: 1830, y: y + 52, width: 480, height: 96), crisp: true)
      y += 160
    }
    text("menu bar 2x · 1x · 1x ×4", NSPoint(x: 1280, y: 1225), size: 16, color: dim)
  }
  canvas.write(outURL.appendingPathComponent("\(d.folder.lastPathComponent).jpg"))
}

// MARK: Overview

func overview() {
  let cols = 4
  let cellW = 460, cellH = 640
  let rows = (directions.count + cols - 1) / cols
  let canvas = Canvas(width: cols * cellW + 40, height: rows * cellH + 40, background: color(0x111216))
  canvas.draw {
    for (i, d) in directions.enumerated() {
      let x = CGFloat(20 + (i % cols) * cellW), y = CGFloat(20 + (i / cols) * cellH)
      let tile = NSRect(x: x + 10, y: y + 10, width: CGFloat(cellW) - 20, height: 300)
      aurora(tile)
      place(d.image("icon-a0-v0-512.png"), NSRect(x: tile.midX - 140, y: tile.minY + 10, width: 280, height: 280))
      text(d.name, NSPoint(x: x + 14, y: y + 318), size: 26, weight: .semibold, color: .white)
      // Small sizes, light and dark.
      for (j, dark) in [false, true].enumerated() {
        let band = NSRect(x: x + 10, y: y + 362 + CGFloat(j) * 84, width: CGFloat(cellW) - 20, height: 76)
        (dark ? color(0x1E1E1E) : color(0xF2F2F5)).setFill()
        band.fill()
        var bx = band.minX + 16
        for px in [64, 32, 16] {
          place(d.image("icon-\(dark ? "a1" : "a0")-v0-\(px).png"), NSRect(x: bx, y: band.midY - CGFloat(px) / 2, width: CGFloat(px), height: CGFloat(px)), crisp: true)
          bx += CGFloat(px) + 22
        }
        let (bar, gx) = menuBar(d, dark: dark, scale: 2, width: 620)
        // Show the glyph and its two neighbours only.
        let crop = NSImage(size: NSSize(width: 200, height: 48), flipped: false) { _ in
          bar.draw(in: NSRect(x: 0, y: 0, width: 200, height: 48), from: NSRect(x: gx - 78, y: 0, width: 200, height: 48), operation: .copy, fraction: 1)
          return true
        }
        place(crop, NSRect(x: band.maxX - 210, y: band.midY - 24, width: 200, height: 48))
      }
    }
  }
  canvas.write(outURL.appendingPathComponent(overviewName))
}

for d in directions { detail(d) }
if overviewName != "-" { overview() }
print("sheets: \(directions.map(\.name).joined(separator: ", "))")
