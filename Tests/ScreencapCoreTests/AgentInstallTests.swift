import Foundation
import Testing

@testable import ScreencapCore

/// Each installer works on a home folder of its own, so no test touches a real agent app's configuration.
@Suite struct AgentInstallTests {
  static let binary = "/Applications/Screencap.app/Contents/MacOS/Screencap"
  static let v1Entry = #"{"command":"/usr/bin/env","args":["-u","ELECTRON_RUN_AS_NODE","/Applications/Screencap.app/Contents/MacOS/Screencap","--mcp"]}"#

  final class Calls: @unchecked Sendable {
    var list: [[String]] = []
  }

  func home() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("home-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  func write(_ text: String, _ path: String, in home: URL) throws {
    let url = home.appendingPathComponent(path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try text.write(to: url, atomically: true, encoding: .utf8)
  }

  func read(_ path: String, in home: URL) throws -> String {
    try String(contentsOf: home.appendingPathComponent(path), encoding: .utf8)
  }

  @Test func claudeDesktopGetsAnEntryAndKeepsEverythingElse() throws {
    let home = try home()
    let path = "Library/Application Support/Claude/claude_desktop_config.json"
    try write(#"{"mcpServers":{"other":{"command":"x"}},"preferences":{"sidebarMode":"chat"}}"#, path, in: home)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: home.appendingPathComponent(path).path)
    let installer = AgentInstaller(executable: Self.binary, home: home)
    #expect(installer.status(.claudeDesktop) == .disconnected)

    #expect(try installer.install(.claudeDesktop) == "Connected Claude Desktop. Quit and reopen it to load Screencap.")
    let config = try JSONValue.parse(try read(path, in: home))
    #expect(config.pairs?.map(\.0) == ["mcpServers", "preferences"])
    #expect(config["mcpServers"]?.pairs?.map(\.0) == ["other", "screencap"])
    #expect(config["mcpServers"]?["screencap"] == ["command": .string(Self.binary), "args": ["mcp"]])
    #expect(config["preferences"] == ["sidebarMode": "chat"])
    #expect(installer.status(.claudeDesktop) == .connected)
    #expect((try FileManager.default.attributesOfItem(atPath: home.appendingPathComponent(path).path)[.posixPermissions] as? Int) == 0o600)

    _ = try installer.install(.claudeDesktop)
    #expect(try read(path, in: home) == config.pretty() + "\n")

    _ = try installer.uninstall(.claudeDesktop)
    #expect(try JSONValue.parse(try read(path, in: home))["mcpServers"]?.pairs?.map(\.0) == ["other"])
  }

  @Test func cursorReplacesScreencapV1AndGetsTheSkill() throws {
    let home = try home()
    try write(#"{"mcpServers":{"context7":{"url":"https://example.com"},"screencap":\#(Self.v1Entry),"exa":{"command":"y"}}}"#, ".cursor/mcp.json", in: home)
    let installer = AgentInstaller(executable: Self.binary, home: home)
    #expect(installer.status(.cursor) == .connectedElsewhere("/usr/bin/env -u ELECTRON_RUN_AS_NODE /Applications/Screencap.app/Contents/MacOS/Screencap --mcp"))

    _ = try installer.install(.cursor)
    let config = try JSONValue.parse(try read(".cursor/mcp.json", in: home))
    #expect(config["mcpServers"]?.pairs?.map(\.0) == ["context7", "screencap", "exa"])
    #expect(installer.status(.cursor) == .connected)
    #expect(try read(".agents/skills/screencap/SKILL.md", in: home) == SkillText.markdown + "\n")

    _ = try installer.uninstall(.cursor)
    #expect(try JSONValue.parse(try read(".cursor/mcp.json", in: home))["mcpServers"]?.pairs?.map(\.0) == ["context7", "exa"])
    #expect(!FileManager.default.fileExists(atPath: home.appendingPathComponent(".agents/skills/screencap").path))
  }

  @Test func codexGetsItsTableAndOtherTablesStay() throws {
    let home = try home()
    let before = """
      model = "gpt-6"

      [mcp_servers.screencap]
      command = "/old/Screencap"
      args = ["--mcp"]

      [mcp_servers.screencap.env]
      A = "1"

      [mcp_servers.other]
      command = "other"

      """
    try write(before, ".codex/config.toml", in: home)
    let installer = AgentInstaller(executable: Self.binary, home: home)
    #expect(installer.status(.codex) == .connectedElsewhere("/old/Screencap"))

    _ = try installer.install(.codex)
    #expect(
      try read(".codex/config.toml", in: home) == """
        model = "gpt-6"

        [mcp_servers.other]
        command = "other"

        [mcp_servers.screencap]
        command = "\(Self.binary)"
        args = ["mcp"]

        """)
    #expect(installer.status(.codex) == .connected)
    #expect(FileManager.default.fileExists(atPath: home.appendingPathComponent(".agents/skills/screencap/SKILL.md").path))

    _ = try installer.uninstall(.codex)
    #expect(try read(".codex/config.toml", in: home) == "model = \"gpt-6\"\n\n[mcp_servers.other]\ncommand = \"other\"\n")
    #expect(AgentInstaller.codexCommand(in: #"[mcp_servers."screencap"]"# + "\ncommand = \"/a \\\"b\\\"\"") == "/a \"b\"")
  }

  @Test func theSharedSkillStaysWhileAnotherAppUsesIt() throws {
    let home = try home()
    try write("{}", ".cursor/mcp.json", in: home)
    try write("", ".codex/config.toml", in: home)
    let installer = AgentInstaller(executable: Self.binary, home: home)
    _ = try installer.install(.cursor)
    _ = try installer.install(.codex)
    _ = try installer.uninstall(.cursor)
    #expect(FileManager.default.fileExists(atPath: home.appendingPathComponent(".agents/skills/screencap/SKILL.md").path))
    _ = try installer.uninstall(.codex)
    #expect(!FileManager.default.fileExists(atPath: home.appendingPathComponent(".agents/skills/screencap").path))
  }

  @Test func claudeCodeGoesThroughItsOwnCommand() throws {
    let home = try home()
    try write(#"{"numStartups":3,"mcpServers":{"screencap":\#(Self.v1Entry)}}"#, ".claude.json", in: home)
    let calls = Calls()
    let installer = AgentInstaller(
      executable: Self.binary, home: home,
      run: { program, arguments in
        calls.list.append([program] + arguments)
        return (0, "Added stdio MCP server screencap")
      },
      findClaude: { "/Users/me/.local/bin/claude" })
    #expect(installer.claudeCodeCommand == "claude mcp add --scope user screencap -- /Applications/Screencap.app/Contents/MacOS/Screencap mcp")

    _ = try installer.install(.claudeCode)
    #expect(
      calls.list == [
        ["/Users/me/.local/bin/claude", "mcp", "remove", "screencap", "--scope", "user"],
        ["/Users/me/.local/bin/claude", "mcp", "add", "--scope", "user", "screencap", "--", Self.binary, "mcp"],
      ])
    #expect(try read(".claude/skills/screencap/SKILL.md", in: home) == SkillText.markdown + "\n")
    #expect(try read(".claude.json", in: home).contains("numStartups"))
  }

  @Test func aMissingAppOrUnreadableConfigIsExplained() throws {
    let home = try home()
    let installer = AgentInstaller(executable: Self.binary, home: home, findClaude: { nil })
    #expect(installer.status(.claudeCode) == .missing)
    #expect(installer.status(.cursor) == .missing)
    #expect(throws: AgentInstaller.Failure.self) { try installer.install(.cursor) }
    try write("{ // a comment\n}", ".cursor/mcp.json", in: home)
    #expect(throws: AgentInstaller.Failure.self) { try installer.install(.cursor) }
    #expect(try read(".cursor/mcp.json", in: home) == "{ // a comment\n}")
    #expect(AgentInstaller(executable: "/Applications/My Apps/Screencap.app/Contents/MacOS/Screencap", home: home).claudeCodeCommand.hasSuffix("-- '/Applications/My Apps/Screencap.app/Contents/MacOS/Screencap' mcp"))
  }

  @Test func theBinaryCarriesTheRepositorysSkill() throws {
    let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let file = try String(contentsOf: repo.appendingPathComponent("skills/screencap/SKILL.md"), encoding: .utf8)
    #expect(file == SkillText.markdown + "\n", "skills/screencap/SKILL.md and SkillText.swift differ; copy the file into SkillText.markdown")
    #expect(SkillText.markdown.hasPrefix("---\nname: screencap\ndescription: \""))
  }
}
