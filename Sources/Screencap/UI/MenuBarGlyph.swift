import AppKit

/// The menu bar glyph: the app icon's day strip with the playhead on a moment, as a template image (only its alpha
/// counts; the menu bar tints it for light, dark and pressed). Drawn on whole points so its edges stay sharp at 1x and
/// 2x. The icon and the reasons for it are in research/logo/.
enum MenuBarGlyph {
  static let size = NSSize(width: 22, height: 22)

  static func image() -> NSImage {
    let image = NSImage(size: size, flipped: true) { _ in
      NSColor.black.setFill()
      // The strip in three pieces, its ends round, with a gap either side of the playhead.
      let pieces: [(NSRect, left: CGFloat, right: CGFloat)] = [
        (NSRect(x: 2, y: 8, width: 5, height: 6), 3, 1),
        (NSRect(x: 8, y: 8, width: 4, height: 6), 1, 1),
        (NSRect(x: 16, y: 8, width: 4, height: 6), 1, 3),
      ]
      for (rect, left, right) in pieces { piece(rect, left: left, right: right).fill() }
      NSBezierPath(roundedRect: NSRect(x: 13, y: 3, width: 2, height: 16), xRadius: 1, yRadius: 1).fill()
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = "Screencap"
    return image
  }

  /// A rectangle with its left corners rounded by `left` and its right corners by `right`.
  private static func piece(_ r: NSRect, left: CGFloat, right: CGFloat) -> NSBezierPath {
    let path = NSBezierPath()
    path.move(to: NSPoint(x: r.minX + left, y: r.minY))
    path.line(to: NSPoint(x: r.maxX - right, y: r.minY))
    path.appendArc(withCenter: NSPoint(x: r.maxX - right, y: r.minY + right), radius: right, startAngle: 270, endAngle: 360)
    path.line(to: NSPoint(x: r.maxX, y: r.maxY - right))
    path.appendArc(withCenter: NSPoint(x: r.maxX - right, y: r.maxY - right), radius: right, startAngle: 0, endAngle: 90)
    path.line(to: NSPoint(x: r.minX + left, y: r.maxY))
    path.appendArc(withCenter: NSPoint(x: r.minX + left, y: r.maxY - left), radius: left, startAngle: 90, endAngle: 180)
    path.line(to: NSPoint(x: r.minX, y: r.minY + left))
    path.appendArc(withCenter: NSPoint(x: r.minX + left, y: r.minY + left), radius: left, startAngle: 180, endAngle: 270)
    path.close()
    return path
  }
}
