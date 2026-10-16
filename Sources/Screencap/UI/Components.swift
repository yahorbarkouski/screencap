import AppKit
import ImageIO
import ScreencapCore
import SwiftUI

/// Capsule button on the wash; `prominent` is the ink "on" state (white text on ink).
struct PillStyle: ButtonStyle {
  var prominent = false
  var destructive = false
  var height: CGFloat = 28

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.ui(12.5, .medium))
      .foregroundStyle(prominent ? Theme.onInk : destructive ? Theme.destructive : Theme.ink2)
      .padding(.horizontal, 12)
      .frame(height: height)
      .background(Capsule().fill(prominent ? Theme.ink : configuration.isPressed ? Theme.washHover : Theme.wash))
      .modifier(PressScale(pressed: configuration.isPressed))
      .contentShape(Capsule())
  }
}

/// A pressed button dips to 0.97; with Reduce Motion it stays still.
struct PressScale: ViewModifier {
  let pressed: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    content.scaleEffect(pressed && !reduceMotion ? 0.97 : 1).animation(Theme.press, value: pressed)
  }
}

/// A read-only or secondary capsule: transparent with a hairline outline.
struct OutlinePillStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.ui(12.5, .medium))
      .foregroundStyle(Theme.ink4)
      .padding(.horizontal, 11)
      .frame(height: 28)
      .overlay(Capsule().strokeBorder(Theme.hairline))
      .modifier(PressScale(pressed: configuration.isPressed))
      .contentShape(Capsule())
  }
}

/// A round icon button whose disc darkens under the pointer.
struct RoundIconButton: View {
  let systemName: String
  var size: CGFloat = 30
  /// A small dot at the top right, for something waiting behind the button.
  var dot: Color?
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: systemName)
        .font(.system(size: size * 0.42, weight: .medium))
        .foregroundStyle(hovering ? Theme.ink : Theme.ink3)
        .frame(width: size, height: size)
        .background(Circle().fill(Theme.wash).opacity(hovering ? 1 : 0.7))
        .overlay(alignment: .topTrailing) {
          if let dot { Circle().fill(dot).frame(width: size * 0.26, height: size * 0.26).offset(x: -size * 0.04, y: size * 0.04) }
        }
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Theme.hover, value: hovering)
  }
}

/// A thread's identity: the icon of the site or app it happens in, else its colour.
struct ThreadMark: View {
  let model: AppModel
  let threadID: Int64?
  var size: CGFloat = 32

  var body: some View {
    let colors = Theme.mark(threadID)
    if let found = model.place(of: threadID), let image = model.icons.image(for: found.place, app: found.app) {
      model.icons.icon(image, for: found.place)
        .frame(width: size * 0.78, height: size * 0.78)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
        .frame(width: size, height: size)
    } else {
      RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(colors.background)
        .overlay(Circle().fill(colors.foreground).frame(width: size * 0.3, height: size * 0.3))
        .frame(width: size, height: size)
    }
  }
}

struct Dot: View {
  var color: Color
  var size: CGFloat = 6
  var body: some View { Circle().fill(color).frame(width: size, height: size) }
}

/// Filled wash chip with a thread dot, a title and a mono trailing value.
struct ThreadChip: View {
  let threadID: Int64?
  let title: String
  var trailing: String?

  var body: some View {
    HStack(spacing: 7) {
      Dot(color: Theme.mark(threadID).foreground)
      Text(title).font(.ui(12.5, .medium)).foregroundStyle(Theme.ink2).lineLimit(1)
      if let trailing { Text(trailing).font(.mono(11)).foregroundStyle(Theme.ink5) }
    }
    .padding(.leading, 9).padding(.trailing, 11)
    .frame(height: 28)
    .background(Capsule().fill(Theme.wash))
  }
}

struct SectionLabel: View {
  let text: String
  init(_ text: String) { self.text = text }
  var body: some View { Text(text).font(.ui(12, .medium)).foregroundStyle(Theme.ink6) }
}

/// The highlighter over a search match.
struct MatchMark: View {
  static let color = Color(hex: 0xF5C542)

  var body: some View {
    RoundedRectangle(cornerRadius: 3, style: .continuous).fill(Self.color.opacity(0.2))
      .overlay(RoundedRectangle(cornerRadius: 3, style: .continuous).strokeBorder(Self.color, lineWidth: 1.5))
  }
}

/// Decodes frames and thumbnails off the main thread, downscaled to what a view needs, and keeps up to 96 MB of them
/// decoded. A count limit alone let a scrolled full-width Day page hold 400 frames of up to 1.4 MB each, and the app
/// reached 850 MB.
final class ImageLoader: @unchecked Sendable {
  static let shared = ImageLoader()
  private let cache = NSCache<NSString, NSImage>()

  init() { cache.totalCostLimit = 96 << 20 }

  /// Lets every decoded image go, when the main window closes.
  func removeAll() { cache.removeAllObjects() }

  static func key(_ url: URL, _ maxPixels: Int, _ crop: ScreenRect?) -> NSString {
    "\(url.path)#\(maxPixels)#\(crop.map { "\($0.x),\($0.y),\($0.width),\($0.height)" } ?? "")" as NSString
  }

  func cached(_ url: URL, maxPixels: Int, crop: ScreenRect? = nil) -> NSImage? { cache.object(forKey: Self.key(url, maxPixels, crop)) }

  func load(_ url: URL, maxPixels: Int, crop: ScreenRect? = nil) async -> NSImage? {
    let key = Self.key(url, maxPixels, crop)
    if let image = cache.object(forKey: key) { return image }
    let image = await Task.detached(priority: .userInitiated) { () -> NSImage? in
      guard let cg = FrameEncoder.image(at: url, maxPixels: maxPixels, crop: crop) else { return nil }
      return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }.value
    if let image { cache.setObject(image, forKey: key, cost: Int(image.size.width * image.size.height) * 4) }
    return image
  }
}

/// A screenshot on a wash tile with a hairline inner outline; fades in once decoded.
struct Screenshot: View {
  let url: URL?
  var maxPixels = 480
  var cornerRadius: CGFloat = 9
  /// Cut to the window that was in front, when the capture knows where it was.
  var crop: ScreenRect?
  /// Marks a place on the picture (fractions of it), such as the line a search matched.
  var mark: CGRect?
  @State private var image: NSImage?

  var body: some View {
    // The picture fills the space it is given as an overlay, so a crop of another shape is cut to that space and
    // never makes the card larger than its frame.
    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).fill(Theme.wash)
      .overlay {
        if let image {
          Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
            .overlay {
              if let mark {
                GeometryReader { geo in
                  MatchMark()
                    .frame(width: mark.width * geo.size.width + 6, height: mark.height * geo.size.height + 4)
                    .offset(x: mark.minX * geo.size.width - 3, y: mark.minY * geo.size.height - 2)
                }
              }
            }
            .transition(.opacity)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).strokeBorder(Theme.hairline))
    .task(id: url) {
      guard let url else { return }
      if let cached = ImageLoader.shared.cached(url, maxPixels: maxPixels, crop: crop) {
        image = cached
        return
      }
      let loaded = await ImageLoader.shared.load(url, maxPixels: maxPixels, crop: crop)
      withAnimation(Theme.easeOut) { image = loaded }
    }
  }
}
