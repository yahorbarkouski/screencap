import AppKit
import ScreencapCore
import SwiftUI

/// The frames of the made-up day (`DemoStore`): a desktop with a menu bar and a Dock, and a browser window showing a
/// public web page captured by `scripts/capture-pages.sh`. Nothing on them comes from anyone's own screen.
@MainActor
enum FakeScreens {
  static let size = CGSize(width: 1728, height: 1117)

  static func image(_ scene: DemoStore.Scene, pages: URL) throws -> CGImage {
    let file = pages.appendingPathComponent("\(scene.page.key).png")
    guard let page = NSImage(contentsOf: file) else {
      throw CocoaError(.fileReadNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "no capture of \(scene.page.key) at \(file.path)"])
    }
    let renderer = ImageRenderer(content: FakeDesktop(scene: scene, page: page).frame(width: size.width, height: size.height))
    renderer.scale = 1
    guard let image = renderer.cgImage else { throw CocoaError(.fileWriteUnknown) }
    return image
  }
}

private extension Color {
  init(rgb hex: UInt32, opacity: Double = 1) {
    self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: opacity)
  }
}

/// The screen: wallpaper, menu bar, the browser window where `DemoStore.window` puts it, and the Dock.
struct FakeDesktop: View {
  let scene: DemoStore.Scene
  let page: NSImage

  var body: some View {
    GeometryReader { geo in
      let rect = DemoStore.window.rect(width: Int(geo.size.width), height: Int(geo.size.height))
      ZStack(alignment: .topLeading) {
        // A dark wallpaper lit at its edges, like the README's backdrop.
        Color(rgb: 0x08090E)
        Circle().fill(Color(rgb: 0x6366F1, opacity: 0.55)).frame(width: 1100).blur(radius: 160).offset(x: -380, y: -560)
        Circle().fill(Color(rgb: 0x8B5CF6, opacity: 0.5)).frame(width: 800).blur(radius: 150).offset(x: 1350, y: -300)
        Circle().fill(Color(rgb: 0x14B8A6, opacity: 0.45)).frame(width: 1100).blur(radius: 170).offset(x: 760, y: 820)
        Circle().fill(Color(rgb: 0xDB2777, opacity: 0.4)).frame(width: 600).blur(radius: 140).offset(x: -260, y: 820)
        menuBar.frame(width: geo.size.width)
        BrowserWindow(scene: scene, page: page)
          .frame(width: rect.width, height: rect.height)
          .offset(x: rect.minX, y: rect.minY)
        dock.frame(width: geo.size.width, height: geo.size.height, alignment: .bottom)
      }
    }
    .environment(\.colorScheme, .light)
  }

  var menuBar: some View {
    HStack(spacing: 22) {
      Image(systemName: "apple.logo").font(.system(size: 15, weight: .semibold))
      Text(DemoStore.browser.name).font(.system(size: 13.5, weight: .bold))
      ForEach(["File", "Edit", "View", "History", "Bookmarks", "Window", "Help"], id: \.self) { Text($0).font(.system(size: 13.5)) }
      Spacer()
      Image(systemName: "wifi").font(.system(size: 13))
      Image(systemName: "battery.75percent").font(.system(size: 14))
    }
    .foregroundStyle(.white)
    .padding(.horizontal, 18).frame(height: 30)
    .background(Color.white.opacity(0.12))
  }

  var dock: some View {
    HStack(spacing: 10) {
      ForEach(["com.apple.finder", "com.apple.Safari", "com.apple.MobileSMS", "com.apple.mail", "com.apple.iCal", "com.apple.Notes",
        "com.apple.Music", "com.apple.Terminal", "com.apple.Maps", "com.apple.systempreferences"], id: \.self) { id in
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) {
          Image(nsImage: NSWorkspace.shared.icon(forFile: url.path)).resizable().frame(width: 52, height: 52)
        }
      }
    }
    .padding(.horizontal, 12).padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color.white.opacity(0.22)))
    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.white.opacity(0.3)))
    .padding(.bottom, 8)
  }
}

/// A browser window: its buttons, its address bar, and the captured page.
struct BrowserWindow: View {
  let scene: DemoStore.Scene
  let page: NSImage

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Circle().fill(Color(rgb: 0xFF5F57)).frame(width: 12, height: 12)
        Circle().fill(Color(rgb: 0xFEBC2E)).frame(width: 12, height: 12)
        Circle().fill(Color(rgb: 0x28C840)).frame(width: 12, height: 12)
        HStack(spacing: 14) {
          Image(systemName: "sidebar.left")
          Image(systemName: "chevron.left")
          Image(systemName: "chevron.right").foregroundStyle(Color(rgb: 0xC0C0C4))
        }
        .font(.system(size: 15)).foregroundStyle(Color(rgb: 0x6E6E73)).padding(.leading, 18)
        HStack(spacing: 8) {
          Image(systemName: "lock.fill").font(.system(size: 11)).foregroundStyle(Color(rgb: 0x6E6E73))
          Text(address).font(.system(size: 13.5)).foregroundStyle(Color(rgb: 0x1D1D1F)).lineLimit(1)
        }
        .frame(maxWidth: 560).frame(height: 32).background(RoundedRectangle(cornerRadius: 9).fill(Color(rgb: 0xE8E8EB)))
        .frame(maxWidth: .infinity)
        Image(systemName: "square.and.arrow.up").font(.system(size: 15)).foregroundStyle(Color(rgb: 0x6E6E73))
        Image(systemName: "plus").font(.system(size: 15)).foregroundStyle(Color(rgb: 0x6E6E73))
      }
      .padding(.horizontal, 16).frame(height: 52).background(Color(rgb: 0xF4F4F6))
      Rectangle().fill(Color(rgb: 0xDCDCE0)).frame(height: 1)
      Image(nsImage: page).resizable().aspectRatio(contentMode: .fill)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).clipped()
    }
    .background(.white)
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    .shadow(color: .black.opacity(0.35), radius: 30, y: 16)
  }

  var address: String {
    guard let url = URL(string: scene.page.url), let host = url.host() else { return scene.page.url }
    return host.replacingOccurrences(of: "www.", with: "")
  }
}
