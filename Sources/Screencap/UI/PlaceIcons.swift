import AppKit
import ImageIO
import Observation
import ScreencapCore
import SwiftUI

/// Where a thread happens: a website or an app.
enum Place: Hashable {
  case site(String)
  case app(String)
}

/// The one icon a thread shows: the site's own icon for web work, else the app's. App icons come from macOS. A
/// site's icon is fetched once from the site itself (`https://host/favicon.ico`) and kept on disk, so no other
/// service learns which sites were visited; local, private-network and unreachable hosts fall back to the app.
@MainActor
@Observable
final class PlaceIcons {
  private(set) var sites: [String: NSImage] = [:]
  /// Sites whose icon is a dark glyph on nothing (GitHub's, Rust's), drawn in the ink colour so dark mode shows it.
  private(set) var darkGlyphs: Set<String> = []
  @ObservationIgnored private var apps: [String: NSImage] = [:]
  @ObservationIgnored private var requested: Set<String> = []
  @ObservationIgnored private let directory: URL = {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let url = caches.appendingPathComponent("com.screencaping.app/site-icons", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }()

  /// The icon for `place`, falling back to `app` (the browser) while a site's icon loads or when it has none.
  func image(for place: Place, app: String?) -> NSImage? {
    switch place {
    case .site(let host):
      if let image = sites[host] { return image }
      request(host)
      return app.flatMap(appIcon)
    case .app(let bundleID):
      return appIcon(bundleID)
    }
  }

  /// `image` as the icon of `place`: a site's dark glyph, drawn for a light browser tab, takes the ink colour (dark in
  /// light mode, light in dark mode); any other icon is shown as it is.
  @ViewBuilder func icon(_ image: NSImage, for place: Place) -> some View {
    if case .site(let host) = place, darkGlyphs.contains(host) {
      Image(nsImage: image).renderingMode(.template).resizable().interpolation(.high).foregroundStyle(Theme.ink)
    } else {
      Image(nsImage: image).resizable().interpolation(.high)
    }
  }

  func appIcon(_ bundleID: String) -> NSImage? {
    if let image = apps[bundleID] { return image }
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { return nil }
    let image = NSWorkspace.shared.icon(forFile: url.path)
    apps[bundleID] = image
    return image
  }

  /// Icon requests send no cookies and store none, and leave no response cache: the icon files are all that is kept.
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCredentialStorage = nil
    return URLSession(configuration: configuration)
  }()

  /// Builds before this one fetched icons through the shared session, whose disk cache kept every icon response, and
  /// so a list of visited sites, in `Cache.db`. Removes it once.
  static func removeSharedCache() {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("com.screencaping.app")
    for name in ["Cache.db", "Cache.db-shm", "Cache.db-wal", "fsCachedData"] {
      try? FileManager.default.removeItem(at: caches.appendingPathComponent(name))
    }
    // And the cookies those responses set.
    let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("HTTPStorages")
    for name in ["com.screencaping.app", "com.screencaping.app.binarycookies"] {
      try? FileManager.default.removeItem(at: library.appendingPathComponent(name))
    }
  }

  /// The formats a site icon may come in. Anything else (a PDF, an EPS) is never decoded.
  nonisolated static let iconTypes: Set<String> = ["com.microsoft.ico", "public.png", "com.compuserve.gif", "public.jpeg", "org.webmproject.webp"]

  /// The icon in a response, when it is a small image in an icon format from the site that was asked.
  nonisolated static func icon(from data: Data, response: URLResponse, host: String) -> NSImage? {
    guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 256 << 10,
      let final = response.url?.host()?.lowercased(),
      final == host.lowercased() || final == "www.\(host.lowercased())" || "www.\(final)" == host.lowercased(),
      let source = CGImageSourceCreateWithData(data as CFData, nil), let type = CGImageSourceGetType(source) as String?,
      iconTypes.contains(type)
    else { return nil }
    let image = NSImage(data: data)
    return image?.isValid == true ? image : nil
  }

