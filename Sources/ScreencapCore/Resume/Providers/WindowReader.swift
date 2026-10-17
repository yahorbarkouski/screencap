import Foundation

/// Any app with no finer idea of a place: its window, named by the title, or the app itself when no title was
/// read. Answers for everything the other readers did not.
public struct WindowReader: ThingReader {
  public var bundleIDs: Set<String> { [] }

  public init() {}

  public func ref(context: ForegroundContext, at: Double) -> ThingRef? {
    guard let bundleID = context.bundleID, !bundleID.isEmpty else { return nil }
    let title = ForegroundContext.stableTitle(context.windowTitle)
    if !title.isEmpty {
      return ThingRef(
        key: "win:\(bundleID)|\(title)", kind: .window, label: title, detail: context.appName, bundleID: bundleID)
    }
    return ThingRef(key: "app:\(bundleID)", kind: .app, label: context.appName ?? bundleID, bundleID: bundleID)
  }
}
