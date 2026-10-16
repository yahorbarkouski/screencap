import Foundation
import Testing

@testable import ScreencapCore

@Suite struct MCPServerTests {
  /// The person's switches as a test flips them.
  final class Switches {
    var value: AgentSettings
    init(_ value: AgentSettings) { self.value = value }
  }

  struct Session {
    let fixture: AgentFixture
    let switches: Switches
    let server: MCPServer
    var log: AgentAccessLog { AgentAccessLog(location: fixture.location) }

    init(access: AgentSettings) throws {
      fixture = try AgentFixture()
      let switches = Switches(access)
      self.switches = switches
      let now = fixture.at("2026-10-15 15:00")
      server = MCPServer(location: fixture.location, access: { switches.value }, version: "1.2.3", time: fixture.time, now: { now })
    }

    func send(_ message: JSONValue) throws -> JSONValue {
      try JSONValue.parse(try #require(server.handle(message.serialized())))
    }

    func call(_ tool: String, _ arguments: JSONValue = [:], meta: JSONValue? = nil) throws -> JSONValue {
      var params: JSONValue = ["name": .string(tool), "arguments": arguments]
      if let meta { params = params.setting("_meta", to: meta) }
      return try #require(try send(["jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": params])["result"])
    }
  }

  static let modernMeta: JSONValue = [
    "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": [:],
    "io.modelcontextprotocol/clientInfo": ["name": "cursor-vscode", "version": "2.0"],
  ]

  @Test func legacyClientsInitializeThenCall() throws {
    let s = try Session(access: AgentSettings(isEnabled: true))
    let initialize = try s.send([
      "jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": ["protocolVersion": "2025-06-18", "capabilities": [:], "clientInfo": ["name": "claude-code", "version": "2.1"]],
    ])
    #expect(initialize["id"] == 1)
    #expect(initialize["result"]?["protocolVersion"] == "2025-06-18")
    #expect(initialize["result"]?["serverInfo"] == ["name": "screencap", "title": "Screencap", "version": "1.2.3"])
    #expect(initialize["result"]?["instructions"]?.string?.contains("America/Los_Angeles (UTC-07:00)") == true)
    #expect(s.server.handle(#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#) == nil)
    #expect(try s.send(["jsonrpc": "2.0", "id": "p", "method": "ping"])["result"] == [:])

    let tools = try #require(try s.send(["jsonrpc": "2.0", "id": 2, "method": "tools/list"])["result"]?["tools"]?.array)
    #expect(tools.map { $0["name"] } == ["search", "day", "threads", "thread", "activity", "now", "screenshot"])
    #expect(tools.allSatisfy { $0["annotations"]?["readOnlyHint"] == true && $0["annotations"]?["openWorldHint"] == false })
    #expect(tools.allSatisfy { $0["inputSchema"]?["type"] == "object" && $0["outputSchema"]?["type"] == "object" })

    let result = try s.call("day", ["date": "2026-10-14"])
    #expect(result["isError"] == nil)
    #expect(result["resultType"] == nil)
    let text = try #require(result["content"]?.array?.first?["text"]?.string)
    #expect(try JSONValue.parse(text) == result["structuredContent"])
    #expect(result["structuredContent"]?["date"] == "2026-10-14")
    #expect(s.log.recent(1) == [.init(at: s.fixture.at("2026-10-15 15:00"), client: "Claude Code", tool: "day", summary: "day 2026-10-14 · 1 activities", allowed: true)])

    let unknownVersion = try s.send(["jsonrpc": "2.0", "id": 3, "method": "initialize", "params": ["protocolVersion": "2099-01-01"]])
    #expect(unknownVersion["result"]?["protocolVersion"] == "2025-11-25")
  }

  @Test func modernRequestsCarryTheirVersion() throws {
    let s = try Session(access: AgentSettings(isEnabled: true))
    let discover = try s.send(["jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": ["_meta": Self.modernMeta]])
    #expect(discover["result"]?["supportedVersions"] == ["2026-07-28"])
    #expect(discover["result"]?["capabilities"] == ["tools": [:], "prompts": [:]])
    #expect(discover["result"]?["ttlMs"] == 3_600_000 && discover["result"]?["cacheScope"] == "public")
    #expect(discover["result"]?["_meta"]?["io.modelcontextprotocol/serverInfo"]?["name"] == "screencap")

    let list = try s.send(["jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": ["_meta": Self.modernMeta]])
    #expect(list["result"]?["resultType"] == "complete" && list["result"]?["cacheScope"] == "public")

    let result = try s.call("now", meta: Self.modernMeta)
    #expect(result["resultType"] == "complete")
    #expect(result["_meta"]?["io.modelcontextprotocol/serverInfo"]?["version"] == "1.2.3")
    #expect(s.log.recent(1).first?.client == "Cursor")

    let old = try s.send([
      "jsonrpc": "2.0", "id": 3, "method": "tools/list",
      "params": ["_meta": Self.modernMeta.setting("io.modelcontextprotocol/protocolVersion", to: "2030-01-01")],
    ])
    #expect(old["error"]?["code"] == -32022)
    #expect(old["error"]?["data"]?["requested"] == "2030-01-01")
    #expect(old["error"]?["data"]?["supported"]?.array?.contains("2025-11-25") == true)
    let noCapabilities = try s.send([
      "jsonrpc": "2.0", "id": 4, "method": "tools/list",
      "params": ["_meta": ["io.modelcontextprotocol/protocolVersion": "2026-07-28"]],
    ])
    #expect(noCapabilities["error"]?["code"] == -32602)
  }

