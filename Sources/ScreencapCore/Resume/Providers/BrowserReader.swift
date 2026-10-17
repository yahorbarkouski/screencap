import Foundation

/// A page in a browser, named by its address.
///
/// The address rather than the page's title, because a title is written by the page and changes with it, while a
/// browser window holds pages from several threads at once: one window can show a video and a code review a minute
/// apart. Binding the window would make both one place.
public struct BrowserReader: ThingReader {
  public var bundleIDs: Set<String> { Set(PrivateWindows.browsers.keys) }

  public init() {}

  public func ref(context: ForegroundContext, at: Double) -> ThingRef? {
    guard let bundleID = context.bundleID, let host = context.urlHost, !host.isEmpty else { return nil }
    let place = ThingKey.address(host: host, path: context.urlPath)
    return ThingRef(key: "url:\(place)", kind: .tab, label: place, bundleID: bundleID)
  }
}
