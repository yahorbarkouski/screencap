import Foundation

/// What AI agents may read through `Screencap mcp`. Both are off until the person turns them on in Settings.
public struct AgentSettings: Sendable, Equatable, Codable {
  /// Agents may search the history and read days, threads and activities.
  public var isEnabled = false
  /// Agents may also see screenshots. Only counts while `isEnabled` is on.
  public var includesScreenshots = false

  public init(isEnabled: Bool = false, includesScreenshots: Bool = false) {
    self.isEnabled = isEnabled
    self.includesScreenshots = includesScreenshots
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    isEnabled = try c.decodeIfPresent(Bool.self, forKey: .isEnabled) ?? false
    includesScreenshots = try c.decodeIfPresent(Bool.self, forKey: .includesScreenshots) ?? false
  }
}
