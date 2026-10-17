import Foundation

/// Reads the thing a capture was looking at, for one family of apps.
///
/// Apps differ in what "a place" means inside them. A browser's place is a page, and its address is in the
/// capture. Claude's is a conversation, and nothing in the capture names it, so that reader keeps an index built
/// from the transcripts on disk. A terminal's would be a working directory, which only a shell hook can report.
/// A reader is therefore an object with whatever state its app needs, made once per pass, rather than a function.
///
/// Adding an app means writing a reader and a driver and naming them in `ThingReaders.standard` and
/// `ThingDrivers.standard`: no shared switch has to grow.
public protocol ThingReader: Sendable {
  /// The apps this reader answers for. Empty means it answers for anything the others did not.
  var bundleIDs: Set<String> { get }
  func ref(context: ForegroundContext, at: Double) -> ThingRef?
}

/// The readers, asked in order: the first that names the app, then whichever answers for everything else.
public struct ThingReaders: Sendable {
  public let readers: [any ThingReader]

  public init(_ readers: [any ThingReader]) {
    self.readers = readers
  }

  /// Every app Screencap can read a place out of. `sessions` is what turns Claude's one window into the
  /// conversation that was in front; without it, Claude falls through to the window reader.
  public static func standard(sessions: ClaudeSessionIndex? = nil) -> ThingReaders {
    var readers: [any ThingReader] = []
    if let sessions { readers.append(ClaudeReader(sessions: sessions)) }
    readers.append(BrowserReader())
    readers.append(WindowReader())
    return ThingReaders(readers)
  }

  public func ref(context: ForegroundContext, at: Double) -> ThingRef? {
    // Screencap's own windows are where a resume is chosen from, never a place to go back to.
    guard let bundleID = context.bundleID, !bundleID.isEmpty, bundleID != Moments.ownBundleID else { return nil }
    for reader in readers where reader.bundleIDs.contains(bundleID) {
      if let ref = reader.ref(context: context, at: at) { return ref }
    }
    for reader in readers where reader.bundleIDs.isEmpty {
      if let ref = reader.ref(context: context, at: at) { return ref }
    }
    return nil
  }

  public func ref(for capture: Capture) -> ThingRef? {
    ref(context: capture.context, at: capture.at)
  }
}
