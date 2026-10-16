import AppKit

// glyphs <out.jpg>: the menu bar glyph drawings weighed, each in a light and a dark menu bar beside the system's icons,
// at 2x and at 1x magnified twice with its pixels kept. "Shipped" is the app's own MenuBarGlyph (compiled in); the
// rest are the drawings weighed for Lens T, the runner-up.

struct Drawing {
  var name: String
  var width: CGFloat
  var pane: NSRect
  var strip: (y: CGFloat, h: CGFloat) = (9, 4)
  var piece: CGFloat
  var split: CGFloat = 0  // > 0: each side's piece in two, with this gap
  var solid = false  // a filled pane with the strip cut through it

  func image() -> NSImage {
    let image = NSImage(size: NSSize(width: width, height: 22), flipped: true) { _ in
      NSColor.black.setFill()
      let inner = pane.insetBy(dx: 1.5, dy: 1.5)
      if solid {
        let path = NSBezierPath(roundedRect: pane, xRadius: 3.5, yRadius: 3.5)
        path.append(NSBezierPath(rect: NSRect(x: pane.minX, y: strip.y + 0.5, width: pane.width, height: strip.h - 1)))
        path.windingRule = .evenOdd
        path.fill()
      } else {
        let path = NSBezierPath(roundedRect: pane, xRadius: 3.5, yRadius: 3.5)
        path.append(NSBezierPath(roundedRect: inner, xRadius: 2, yRadius: 2))
        path.windingRule = .evenOdd
        path.fill()
      }
      for (x0, x1) in [(pane.minX - 1 - piece, pane.minX - 1), (pane.maxX + 1, pane.maxX + 1 + piece)] {
        let pieces = split > 0 ? [(x0, x0 + (x1 - x0 - split) / 2), (x1 - (x1 - x0 - split) / 2, x1)] : [(x0, x1)]
        for (a, b) in pieces {
          NSBezierPath(roundedRect: NSRect(x: a, y: strip.y, width: b - a, height: strip.h), xRadius: 1.1, yRadius: 1.1).fill()
        }
      }
      NSColor.black.withAlphaComponent(solid ? 0.4 : 0.45).setFill()
      NSRect(x: solid ? pane.minX : inner.minX, y: strip.y + (solid ? 0.5 : 0), width: solid ? pane.width : inner.width, height: strip.h - (solid ? 1 : 0)).fill()
      return true
    }
    image.isTemplate = true
    return image
  }
}

let drawings: [(String, NSImage)] = [
  ("Shipped: Strip", MenuBarGlyph.image()),
  ("Lens T: pane 13×12, one piece a side", Drawing(name: "", width: 27, pane: NSRect(x: 7, y: 5, width: 13, height: 12), piece: 6).image()),
  ("Narrower, pieces 4.5", Drawing(name: "", width: 26, pane: NSRect(x: 6, y: 5, width: 14, height: 12), piece: 4.5).image()),
  ("Two pieces a side", Drawing(name: "", width: 28, pane: NSRect(x: 7.5, y: 5, width: 13, height: 12), piece: 6.5, split: 1).image()),
  ("Wide pane 15×12, strip 5", Drawing(name: "", width: 28, pane: NSRect(x: 6.5, y: 5, width: 15, height: 12), strip: (8.5, 5), piece: 5).image()),
  ("Solid pane, strip cut through", Drawing(name: "", width: 27, pane: NSRect(x: 7, y: 5, width: 13, height: 12), piece: 6, solid: true).image()),
]

func bar(_ glyph: NSImage, dark: Bool, scale: CGFloat) -> NSBitmapImageRep {
  let W: CGFloat = 250, H: CGFloat = 24
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: W, height: H)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  (dark ? NSColor(srgbRed: 0.12, green: 0.12, blue: 0.14, alpha: 1) : NSColor(srgbRed: 0.91, green: 0.91, blue: 0.93, alpha: 1)).setFill()
  NSRect(x: 0, y: 0, width: W, height: H).fill()
  let fg = dark ? NSColor.white : NSColor(white: 0, alpha: 0.86)
  var x: CGFloat = 12
  let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
  let symbols = ["speaker.wave.2.fill", "GLYPH", "battery.75percent", "wifi", "magnifyingglass", "switch.2"]
  for name in symbols {
    let image = name == "GLYPH" ? glyph : NSImage(systemSymbolName: name, accessibilityDescription: nil)!.withSymbolConfiguration(config)!
    let tinted = NSImage(size: image.size, flipped: false) { r in
      image.draw(in: r)
      fg.set()
      r.fill(using: .sourceAtop)
      return true
    }
    let y = ((H - image.size.height) / 2).rounded()
    tinted.draw(in: NSRect(x: x.rounded(), y: y, width: image.size.width, height: image.size.height))
    x += image.size.width + 16
  }
  NSGraphicsContext.restoreGraphicsState()
  return rep
}

@main
enum Glyphs {
  static func main() {
    let rowH = 48, labelW = 420, barW = 500, zoomW = 500
    let W = labelW + barW + zoomW + 60, H = drawings.count * (rowH * 2 + 40) + 20
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = context
    NSColor(srgbRed: 0.067, green: 0.071, blue: 0.086, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: W, height: H).fill()
    for (i, (label, glyph)) in drawings.enumerated() {
      let top = CGFloat(H - 20 - i * (rowH * 2 + 40))
      NSAttributedString(string: label, attributes: [.font: NSFont.systemFont(ofSize: 22, weight: i == 0 ? .semibold : .regular), .foregroundColor: NSColor.white])
        .draw(at: NSPoint(x: 24, y: top - CGFloat(rowH) - 14))
      for (j, dark) in [false, true].enumerated() {
        let y = top - CGFloat(rowH * (j + 1))
        context.cgContext.draw(bar(glyph, dark: dark, scale: 2).cgImage!, in: CGRect(x: labelW, y: Int(y), width: barW, height: rowH))
        // The 1x bar magnified twice, its pixels kept.
        let one = bar(glyph, dark: dark, scale: 1).cgImage!
        context.cgContext.interpolationQuality = .none
        context.cgContext.draw(one, in: CGRect(x: labelW + barW + 30, y: Int(y), width: zoomW, height: rowH))
        context.cgContext.interpolationQuality = .high
      }
    }
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
  }
}