  private func request(_ host: String) {
    guard !requested.contains(host), Self.isPublic(host), SettingsStore().current.fetchesSiteIcons else { return }
    requested.insert(host)
    let file = directory.appendingPathComponent("\(host).png")
    let missing = directory.appendingPathComponent("\(host).none")
    Task.detached(priority: .utility) {
      var image = NSImage(contentsOf: file)
      // A host without an icon is asked again after a week.
      let recentlyMissing = (try? missing.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
        .map { Date().timeIntervalSince($0) < 7 * 86_400 } ?? false
      if image == nil, !recentlyMissing, let url = URL(string: "https://\(host)/favicon.ico") {
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        if let (data, response) = try? await Self.session.data(for: request),
          let fetched = Self.icon(from: data, response: response, host: host),
          let png = fetched.pngData(side: 64), !NSImage.isBlank(png: png)
        {
          try? png.write(to: file)
          image = NSImage(data: png)
        } else {
          try? Data().write(to: missing)
        }
      }
      guard let image else { return }
      let dark = image.tiffRepresentation.map(NSImage.isDarkGlyph) ?? false
      await MainActor.run {
        if dark { self.darkGlyphs.insert(host) }
        self.sites[host] = image
      }
    }
  }

  nonisolated static func isPublic(_ host: String) -> Bool {
    let lower = host.lowercased()
    guard lower.contains("."), !lower.hasSuffix(".local"), !lower.hasSuffix(".internal"), !lower.hasSuffix(".lan"),
      lower != "localhost", !lower.hasSuffix(".localhost")
    else { return false }
    return lower.range(of: #"^[0-9.:]+$"#, options: .regularExpression) == nil
  }
}

extension NSImage {
  /// True when an image's visible pixels are dark and colourless: a black glyph drawn for a light browser tab.
  /// A dark shape on a transparent ground, which disappears on a dark background unless it is drawn in ink.
  ///
  /// The ground has to be there: X's icon is a white X on an opaque black square, mostly dark, and redrawing it in
  /// one colour turned the whole square that colour and the X with it. So at least a fifth of the icon has to be
  /// transparent before it counts as a glyph.
  static func isDarkGlyph(_ data: Data) -> Bool {
    guard let rep = NSBitmapImageRep(data: data) else { return false }
    var sampled = 0, visible = 0, dark = 0
    for x in stride(from: 0, to: rep.pixelsWide, by: 2) {
      for y in stride(from: 0, to: rep.pixelsHigh, by: 2) {
        sampled += 1
        guard let color = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), color.alphaComponent > 0.3 else { continue }
        visible += 1
        let (r, g, b) = (color.redComponent, color.greenComponent, color.blueComponent)
        if max(r, g, b) < 0.35 && max(r, g, b) - min(r, g, b) < 0.12 { dark += 1 }
      }
    }
    let transparent = Double(sampled - visible) / Double(max(sampled, 1))
    return visible > 0 && transparent >= 0.2 && Double(dark) / Double(visible) > 0.8
  }

  /// True when a PNG shows nothing: every pixel transparent, or one colour throughout (some sites serve such a
  /// favicon), so the app's icon is shown instead.
  static func isBlank(png: Data) -> Bool {
    guard let rep = NSBitmapImageRep(data: png), rep.pixelsWide > 0, rep.pixelsHigh > 0 else { return true }
    var first: NSColor?
    for x in stride(from: 0, to: rep.pixelsWide, by: 2) {
      for y in stride(from: 0, to: rep.pixelsHigh, by: 2) {
        guard let color = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), color.alphaComponent > 0.05 else { continue }
        if let first, abs(first.redComponent - color.redComponent) + abs(first.greenComponent - color.greenComponent)
          + abs(first.blueComponent - color.blueComponent) > 0.1
        {
          return false
        }
        first = first ?? color
      }
    }
    return true
  }

  /// A square PNG of the image at `side` pixels.
  func pngData(side: Int) -> Data? {
    guard
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw(in: NSRect(x: 0, y: 0, width: side, height: side))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
  }
}

/// A thread's place icon at `size` points.
struct PlaceIcon: View {
  let icons: PlaceIcons
  let place: Place?
  let app: String?
  var size: CGFloat = 20

  var body: some View {
    if let place, let image = icons.image(for: place, app: app) {
      icons.icon(image, for: place).frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
    }
  }
}
