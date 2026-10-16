import Foundation
import os

/// Where one store lives on disk: the database and the frame and thumbnail folders.
///
/// The app's store sits in `~/Library/Application Support/com.screencaping.app`, apart from v1's `screencap` folder
/// (APFS is case-insensitive, so a `Screencap` folder would be v1's). Replays and tests use their own roots.
public struct StoreLocation: Sendable, Hashable {
  public let root: URL

  public init(root: URL) {
    self.root = root
  }

  public static var standard: StoreLocation {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return StoreLocation(root: support.appendingPathComponent("com.screencaping.app", isDirectory: true))
  }

  public var databaseURL: URL { root.appendingPathComponent("screencap.sqlite") }

  /// `Frames/2026/10/15/<id>.heic`, relative to the root.
  public func frameRelativePath(captureID: String, at: Double, timeZone: TimeZone = .current) -> String {
    "Frames/\(dayPath(at, timeZone))/\(captureID).heic"
  }

  public func thumbRelativePath(captureID: String, at: Double, timeZone: TimeZone = .current) -> String {
    "Thumbs/\(dayPath(at, timeZone))/\(captureID).heic"
  }

  public func url(_ relativePath: String) -> URL {
    relativePath.hasPrefix("/") ? URL(fileURLWithPath: relativePath) : root.appendingPathComponent(relativePath)
  }

  /// Creates the root readable by this user alone, and closes a root that an older build left open to others.
  public func prepare() throws {
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
  }

  public func openDatabase() throws -> AppDatabase {
    try prepare()
    return try AppDatabase(path: databaseURL.path)
  }

  func dayPath(_ at: Double, _ timeZone: TimeZone) -> String {
    TimeFormatter(timeZone: timeZone).day(at).replacingOccurrences(of: "-", with: "/")
  }
}

public enum Log {
  public static let capture = Logger(subsystem: "com.screencaping.app", category: "capture")
  public static let understanding = Logger(subsystem: "com.screencaping.app", category: "understanding")
  public static let backup = Logger(subsystem: "com.screencaping.app", category: "backup")
  public static let ui = Logger(subsystem: "com.screencaping.app", category: "ui")
}