  @Test func promptsWordARequestWithoutReadingTheHistory() throws {
    let s = try Session(access: AgentSettings())
    let initialize = try s.send(["jsonrpc": "2.0", "id": 1, "method": "initialize", "params": ["protocolVersion": "2025-11-25"]])
    #expect(initialize["result"]?["capabilities"]?["prompts"] == ["listChanged": false])

    let prompts = try #require(try s.send(["jsonrpc": "2.0", "id": 2, "method": "prompts/list"])["result"]?["prompts"]?.array)
    #expect(prompts.map { $0["name"] } == ["standup", "recap", "resume"])
    #expect(prompts[0]["arguments"] == nil)
    #expect(prompts[2]["arguments"] == [["name": "topic", "description": "The project, task or subject, in a few words.", "required": true]])

    let resume = try s.send([
      "jsonrpc": "2.0", "id": 3, "method": "prompts/get", "params": ["name": "resume", "arguments": ["topic": " Kyoto trip "]],
    ])
    let message = try #require(resume["result"]?["messages"]?.array?.first)
    #expect(message["role"] == "user")
    #expect(message["content"]?["text"]?.string?.hasPrefix("Help me pick up where I left off on Kyoto trip. ") == true)
    let recap = try s.send(["jsonrpc": "2.0", "id": 4, "method": "prompts/get", "params": ["name": "recap"]])
    #expect(recap["result"]?["messages"]?.array?.first?["content"]?["text"]?.string?.hasPrefix("Recap my day today ") == true)
    #expect(s.log.recent(1).isEmpty)

    let missing = try s.send(["jsonrpc": "2.0", "id": 5, "method": "prompts/get", "params": ["name": "resume", "arguments": ["topic": ""]]])
    #expect(missing["error"]?["code"] == -32602)
    #expect(missing["error"]?["message"] == "Invalid params: resume needs topic.")
    let unknown = try s.send(["jsonrpc": "2.0", "id": 6, "method": "prompts/get", "params": ["name": "delete"]])
    #expect(unknown["error"]?["message"] == "Invalid params: unknown prompt delete.")
    let extra = try s.send(["jsonrpc": "2.0", "id": 7, "method": "prompts/get", "params": ["name": "standup", "arguments": ["team": "x"]]])
    #expect(extra["error"]?["message"] == "Invalid params: standup has no argument team. It takes no arguments.")
  }

  @Test func accessOffRefusesEveryCallAndLogsIt() throws {
    let s = try Session(access: AgentSettings())
    let result = try s.call("search", ["query": "torii"])
    #expect(result["isError"] == true)
    #expect(result["content"]?.array?.first?["text"]?.string == MCPServer.accessOff)
    #expect(result["structuredContent"] == nil)
    #expect(s.log.recent(1).first?.allowed == false)
    #expect(s.log.recent(1).first?.summary == "search refused: agent access is off")

    s.switches.value.isEnabled = true
    #expect(try s.call("search", ["query": "torii"])["isError"] == nil)
  }

  @Test func screenshotsHaveTheirOwnSwitch() throws {
    let s = try Session(access: AgentSettings(isEnabled: true))
    let refused = try s.call("screenshot", ["at": "2026-10-14 10:05"])
    #expect(refused["content"]?.array?.first?["text"]?.string == MCPServer.screenshotsOff)

    s.switches.value.includesScreenshots = true
    let content = try #require(try s.call("screenshot", ["at": "2026-10-14 10:05"])["content"]?.array)
    #expect(content.map { $0["type"] } == ["text", "image"])
    #expect(content[1]["mimeType"] == "image/jpeg")
    #expect(Data(base64Encoded: content[1]["data"]?.string ?? "")?.prefix(2) == Data([0xFF, 0xD8]))
    #expect(s.log.recent(1).first?.summary == "screenshot 2026-10-14 10:00:00 (Safari)")
  }

