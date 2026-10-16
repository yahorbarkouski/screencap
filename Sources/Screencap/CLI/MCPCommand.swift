import Foundation
import ScreencapCore

/// `Screencap mcp`: the MCP server agents read the history through, over stdin and stdout, plus the commands that
/// connect agent apps to it.
///
///   Screencap mcp [--store DIR] [--defaults SUITE]   serve; --defaults reads settings from another defaults domain (tests)
///   Screencap mcp install|uninstall CLIENT          claude-code, claude-desktop, cursor or codex
///   Screencap mcp status                            the two switches, each client, the access log
enum MCPCommand {
  static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev" }

  static var installer: AgentInstaller {
    AgentInstaller(executable: Bundle.main.executablePath ?? CommandLine.arguments[0])
  }

  static func run(_ arguments: [String], location: StoreLocation, settings: SettingsStore) -> Never {
    let subcommand = arguments.dropFirst().first.flatMap { $0.hasPrefix("--") ? nil : $0 }
    switch subcommand {
    case nil:
      serve(location: location, settings: settings)
    case "install", "uninstall":
      guard arguments.count > 2, let client = AgentClient(rawValue: arguments[2]) else {
        fail("Name a client: \(AgentClient.allCases.map(\.rawValue).joined(separator: ", ")).")
      }
      do {
        print(subcommand == "install" ? try installer.install(client) : try installer.uninstall(client))
        if subcommand == "install", !settings.current.agents.isEnabled {
          print("Agents can read your history once you turn on Settings > Agents > Let agents read my history in Screencap.")
        }
        exit(0)
      } catch {
        fail(String(describing: error))
      }
    case "status":
      let access = settings.current.agents
      print("Agent access: \(access.isEnabled ? "on" : "off (Screencap's Settings > Agents)")")
      print("Screenshots: \(access.isEnabled && access.includesScreenshots ? "on" : "off")")
      for client in AgentClient.allCases {
        let state: String
        switch installer.status(client) {
        case .missing: state = "not installed"
        case .disconnected: state = "not connected"
        case .connected: state = "connected"
        case .connectedElsewhere(let command): state = "connected to another command: \(command)"
        }
        print("\(client.name): \(state)")
      }
      print("Access log: \(AgentAccessLog(location: location).url.path)")
      exit(0)
    default:
      fail("Unknown mcp command \(subcommand ?? ""). Use install, uninstall or status, or no command to serve.")
    }
  }

  /// One JSON-RPC message per line in, one response per line out; logs never go to stdout, which carries only
  /// protocol messages. Ends when the client closes stdin.
  static func serve(location: StoreLocation, settings: SettingsStore) -> Never {
    let server = MCPServer(location: location, access: { settings.current.agents }, version: version)
    while let line = readLine(strippingNewline: true) {
      guard !line.trimmingCharacters(in: .whitespaces).isEmpty, let response = server.handle(line) else { continue }
      FileHandle.standardOutput.write(Data((response + "\n").utf8))
    }
    exit(0)
  }

  static func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
  }
}
