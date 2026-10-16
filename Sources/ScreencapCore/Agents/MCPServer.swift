import Foundation

/// Answers MCP messages for one `Screencap mcp` process, one JSON-RPC message per line.
///
/// It speaks both eras of the protocol. A request whose `_meta` carries `io.modelcontextprotocol/protocolVersion`
/// (revision 2026-07-28) is served on its own, with no handshake. A client on 2025-11-25 or older opens with
/// `initialize`, and the process then serves it that way. Every tool call first checks the person's settings, then
/// reads the store read-only, then appends a line to the access log.
public final class MCPServer {
  public static let modernVersions = ["2026-07-28"]
  public static let legacyVersions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
  static let metaPrefix = "io.modelcontextprotocol/"
  /// How long clients may cache the server's description and tool list: they change only with the app.
  static let cacheMilliseconds = 3_600_000

  let location: StoreLocation
  /// The person's two switches, read on every call so a change in Settings applies to the next one.
  let access: () -> AgentSettings
  let log: AgentAccessLog
  let time: AgentTime
  let now: @Sendable () -> Double
  let version: String
  private var tools: AgentTools?
  /// The client that opened this process with `initialize`, for the access log.
  private var legacyClient: String?

  public init(
    location: StoreLocation, access: @escaping () -> AgentSettings, version: String, time: AgentTime = AgentTime(),
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 }
  ) {
    self.location = location
    self.access = access
    self.log = AgentAccessLog(location: location)
    self.time = time
    self.now = now
    self.version = version
  }

  struct RPCError: Error {
    var code: Int
    var message: String
    var data: JSONValue?
  }

  /// The response to one message, or nil for a notification (and for a response a client sends, which this server
  /// never asks for).
  public func handle(_ line: String) -> String? {
    guard let message = try? JSONValue.parse(line), message.pairs != nil else {
      return Self.errorLine(id: .null, RPCError(code: -32700, message: "Parse error: send one JSON-RPC object per line."))
    }
    guard let method = message["method"]?.string else {
      return message["id"] == nil ? nil : Self.errorLine(id: message["id"]!, RPCError(code: -32600, message: "Invalid request: no method."))
    }
    guard let id = message["id"] else { return nil }
    do {
      return "{\"jsonrpc\":\"2.0\",\"id\":\(id.serialized()),\"result\":\(try respond(method, params: message["params"] ?? [:]).serialized())}"
    } catch let error as RPCError {
      return Self.errorLine(id: id, error)
    } catch {
      return Self.errorLine(id: id, RPCError(code: -32603, message: "Internal error: \(error)"))
    }
  }

  func respond(_ method: String, params: JSONValue) throws -> JSONValue {
    let meta = params["_meta"]
    let modern = meta?[Self.metaPrefix + "protocolVersion"]?.string
    if let modern {
      guard Self.modernVersions.contains(modern) else {
        throw RPCError(
          code: -32022, message: "Unsupported protocol version",
          data: ["supported": .array((Self.modernVersions + Self.legacyVersions).map(JSONValue.string)), "requested": .string(modern)])
      }
      guard meta?[Self.metaPrefix + "clientCapabilities"] != nil else {
        throw RPCError(code: -32602, message: "Invalid params: _meta needs \(Self.metaPrefix)clientCapabilities.")
      }
    }
    let client = modern != nil ? meta?[Self.metaPrefix + "clientInfo"]?["name"]?.string : legacyClient

    let result: JSONValue
    switch method {
    case "initialize":
      legacyClient = params["clientInfo"]?["name"]?.string
      let requested = params["protocolVersion"]?.string ?? ""
      return [
        "protocolVersion": .string(Self.legacyVersions.contains(requested) ? requested : Self.legacyVersions[0]),
        "capabilities": ["tools": ["listChanged": false], "prompts": ["listChanged": false]],
        "serverInfo": serverInfo,
        "instructions": .string(instructions),
      ]
    case "server/discover":
      guard modern != nil else {
        throw RPCError(code: -32602, message: "Invalid params: server/discover needs \(Self.metaPrefix)protocolVersion in _meta.")
      }
      return [
        "resultType": "complete",
        "supportedVersions": .array(Self.modernVersions.map(JSONValue.string)),
        "capabilities": ["tools": [:], "prompts": [:]],
        "instructions": .string(instructions),
        "ttlMs": .number(Double(Self.cacheMilliseconds)),
        "cacheScope": "public",
        "_meta": [Self.metaPrefix + "serverInfo": serverInfo],
      ]
    case "ping":
      result = [:]
    case "tools/list":
      var list: JSONValue = ["tools": .array(AgentTools.definitions.map(\.json))]
      if modern != nil {
        list = list.setting("ttlMs", to: .number(Double(Self.cacheMilliseconds))).setting("cacheScope", to: "public")
      }
      result = list
    case "tools/call":
      result = try call(params, client: AgentAccessLog.clientLabel(client))
    case "prompts/list":
      var list: JSONValue = ["prompts": .array(AgentPrompt.all.map(\.json))]
      if modern != nil {
        list = list.setting("ttlMs", to: .number(Double(Self.cacheMilliseconds))).setting("cacheScope", to: "public")
      }
      result = list
    case "prompts/get":
      guard let name = params["name"]?.string, let prompt = AgentPrompt.all.first(where: { $0.name == name }) else {
        throw RPCError(code: -32602, message: "Invalid params: unknown prompt \(params["name"]?.string ?? "(none)").")
      }
      do {
        result = try prompt.messages(params["arguments"])
      } catch let problem as AgentTools.Problem {
        throw RPCError(code: -32602, message: "Invalid params: \(problem.message)")
      }
    default:
      throw RPCError(code: -32601, message: "Method not found: \(method)")
    }
    guard modern != nil else { return result }
    return result.setting("resultType", to: "complete").setting("_meta", to: [Self.metaPrefix + "serverInfo": serverInfo])
  }

  var serverInfo: JSONValue { ["name": "screencap", "title": "Screencap", "version": .string(version)] }

  var instructions: String { AgentTools.instructions(zone: time.zoneName(at: now())) }

  static let accessOff =
    "The person has not let agents read their Screencap history. They can turn it on in Screencap's Settings (right-click the menu-bar icon, then Settings, then Agents: \"Let agents read my history\"). Tell them; do not retry until they have."
  static let screenshotsOff =
    "The person has not let agents see screenshots. The text tools still work. They can allow screenshots in Screencap's Settings (right-click the menu-bar icon, then Settings, then Agents: \"Include screenshots\")."

  func call(_ params: JSONValue, client: String) throws -> JSONValue {
    guard let name = params["name"]?.string else { throw RPCError(code: -32602, message: "Invalid params: tools/call needs a tool name.") }
    guard AgentTools.definitions.contains(where: { $0.name == name }) else {
      throw RPCError(code: -32602, message: "Unknown tool: \(name)")
    }
    let access = access()
    func refuse(_ message: String, _ reason: String) -> JSONValue {
      log.append(.init(at: now(), client: client, tool: name, summary: "\(name) refused: \(reason)", allowed: false))
      return Self.errorResult(message)
    }
    guard access.isEnabled else { return refuse(Self.accessOff, "agent access is off") }
    if name == "screenshot", !access.includesScreenshots { return refuse(Self.screenshotsOff, "screenshots are off") }

    do {
      let output = try openTools().call(name, arguments: params["arguments"] ?? .null)
      log.append(.init(at: now(), client: client, tool: name, summary: output.summary, allowed: true))
      var content: [JSONValue] = [["type": "text", "text": .string(output.structured.serialized())]]
      if let image = output.image {
        content.append(["type": "image", "data": .string(image.data.base64EncodedString()), "mimeType": .string(image.mimeType)])
      }
      return ["content": .array(content), "structuredContent": output.structured]
    } catch let problem as AgentTools.Problem {
      log.append(.init(at: now(), client: client, tool: name, summary: "\(name) failed: \(problem.message)", allowed: true))
      return Self.errorResult(problem.message)
    } catch is AppDatabase.StoreNeedsUpdate {
      return Self.errorResult(
        "Screencap's history needs an update that the app makes when it opens. Ask the person to open Screencap once, then try again.")
    }
  }

  /// The tools over the store, opened on the first call that needs them, so a client can list tools before Screencap
  /// has ever run.
  func openTools() throws -> AgentTools {
    if let tools { return tools }
    guard FileManager.default.fileExists(atPath: location.databaseURL.path) else {
      throw AgentTools.Problem("Screencap has no history on this Mac yet. It starts recording once the person opens the app.")
    }
    let opened = AgentTools(
      database: try AppDatabase(readingAt: location.databaseURL.path), location: location, time: time, now: now)
    tools = opened
    return opened
  }

  static func errorResult(_ message: String) -> JSONValue {
    ["content": [["type": "text", "text": .string(message)]], "isError": true]
  }

  static func errorLine(id: JSONValue, _ error: RPCError) -> String {
    let body = JSONValue.fields([("code", .number(Double(error.code))), ("message", .string(error.message)), ("data", error.data)])
    return "{\"jsonrpc\":\"2.0\",\"id\":\(id.serialized()),\"error\":\(body.serialized())}"
  }
}
