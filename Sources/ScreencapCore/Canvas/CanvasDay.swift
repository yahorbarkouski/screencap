import Foundation

/// One screenshot on the canvas.
public struct CanvasShot: Sendable, Equatable, Identifiable {
  public var id: String { captureID }
  public var captureID: String
  public var activityID: Int64
  public var at: Double
  public var thumbPath: String
  public var framePath: String?
  public var pixelWidth: Int
  public var pixelHeight: Int
  /// The window in front, when the screenshot knows where it was and it is worth cutting to.
  public var crop: ScreenRect?

  /// Width over height of what is shown: the window, else the whole screen.
  public var aspect: Double {
    let whole = Double(max(pixelWidth, 1)) / Double(max(pixelHeight, 1))
    guard let crop, crop.height > 0 else { return whole }
    return whole * crop.width / crop.height
  }

  /// The part of the screenshot (fractions from the top left) that fills a frame of `aspect`: the window's top, its
  /// sides cut evenly when it is wider than the frame.
  public func fill(_ aspect: Double) -> ScreenRect {
    let shown = crop ?? ScreenRect(x: 0, y: 0, width: 1, height: 1)
    let own = self.aspect
    guard own > 0, aspect > 0 else { return shown }
    if own >= aspect {
      let width = shown.width * aspect / own
      return ScreenRect(x: shown.x + (shown.width - width) / 2, y: shown.y, width: width, height: shown.height)
    }
    return ScreenRect(x: shown.x, y: shown.y, width: shown.width, height: shown.height * own / aspect)
  }
}

/// Where a thing's icon comes from.
public enum CanvasIcon: Sendable, Hashable {
  case site(String)
  case app(String)
}

/// One thing a thread was about on a day: a channel, a video, a document, a conversation, an app, or the last group
/// of what was only passed through.
public struct CanvasThing: Sendable, Equatable, Identifiable {
  public enum Kind: Sendable { case page, site, rest }

  public var id: String
  public var kind: Kind
  public var title: String
  /// Where it is ("Streams" for a channel); empty when the title already says so.
  public var place: String
  public var icon: CanvasIcon
  /// The app it was mostly seen in, for when a site has no icon.
  public var bundleID: String?
  public var seconds: Double
  /// When it was on screen, a short look away not ending a visit.
  public var visits: [ClosedRange<Double>]
  /// Its distinct screens, oldest first; never empty.
  public var shots: [CanvasShot]
  /// The screen that stands for it, in `shots`.
  public var cover: Int
  /// What a search looks in, lowercased.
  public var searchText: String
}

public struct CanvasThread: Sendable, Equatable, Identifiable {
  /// 0 for activities that have no thread yet.
  public var id: Int64
  public var name: String
  public var seconds: Double
  /// Most time first, what was only passed through last; never empty.
  public var things: [CanvasThing]
}

/// A day as the canvas shows it: its threads, most time first.
public struct CanvasDay: Sendable, Equatable {
  public var threads: [CanvasThread]
  /// From the first moment shown to the last.
  public var span: ClosedRange<Double>

  public init(threads: [CanvasThread], span: ClosedRange<Double>) {
    self.threads = threads
    self.span = span
  }
}

/// A day as the stack of earlier days and the ruler show it.
public struct CanvasDaySummary: Sendable, Equatable {
  /// Local midnight.
  public var start: Double
  public var captures: Int
  /// Threads that took most of it, most first.
  public var threads: [String]

  public init(start: Double, captures: Int, threads: [String]) {
    self.start = start
    self.captures = captures
    self.threads = threads
  }
}
