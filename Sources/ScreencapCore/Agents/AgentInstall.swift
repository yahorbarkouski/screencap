import Foundation

/// The agent apps `Screencap mcp install` connects.
public enum AgentClient: String, CaseIterable, Sendable, Identifiable {
  case claudeCode = "claude-code"
  case claudeDesktop = "claude-desktop"
  case cursor
  case codex

  public var id: String { rawValue }

  public var name: String {
    switch self {
    case .claudeCode: "Claude Code"
    case .claudeDesktop: "Claude Desktop"
    case .cursor: "Cursor"
    case .codex: "Codex"
    }
  }
}

/// Connects agent apps to `Screencap mcp`: registers the server under the name `screencap` in each app's own
/// configuration, and writes the skill where that app reads skills. Installing twice leaves what installing once
/// does; an older `screencap` entry (Screencap v1's) is replaced.
public struct AgentInstaller: Sendable {
  public struct Failure: Error, Sendable, CustomStringConvertible {
    public var description: String
    init(_ description: String) { self.description = description }
  }

  public enum Status: Sendable, Equatable {
    /// The agent app is not on this Mac.
    case missing
    case disconnected
    case connected
    /// A `screencap` entry starts something else, such as Screencap v1 or a build elsewhere.
    case connectedElsewhere(String)
  }

  public static let serverName = "screencap"

  let home: URL
  /// The binary clients start, with `mcp` as its one argument.
  public let executable: String
  /// Runs a program and returns its exit status and combined output.
  let run: @Sendable (_ program: String, _ arguments: [String]) throws -> (status: Int32, output: String)
  /// Where the `claude` command is, or nil when Claude Code is not installed.
  let findClaude: @Sendable () -> String?

  public init(
    executable: String, home: URL = AgentInstaller.home,
    run: @escaping @Sendable (String, [String]) throws -> (status: Int32, output: String) = AgentInstaller.runProcess,
    findClaude: (@Sendable () -> String?)? = nil
  ) {
    self.executable = executable
    self.home = home
    self.run = run
    self.findClaude = findClaude ?? { AgentInstaller.locateClaude(home: home) }
  }

  /// The home folder as `$HOME` names it, as the agent apps' own command-line tools read it.
  public static var home: URL {
    ProcessInfo.processInfo.environment["HOME"].map { URL(fileURLWithPath: $0, isDirectory: true) }
      ?? FileManager.default.homeDirectoryForCurrentUser
  }

  // MARK: Paths

  var claudeDesktopConfig: URL { home.appendingPathComponent("Library/Application Support/Claude/claude_desktop_config.json") }
  var cursorConfig: URL { home.appendingPathComponent(".cursor/mcp.json") }
  var codexConfig: URL { home.appendingPathComponent(".codex/config.toml") }
  /// Claude Code keeps user-scope servers under `mcpServers` here; it is read, and changed only through `claude`.
  var claudeCodeConfig: URL { home.appendingPathComponent(".claude.json") }

  /// Where each app reads skills: Claude Code its own folder, Codex and Cursor the shared `~/.agents/skills`.
  func skillFolder(_ client: AgentClient) -> URL? {
    switch client {
    case .claudeCode: home.appendingPathComponent(".claude/skills/\(SkillText.name)")
    case .cursor, .codex: home.appendingPathComponent(".agents/skills/\(SkillText.name)")
    case .claudeDesktop: nil
    }
  }

  /// The JSON entry Claude Desktop and Cursor read.
  var entry: JSONValue { ["command": .string(executable), "args": ["mcp"]] }

  /// What a person types to connect Claude Code themselves.
  public var claudeCodeCommand: String {
    "claude mcp add --scope user \(Self.serverName) -- \(Self.shellQuoted(executable)) mcp"
  }

