import Foundation

/// Which agent read what: one JSON line per tool call, in `agent-access.jsonl` beside the database, which Settings
/// shows. The MCP server writes it; nothing else in the store changes when an agent reads.
public struct AgentAccessLog: Sendable {
  public struct Entry: Codable, Sendable, Equatable {
    public var at: Double
    /// The client as people know it: "Claude Code", "Cursor"…
    public var client: String
    public var tool: String
    /// What was read, such as `searched “invoice” · 3 results`, or why the call was refused.
    public var summary: String
    /// False when the person's settings refused the call.
    public var allowed: Bool

    public init(at: Double, client: String, tool: String, summary: String, allowed: Bool) {
      self.at = at
      self.client = client
      self.tool = tool
      self.summary = summary
      self.allowed = allowed
    }
  }

  public let url: URL
  /// Past this size the log keeps its latest `keptLines` lines.
  static let maxBytes = 1_000_000
  static let keptLines = 2_000

  public init(location: StoreLocation) {
    url = location.root.appendingPathComponent("agent-access.jsonl")
  }

  /// Appends one entry. Several servers (one per connected client) may append at once; each line is one `write` to
  /// a file opened for appending, so lines never interleave.
  public func append(_ entry: Entry) {
    guard FileManager.default.fileExists(atPath: url.deletingLastPathComponent().path),
      var line = try? JSONEncoder().encode(entry)
    else { return }
    line.append(0x0A)
    let descriptor = open(url.path, O_WRONLY | O_APPEND | O_CREAT, 0o600)
    guard descriptor >= 0 else { return }
    _ = line.withUnsafeBytes { write(descriptor, $0.baseAddress, $0.count) }
    let size = lseek(descriptor, 0, SEEK_END)
    close(descriptor)
    if size > Self.maxBytes { trim() }
  }

  func trim() {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
    let lines = text.split(separator: "\n").suffix(Self.keptLines)
    try? (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
  }

  /// The latest entries, newest first.
  public func recent(_ count: Int) -> [Entry] {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
    let decoder = JSONDecoder()
    return text.split(separator: "\n").suffix(count).reversed().compactMap { try? decoder.decode(Entry.self, from: Data($0.utf8)) }
  }

  public func clear() {
    try? FileManager.default.removeItem(at: url)
  }

  /// The name people know a client by, from the name it reports in `clientInfo`.
  public static func clientLabel(_ name: String?) -> String {
    guard let name, !name.isEmpty else { return "An agent" }
    let lower = name.lowercased()
    let known: [(String, String)] = [
      ("claude-code", "Claude Code"), ("claude code", "Claude Code"), ("claude", "Claude"), ("cursor", "Cursor"),
      ("codex", "Codex"), ("visual studio code", "VS Code"), ("vscode", "VS Code"), ("windsurf", "Windsurf"), ("zed", "Zed"),
    ]
    return known.first { lower.contains($0.0) }?.1 ?? String(name.prefix(40))
  }
}
