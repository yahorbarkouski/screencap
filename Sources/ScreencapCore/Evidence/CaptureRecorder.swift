import CoreGraphics
import Foundation

/// A frame and the context it was taken in, as the platform layer hands it over.
public struct CapturedFrame: @unchecked Sendable {
  public let image: CGImage
  public let displayID: UInt32
  public let isFocusedDisplay: Bool
  public let context: ForegroundContext
  public let trigger: CaptureTrigger
  public let at: Double
  /// The frontmost window's place in this frame (focused display only).
  public let window: ScreenRect?
  /// Gets a boundary question (`DwellScheduler.captured`); anchors always have their text read.
  public let isAnchor: Bool

  public init(
    image: CGImage, displayID: UInt32, isFocusedDisplay: Bool, context: ForegroundContext, trigger: CaptureTrigger,
    at: Double, window: ScreenRect? = nil, isAnchor: Bool = true
  ) {
    self.image = image
    self.displayID = displayID
    self.isFocusedDisplay = isFocusedDisplay
    self.context = context
    self.trigger = trigger
    self.at = at
    self.window = window
    self.isAnchor = isAnchor
  }
}

/// Which evidence frames get their text read. Reading a frame costs about 0.29 s of CPU, and reading every evidence
/// frame of dwell capture would take the app and its OCR helper to about 1.3% of a core against a 1% budget.
/// So an evidence frame is read only when it shows new content against the last frame
/// read on its display (another view, or at least `changedShare` of the screen changed), and at most `perHour` of
/// them an hour; the others are kept as pictures.
public struct EvidenceReading: Sendable {
  public var changedShare = 0.25
  public var perHour: Double = 12
  /// Reads allowed in a row after a quiet spell.
  public var burst: Double = 2

  public init() {}
}

/// Turns frames into capture rows: unchanged screens become duplicate rows that point at the frame they repeat
/// (no encode, OCR or upload), new screens are written as HEIC frames with thumbnails.
public actor CaptureRecorder {
  struct KeptFrame {
    let captureID: String
    let fingerprint: FrameFingerprint
    let contextKey: String
  }

  let database: AppDatabase
  let location: StoreLocation
  let timeZone: TimeZone
  let reading: EvidenceReading
  var lastKept: [UInt32: KeptFrame] = [:]
  /// The last frame queued for OCR on each display, which an evidence frame must differ from to be read.
  var lastRead: [UInt32: KeptFrame] = [:]
  private var readAllowance: Double
  private var readAllowanceAt: Double?

  public init(
    database: AppDatabase, location: StoreLocation, timeZone: TimeZone = .current, reading: EvidenceReading = .init()
  ) {
    self.database = database
    self.location = location
    self.timeZone = timeZone
    self.reading = reading
    readAllowance = reading.burst
  }

  @discardableResult
  public func record(_ frame: CapturedFrame) throws -> Capture {
    // Encoders and Core Graphics leave autoreleased buffers the size of a frame; release them per capture, and
    // hand freed pages back to the system so the menu-bar process stays small between captures.
    defer { malloc_zone_pressure_relief(nil, 0) }
    return try autoreleasepool { try recordFrame(frame) }
  }

  func recordFrame(_ frame: CapturedFrame) throws -> Capture {
    let context = frame.context.scrubbed
    let fingerprint = FrameFingerprint(image: frame.image) ?? FrameFingerprint(dHash: 0, gray: [])
    let contextKey = context.key
    if let previous = lastKept[frame.displayID], previous.contextKey == contextKey,
      previous.fingerprint.isSameScreen(as: fingerprint)
    {
      let duplicate = Capture(
        at: frame.at, trigger: frame.trigger, displayID: frame.displayID, isFocusedDisplay: frame.isFocusedDisplay,
        context: context, framePath: nil, thumbPath: nil, pixelWidth: frame.image.width,
        pixelHeight: frame.image.height, dHash: Int64(bitPattern: fingerprint.dHash), duplicateOf: previous.captureID,
        ocrState: .notNeeded, window: frame.window, isAnchor: frame.isAnchor)
      try database.insert(duplicate)
      return duplicate
    }

    let id = UUID().uuidString
    let framePath = location.frameRelativePath(captureID: id, at: frame.at, timeZone: timeZone)
    let thumbPath = location.thumbRelativePath(captureID: id, at: frame.at, timeZone: timeZone)
    try FrameEncoder.writeHEIC(frame.image, to: location.url(framePath))
    try FrameEncoder.writeThumbnail(frame.image, to: location.url(thumbPath))
    let capture = Capture(
      id: id, at: frame.at, trigger: frame.trigger, displayID: frame.displayID,
      isFocusedDisplay: frame.isFocusedDisplay, context: context, framePath: framePath, thumbPath: thumbPath,
      pixelWidth: frame.image.width, pixelHeight: frame.image.height, dHash: Int64(bitPattern: fingerprint.dHash),
      duplicateOf: nil, ocrState: reads(frame, fingerprint: fingerprint, contextKey: contextKey) ? .pending : .skipped,
      window: frame.window, isAnchor: frame.isAnchor)
    try database.insert(capture)
    try database.enqueueBackup(.frame, objectKey: BackupKeys.frame(capture: capture), localPath: framePath)
    let kept = KeptFrame(captureID: id, fingerprint: fingerprint, contextKey: contextKey)
    lastKept[frame.displayID] = kept
    if capture.ocrState == .pending { lastRead[frame.displayID] = kept }
    return capture
  }

  /// Whether a kept frame gets its text read (see `EvidenceReading`).
  func reads(_ frame: CapturedFrame, fingerprint: FrameFingerprint, contextKey: String) -> Bool {
    if frame.isAnchor { return true }
    if let previous = lastRead[frame.displayID], previous.contextKey == contextKey,
      fingerprint.changedShare(from: previous.fingerprint) < reading.changedShare
    {
      return false
    }
    if let readAllowanceAt {
      readAllowance = min(reading.burst, readAllowance + (frame.at - readAllowanceAt) * reading.perHour / 3600)
    }
    readAllowanceAt = frame.at
    guard readAllowance >= 1 else { return false }
    readAllowance -= 1
    return true
  }

  /// After a hard break the next frame is always kept, so an activity never starts on a duplicate.
  public func forgetKeptFrames() {
    lastKept.removeAll()
    lastRead.removeAll()
  }
}