  static func shellQuoted(_ text: String) -> String {
    text.allSatisfy { $0.isLetter || $0.isNumber || "/._-+".contains($0) } ? text : "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }

  // MARK: Status

  public func status(_ client: AgentClient) -> Status {
    switch client {
    case .claudeCode:
      guard findClaude() != nil else { return .missing }
      return jsonStatus(claudeCodeConfig)
    case .claudeDesktop:
      guard FileManager.default.fileExists(atPath: claudeDesktopConfig.deletingLastPathComponent().path) else { return .missing }
      return jsonStatus(claudeDesktopConfig)
    case .cursor:
      guard FileManager.default.fileExists(atPath: cursorConfig.deletingLastPathComponent().path) else { return .missing }
      return jsonStatus(cursorConfig)
    case .codex:
      guard FileManager.default.fileExists(atPath: codexConfig.deletingLastPathComponent().path) else { return .missing }
      let text = (try? String(contentsOf: codexConfig, encoding: .utf8)) ?? ""
      guard let command = Self.codexCommand(in: text) else { return .disconnected }
      return command == executable ? .connected : .connectedElsewhere(command)
    }
  }

  func jsonStatus(_ url: URL) -> Status {
    guard let data = try? Data(contentsOf: url), let config = try? JSONValue.parse(data),
      let server = config["mcpServers"]?[Self.serverName]
    else { return .disconnected }
    let command = ([server["command"]?.string ?? ""] + (server["args"]?.array ?? []).compactMap(\.string)).joined(separator: " ")
    return server["command"]?.string == executable && server["args"] == ["mcp"] ? .connected : .connectedElsewhere(command)
  }

  // MARK: Install

  /// Connects `client` and returns a sentence for the person saying what changed and what to do next.
  public func install(_ client: AgentClient) throws -> String {
    switch client {
    case .claudeCode:
      guard let claude = findClaude() else {
        throw Failure("Claude Code's claude command is not on this Mac. Install Claude Code, or run this yourself: \(claudeCodeCommand)")
      }
      if status(.claudeCode) != .disconnected {
        _ = try run(claude, ["mcp", "remove", Self.serverName, "--scope", "user"])
      }
      let added = try run(claude, ["mcp", "add", "--scope", "user", Self.serverName, "--", executable, "mcp"])
      guard added.status == 0 else {
        throw Failure("claude mcp add failed: \(added.output.trimmingCharacters(in: .whitespacesAndNewlines))")
      }
      try writeSkill(for: .claudeCode)
      return "Connected Claude Code for all your projects and added the screencap skill. New Claude Code sessions can use it."
    case .claudeDesktop:
      try requireFolder(claudeDesktopConfig, app: "Claude Desktop")
      try editJSON(claudeDesktopConfig) { $0.setting("mcpServers", to: ($0["mcpServers"] ?? [:]).setting(Self.serverName, to: entry)) }
      return "Connected Claude Desktop. Quit and reopen it to load Screencap."
    case .cursor:
      try requireFolder(cursorConfig, app: "Cursor")
      try editJSON(cursorConfig) { $0.setting("mcpServers", to: ($0["mcpServers"] ?? [:]).setting(Self.serverName, to: entry)) }
      try writeSkill(for: .cursor)
      return "Connected Cursor and added the screencap skill. Restart Cursor if it is open."
    case .codex:
      try requireFolder(codexConfig, app: "Codex")
      let text = (try? String(contentsOf: codexConfig, encoding: .utf8)) ?? ""
      try write(Self.codexConfig(text, executable: executable), to: codexConfig)
      try writeSkill(for: .codex)
      return "Connected Codex and added the screencap skill. New Codex sessions can use it."
    }
  }

  /// Removes what `install` added and returns a sentence saying so.
  public func uninstall(_ client: AgentClient) throws -> String {
    switch client {
    case .claudeCode:
      guard let claude = findClaude() else { throw Failure("Claude Code's claude command is not on this Mac.") }
      if status(.claudeCode) != .disconnected {
        let removed = try run(claude, ["mcp", "remove", Self.serverName, "--scope", "user"])
        guard removed.status == 0 else {
          throw Failure("claude mcp remove failed: \(removed.output.trimmingCharacters(in: .whitespacesAndNewlines))")
        }
      }
    case .claudeDesktop:
      if FileManager.default.fileExists(atPath: claudeDesktopConfig.path) {
        try editJSON(claudeDesktopConfig) { $0.setting("mcpServers", to: ($0["mcpServers"] ?? [:]).setting(Self.serverName, to: nil)) }
      }
    case .cursor:
      if FileManager.default.fileExists(atPath: cursorConfig.path) {
        try editJSON(cursorConfig) { $0.setting("mcpServers", to: ($0["mcpServers"] ?? [:]).setting(Self.serverName, to: nil)) }
      }
    case .codex:
      if let text = try? String(contentsOf: codexConfig, encoding: .utf8) {
        try write(Self.codexConfig(text, executable: nil), to: codexConfig)
      }
    }
    removeSkill(for: client)
    return "Disconnected \(client.name)."
  }

  // MARK: Skill

  func writeSkill(for client: AgentClient) throws {
    guard let folder = skillFolder(client) else { return }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try write(SkillText.markdown + "\n", to: folder.appendingPathComponent("SKILL.md"))
  }

  /// Removes the skill this installer wrote, unless another connected app reads the same folder or the person edited
  /// the file.
  func removeSkill(for client: AgentClient) {
    guard let folder = skillFolder(client),
      !AgentClient.allCases.contains(where: { $0 != client && skillFolder($0) == folder && status($0) == .connected })
    else { return }
    let file = folder.appendingPathComponent("SKILL.md")
    guard (try? String(contentsOf: file, encoding: .utf8)) == SkillText.markdown + "\n" else { return }
    try? FileManager.default.removeItem(at: file)
    if (try? FileManager.default.contentsOfDirectory(atPath: folder.path))?.isEmpty == true {
      try? FileManager.default.removeItem(at: folder)
    }
  }

  // MARK: Files

  func requireFolder(_ config: URL, app: String) throws {
    guard FileManager.default.fileExists(atPath: config.deletingLastPathComponent().path) else {
      throw Failure("\(app) is not set up on this Mac (no \(config.deletingLastPathComponent().path)). Open it once, then connect again.")
    }
  }

  /// Rewrites a JSON config with one change, keeping every other key, its order and its value.
  func editJSON(_ url: URL, _ change: (JSONValue) -> JSONValue) throws {
    let target = url.resolvingSymlinksInPath()
    var config: JSONValue = [:]
    if let data = try? Data(contentsOf: target), !data.allSatisfy({ [0x20, 0x0A, 0x0D, 0x09].contains($0) }) {
      guard let parsed = try? JSONValue.parse(data), parsed.pairs != nil else {
        throw Failure("\(url.path) is not plain JSON, so Screencap left it alone. Add this under mcpServers yourself: \"\(Self.serverName)\": \(entry.serialized())")
      }
      config = parsed
    }
    try write(change(config).pretty() + "\n", to: target)
  }

  /// Writes atomically and keeps the file's permissions, so a private config stays private.
  func write(_ text: String, to url: URL) throws {
    let target = url.resolvingSymlinksInPath()
    let permissions = (try? FileManager.default.attributesOfItem(atPath: target.path))?[.posixPermissions]
    try text.write(to: target, atomically: true, encoding: .utf8)
    if let permissions { try? FileManager.default.setAttributes([.posixPermissions: permissions], ofItemAtPath: target.path) }
  }

  // MARK: Codex's TOML

  /// Codex's config with the `[mcp_servers.screencap]` table set to start `executable`, or removed when it is nil.
  /// Only that table and its subtables change.
  static func codexConfig(_ text: String, executable: String?) -> String {
    var lines = text.components(separatedBy: "\n")
    if lines.last == "" { lines.removeLast() }
    var kept: [String] = []
    var inside = false
    for line in lines {
      if line.trimmingCharacters(in: .whitespaces).hasPrefix("[") { inside = isScreencapTable(line) }
      if !inside { kept.append(line) }
    }
    while kept.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { kept.removeLast() }
    if let executable {
      if !kept.isEmpty { kept.append("") }
      kept += ["[mcp_servers.\(serverName)]", "command = \(tomlString(executable))", "args = [\"mcp\"]"]
    }
    return kept.isEmpty ? "" : kept.joined(separator: "\n") + "\n"
  }

  static func isScreencapTable(_ line: String) -> Bool {
    line.trimmingCharacters(in: .whitespaces).wholeMatch(of: /\[\s*mcp_servers\s*\.\s*(screencap|"screencap")\s*(\..*)?\]\s*(#.*)?/) != nil
  }

  static func codexCommand(in text: String) -> String? {
    var inside = false
    for line in text.components(separatedBy: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("[") {
        inside = trimmed.wholeMatch(of: /\[\s*mcp_servers\s*\.\s*(screencap|"screencap")\s*\]\s*(#.*)?/) != nil
        continue
      }
      if inside, let match = trimmed.wholeMatch(of: /command\s*=\s*"((?:[^"\\]|\\.)*)"\s*(#.*)?/) {
        return String(match.1).replacingOccurrences(of: "\\\"", with: "\"").replacingOccurrences(of: "\\\\", with: "\\")
      }
    }
    return nil
  }

  static func tomlString(_ text: String) -> String {
    "\"" + text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
  }

  // MARK: Programs

  /// The `claude` command: the installer's usual places first, then whatever the person's login shell finds.
  static func locateClaude(home: URL) -> String? {
    let candidates = [
      home.appendingPathComponent(".local/bin/claude").path, home.appendingPathComponent(".claude/local/claude").path,
      "/opt/homebrew/bin/claude", "/usr/local/bin/claude",
    ]
    if let found = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) { return found }
    let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
    guard let result = try? runProcess(shell, ["-ilc", "command -v claude"]), result.status == 0 else { return nil }
    return result.output.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
      .last { $0.hasPrefix("/") && FileManager.default.isExecutableFile(atPath: $0) }
  }

  /// Runs a program with no input and returns its exit status and combined output, ending it after 30 seconds.
  public static func runProcess(_ program: String, _ arguments: [String]) throws -> (status: Int32, output: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: program)
    process.arguments = arguments
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    process.standardInput = FileHandle.nullDevice
    try process.run()
    let deadline = DispatchWorkItem { if process.isRunning { process.terminate() } }
    DispatchQueue.global().asyncAfter(deadline: .now() + 30, execute: deadline)
    let output = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    deadline.cancel()
    return (process.terminationStatus, String(decoding: output, as: UTF8.self))
  }
}
