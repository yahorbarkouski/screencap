import AppKit

// glyph <out-dir>: renders the menu bar glyph the app ships (Sources/Screencap/UI/MenuBarGlyph.swift, compiled in
// alongside this file) at 1x and 2x, black on clear: the alpha the menu bar tints.
@main
enum GlyphRender {
  static func main() {
    let out = URL(fileURLWithPath: CommandLine.arguments[1])
    let image = MenuBarGlyph.image()
    for scale in [1, 2] {
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(image.size.width) * scale, pixelsHigh: Int(image.size.height) * scale,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0,
        bitsPerPixel: 0)!
      rep.size = image.size
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
      image.draw(in: NSRect(origin: .zero, size: image.size))
      NSGraphicsContext.restoreGraphicsState()
      try! rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent("glyph-\(scale)x.png"))
    }
  }
}