  @Test func mistakesTheAgentCanFixAreToolErrors() throws {
    let s = try Session(access: AgentSettings(isEnabled: true))
    let badDate = try s.call("day", ["date": "Tuesday"])
    #expect(badDate["isError"] == true)
    #expect(badDate["content"]?.array?.first?["text"] == "Could not read date “Tuesday”. Use today, yesterday or YYYY-MM-DD.")
    #expect(try s.call("now", ["verbose": true])["isError"] == true)

    let unknownTool = try s.send(["jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": ["name": "delete", "arguments": [:]]])
    #expect(unknownTool["error"]?["code"] == -32602)
    #expect(try s.send(["jsonrpc": "2.0", "id": 10, "method": "resources/list"])["error"]?["code"] == -32601)
    #expect(try JSONValue.parse(s.server.handle("{not json")!)["error"]?["code"] == -32700)
    #expect(s.server.handle(#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}}"#) == nil)
  }

  @Test func aMissingStoreSaysToOpenScreencap() throws {
    let location = StoreLocation(root: FileManager.default.temporaryDirectory.appendingPathComponent("absent-\(UUID().uuidString)"))
    let server = MCPServer(location: location, access: { AgentSettings(isEnabled: true) }, version: "1")
    let reply = try JSONValue.parse(server.handle(#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"now"}}"#)!)
    #expect(reply["result"]?["isError"] == true)
    #expect(reply["result"]?["content"]?.array?.first?["text"]?.string?.hasPrefix("Screencap has no history on this Mac yet.") == true)
    #expect(!FileManager.default.fileExists(atPath: location.root.path))
  }

  @Test func clientNamesReadAsPeopleKnowThem() {
    #expect(AgentAccessLog.clientLabel("claude-code") == "Claude Code")
    #expect(AgentAccessLog.clientLabel("claude-ai") == "Claude")
    #expect(AgentAccessLog.clientLabel("cursor-vscode") == "Cursor")
    #expect(AgentAccessLog.clientLabel("codex-mcp-client") == "Codex")
    #expect(AgentAccessLog.clientLabel("Visual Studio Code") == "VS Code")
    #expect(AgentAccessLog.clientLabel("my-agent") == "my-agent")
    #expect(AgentAccessLog.clientLabel(nil) == "An agent")
  }

  @Test func theLogKeepsItsLatestLinesPastItsLimit() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("log-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let log = AgentAccessLog(location: StoreLocation(root: root))
    let padding = String(repeating: "x", count: 400)
    for i in 0..<2600 { log.append(.init(at: Double(i), client: "Codex", tool: "search", summary: padding, allowed: true)) }
    let lines = try String(contentsOf: log.url, encoding: .utf8).split(separator: "\n")
    #expect(lines.count <= AgentAccessLog.keptLines + 600)
    #expect(log.recent(1).first?.at == 2599)
    log.clear()
    #expect(log.recent(5).isEmpty)
  }
}

@Suite struct JSONParsingTests {
  @Test func parsesWhatItWritesWithKeysInOrder() throws {
    let text = #"{"b":1,"a":[true,false,null,-2.5,1e3],"s":"tab\tquote\" slash\/ é é 😀","o":{}}"#
    let value = try JSONValue.parse(text)
    #expect(value.pairs?.map(\.0) == ["b", "a", "s", "o"])
    #expect(value["s"] == "tab\tquote\" slash/ é é 😀")
    #expect(value["a"] == [true, false, .null, -2.5, 1000])
    #expect(try JSONValue.parse(value.serialized()) == value)
    #expect(try JSONValue.parse(value.pretty()) == value)
    let small: JSONValue = ["x": [1, 2]]
    #expect(small.pretty() == "{\n  \"x\": [\n    1,\n    2\n  ]\n}")
  }

  @Test func rejectsWhatIsNotJSON() {
    for bad in ["", "{", "[1,]", "{\"a\" 1}", "tru", "\"unterminated", "{} trailing", "\"\u{01}\""] {
      #expect(throws: JSONValue.ParseError.self) { try JSONValue.parse(bad) }
    }
    #expect(throws: JSONValue.ParseError.tooDeep) { try JSONValue.parse(String(repeating: "[", count: 400)) }
  }

  @Test func settingKeepsOtherKeysInPlace() {
    let config: JSONValue = ["a": 1, "b": 2, "c": 3]
    #expect(config.setting("b", to: 9) == ["a": 1, "b": 9, "c": 3])
    #expect(config.setting("b", to: nil) == ["a": 1, "c": 3])
    #expect(config.setting("d", to: 4) == ["a": 1, "b": 2, "c": 3, "d": 4])
  }
}
