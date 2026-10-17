import CoreGraphics
import Foundation

/// What made the scheduler take a capture.
public enum CaptureTrigger: String, Codable, Sendable {
  /// A minute passed since the last capture.
  case timer
  /// Wake or unlock; in stores from before dwell capture, also a new app or site held 5 s.
  case contextSwitch = "switch"
  case manual
  case replay
  /// A new title or page held 10 s.
  case view
  /// The screen stayed still 10 s after a click, scroll, typing or page change.
  case settle
  /// Typing paused 3 s after a burst.
  case typing

  /// Captures made because of what the person did, which `DwellScheduler` spaces and caps.
  public var isEvent: Bool {
    switch self {
    case .view, .settle, .typing: true
    case .timer, .contextSwitch, .manual, .replay: false
    }
  }
}

/// The state of a capture's OCR text.
public enum OCRState: String, Codable, Sendable {
  case pending
  case done
  case failed
  /// Duplicates reuse the text of the frame they duplicate.
  case notNeeded = "not_needed"
  /// An evidence frame kept as a picture: it showed no new content, or came past the hour's allowance of reads.
  case skipped
}

/// The frontmost app and window at capture time.
public struct ForegroundContext: Codable, Sendable, Hashable {
  public var bundleID: String?
  public var appName: String?
  public var windowTitle: String?
  public var urlHost: String?
  public var urlPath: String?

  public init(
    bundleID: String? = nil, appName: String? = nil, windowTitle: String? = nil,
    urlHost: String? = nil, urlPath: String? = nil
  ) {
    self.bundleID = bundleID
    self.appName = appName
    self.windowTitle = windowTitle
    self.urlHost = urlHost
    self.urlPath = urlPath
  }

  /// Identity of "the same place on screen": app, window title without notification counters, and page.
  public var key: String {
    [bundleID ?? "", Self.stableTitle(windowTitle), urlHost ?? "", urlPath ?? ""].joined(separator: "|")
  }

  /// The app and site: what has to change for a switch capture.
  public var placeKey: String { [bundleID ?? "", urlHost ?? ""].joined(separator: "|") }

  /// Titles such as "(3) YouTube" or "general (Channel) - Acme - 2 new items - Slack" change with unread counters
  /// while the place stays the same.
  public static func stableTitle(_ title: String?) -> String {
    guard let title else { return "" }
    return title
      .replacingOccurrences(of: #"^\(\d+\)\s*"#, with: "", options: .regularExpression)
      .replacingOccurrences(of: #" - \d+ new items?(?= - )"#, with: "", options: .regularExpression)
  }
}

/// A rectangle in a display's frame, as fractions of its width and height from the top left.
public struct ScreenRect: Codable, Sendable, Hashable {
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double

  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }

  /// `rect` (global points, top-left origin) within `display` (the same), clipped to the display; nil when it misses.
  public init?(_ rect: CGRect, in display: CGRect) {
    let clipped = rect.intersection(display)
    guard !clipped.isNull, display.width > 0, display.height > 0, clipped.width >= 1, clipped.height >= 1 else { return nil }
    self.init(
      x: (clipped.minX - display.minX) / display.width, y: (clipped.minY - display.minY) / display.height,
      width: clipped.width / display.width, height: clipped.height / display.height)
  }

  /// A window big enough to stand for the screen; smaller ones (a dialog, a menu-bar panel) keep the whole frame.
  public var isWorthCropping: Bool { width * height >= 0.12 && width * height < 0.995 }

  /// The rectangle in a `width` × `height` image.
  public func rect(width: Int, height: Int) -> CGRect {
    CGRect(x: x * Double(width), y: y * Double(height), width: self.width * Double(width), height: self.height * Double(height))
      .integral
  }
}

/// One moment of evidence. Immutable once written, except for OCR state and backup bookkeeping.
public struct Capture: Codable, Sendable, Hashable, Identifiable {
  public var id: String
  /// Seconds since 1970, UTC.
  public var at: Double
  public var trigger: CaptureTrigger
  public var displayID: UInt32
  /// The display holding the focused window. Only these captures feed the understanding pipeline.
  public var isFocusedDisplay: Bool
  public var context: ForegroundContext
  /// Relative to the store's root; nil for duplicates, which point at the frame they repeat.
  public var framePath: String?
  public var thumbPath: String?
  public var pixelWidth: Int
  public var pixelHeight: Int
  public var dHash: Int64
  public var duplicateOf: String?
  public var ocrState: OCRState
  /// Where the frontmost window sat in a focused display's frame when it was captured; nil on other displays and
  /// for captures made before this was recorded.
  public var window: ScreenRect?
  /// Gets a boundary question. Any other capture is evidence: kept, shown and searchable, and it continues the
  /// activity of the capture before it.
  public var isAnchor: Bool

  public init(
    id: String = UUID().uuidString, at: Double, trigger: CaptureTrigger, displayID: UInt32,
    isFocusedDisplay: Bool, context: ForegroundContext, framePath: String?, thumbPath: String?,
    pixelWidth: Int, pixelHeight: Int, dHash: Int64, duplicateOf: String?, ocrState: OCRState, window: ScreenRect? = nil,
    isAnchor: Bool = true
  ) {
    self.id = id
    self.at = at
    self.trigger = trigger
    self.displayID = displayID
    self.isFocusedDisplay = isFocusedDisplay
    self.context = context
    self.framePath = framePath
    self.thumbPath = thumbPath
    self.pixelWidth = pixelWidth
    self.pixelHeight = pixelHeight
    self.dHash = dHash
    self.duplicateOf = duplicateOf
    self.ocrState = ocrState
    self.window = window
    self.isAnchor = isAnchor
  }

  public var date: Date { Date(timeIntervalSince1970: at) }
  public var isDuplicate: Bool { duplicateOf != nil }
}

/// One recognized line of screen text, with its box in normalized top-left coordinates.
public struct OCRLine: Codable, Sendable, Hashable {
  public var text: String
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double

  public init(text: String, x: Double, y: Double, width: Double, height: Double) {
    self.text = text
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
}

/// Facts that end an activity by definition. The only hand rules the pipeline receives.
public enum MarkerKind: String, Codable, Sendable, CaseIterable {
  case sleep, wake, screenLocked = "lock", screenUnlocked = "unlock", idle, active
  case paused = "pause", resumed = "resume", secureInput = "secure_input"
  case permissionLost = "permission_lost", launched = "launch", quit
  /// An excluded app or a private browser window was frontmost, so nothing was captured.
  case excluded

  /// Markers after which the next capture never continues the previous activity.
  public var breaksActivity: Bool {
    switch self {
    case .sleep, .screenLocked, .idle, .paused, .secureInput, .permissionLost, .quit, .launched, .excluded: true
    case .wake, .screenUnlocked, .active, .resumed: false
    }
  }
}

public struct Marker: Codable, Sendable, Hashable {
  public var id: Int64?
  public var at: Double
  public var kind: MarkerKind

  public init(id: Int64? = nil, at: Double, kind: MarkerKind) {
    self.id = id
    self.at = at
    self.kind = kind
  }
}
