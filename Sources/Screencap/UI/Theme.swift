import AppKit
import ScreencapCore
import SwiftUI

/// Screencap's design language: one near-black ink at six strengths on white, a 6% wash of it as the only surface
/// colour, hairlines only between panes, hue only for meaning and thread identity.
enum Theme {
  static let ink = dynamic(light: 0x17181A, dark: 0xEDEDEA)
  static let ink2 = dynamic(light: 0x3C3B37, dark: 0xC9C8C3)
  static let ink3 = dynamic(light: 0x5C5B56, dark: 0xA8A7A1)
  static let ink4 = dynamic(light: 0x6F6E68, dark: 0x93928C)
  static let ink5 = dynamic(light: 0x85847E, dark: 0x7D7C77)
  static let ink6 = dynamic(light: 0xA3A29C, dark: 0x64635F)
  static let wash = dynamic(light: 0x17181A, lightAlpha: 0.06, dark: 0xFFFFFF, darkAlpha: 0.07)
  static let washHover = dynamic(light: 0x17181A, lightAlpha: 0.09, dark: 0xFFFFFF, darkAlpha: 0.11)
  static let hairline = dynamic(light: 0x17181A, lightAlpha: 0.12, dark: 0xFFFFFF, darkAlpha: 0.12)
  /// The chosen row on glass. A wash disappears over a busy screen behind the glass, so this is about twice as strong.
  static let glassSelection = dynamic(light: 0x17181A, lightAlpha: 0.1, dark: 0xFFFFFF, darkAlpha: 0.15)
  static let page = Color(nsColor: .textBackgroundColor)
  static let onInk = dynamic(light: 0xFFFFFF, dark: 0x17181A)
  static let exact = Color(hex: 0x3B9555)
  static let destructive = Color(hex: 0xD6332F)

  /// Mark pairs (background, foreground) that tell threads apart, the only decorative hue.
  static let marks: [(Color, Color)] = [
    (0xDBEAFE, 0x2563EB), (0xEDE9FE, 0x7C3AED), (0xDCFCE7, 0x15803D), (0xFEF3C7, 0xB45309), (0xFFE4E6, 0xE11D48),
    (0xCFFAFE, 0x0E7490), (0xFFEDD5, 0xC2410C), (0xCCFBF1, 0x0F766E), (0xFAE8FF, 0xA21CAF), (0xECFCCB, 0x4D7C0F),
  ].map { (dynamic(light: $0.0, dark: $0.1, darkAlpha: 0.22), Color(hex: $0.1)) }

  static func mark(_ threadID: Int64?) -> (background: Color, foreground: Color) {
    guard let threadID else { return (wash, ink5) }
    let pair = marks[Int(threadID.magnitude % UInt64(marks.count))]
    return (pair.0, pair.1)
  }

  /// Motion, after Emil Kowalski's rules: only what a click starts (never a shortcut or a scrub), under 300 ms, on a
  /// strong ease-out; hover only fades colour.
  static let easeOut = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.2)
  static let press = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.16)
  static let hover = Animation.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.12)

  static func dynamic(light: UInt32, lightAlpha: Double = 1, dark: UInt32, darkAlpha: Double = 1) -> Color {
    Color(
      nsColor: NSColor(name: nil) { appearance in
        let isDark = appearance.bestMatch(from: [.darkAqua, .vibrantDark, .aqua, .vibrantLight]).map { [.darkAqua, .vibrantDark].contains($0) } ?? false
        return NSColor(hex: isDark ? dark : light, alpha: isDark ? darkAlpha : lightAlpha)
      })
  }
}

extension Color {
  init(hex: UInt32, alpha: Double = 1) {
    self.init(nsColor: NSColor(hex: hex, alpha: alpha))
  }
}

extension NSColor {
  convenience init(hex: UInt32, alpha: Double) {
    self.init(
      srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255,
      alpha: alpha)
  }
}

extension Font {
  static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
  static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
  }
}

/// Durations as the sites write them: "38m", "2h 44m".
func durationText(_ minutes: Double) -> String {
  let m = Int(minutes.rounded())
  return m >= 60 ? "\(m / 60)h \(String(format: "%02d", m % 60))m" : "\(m)m"
}

func clockText(_ at: Double) -> String { TimeFormatter().hourMinute(at) }

extension NSGlassEffectView {
  /// Liquid Glass cut to a rounded rectangle, for a borderless panel that is nothing but the glass.
  ///
  /// The glass rounds its own drawing, but in the light appearance it still lays a faint fill over its whole square
  /// frame, which shows as square corners on a light page and gave the window's shadow a square outline. Clipping
  /// its layer to the same rounded rectangle leaves nothing outside the shape, so the corners stay round and the
  /// window shadow follows them.
  static func rounded(_ radius: CGFloat, content: NSView) -> NSGlassEffectView {
    let glass = NSGlassEffectView()
    glass.cornerRadius = radius
    glass.contentView = content
    glass.wantsLayer = true
    glass.layer?.cornerRadius = radius
    glass.layer?.cornerCurve = .continuous
    glass.layer?.masksToBounds = true
    return glass
  }
}
