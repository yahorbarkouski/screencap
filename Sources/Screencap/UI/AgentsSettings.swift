import AppKit
import ScreencapCore
import SwiftUI

/// Settings' Agents section: whether agents may read the history and see screenshots, connecting agent apps, and
/// which agent read what lately.
struct AgentsSection: View {
  @Binding var access: AgentSettings
  let location: StoreLocation
  @State private var statuses: [AgentClient: AgentInstaller.Status] = [:]
  @State private var working: AgentClient?
  @State private var message: String?
  @State private var reads: [AgentAccessLog.Entry] = []
  @State private var copied = false

  private var installer: AgentInstaller { MCPCommand.installer }
  private var log: AgentAccessLog { AgentAccessLog(location: location) }

  var body: some View {
    Section("Agents") {
      Toggle("Let agents read my history", isOn: $access.isEnabled)
      Toggle("Include screenshots", isOn: $access.includesScreenshots)
        .disabled(!access.isEnabled)
      Text(
        "Connected agents, such as Claude Code or Cursor, can search what was on your screen and read your days and threads when you ask them something. They send what they read to their own AI provider, and they cannot change anything in Screencap."
      )
      .font(.caption).foregroundStyle(.secondary)
      ForEach(AgentClient.allCases) { client in row(client) }
      LabeledContent("Claude Code by hand") {
        HStack {
          Text(installer.claudeCodeCommand)
            .font(.caption.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
          Button(copied ? "Copied" : "Copy") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(installer.claudeCodeCommand, forType: .string)
            copied = true
          }
        }
      }
      if let message { Text(message).font(.caption).foregroundStyle(.secondary) }
      if !reads.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Text("Recent reads").font(.caption.weight(.semibold))
            Spacer()
            Button("Clear") {
              log.clear()
              reads = []
            }
            .buttonStyle(.link).font(.caption)
          }
          ForEach(Array(reads.enumerated()), id: \.offset) { _, entry in
            HStack(alignment: .firstTextBaseline, spacing: 6) {
              Text(Self.when(entry.at)).monospacedDigit().foregroundStyle(.secondary)
              Text(entry.client).fontWeight(.medium)
              Text(entry.summary).foregroundStyle(entry.allowed ? .secondary : Color.orange).lineLimit(1).truncationMode(.tail)
            }
            .font(.caption)
          }
        }
      }
    }
    .task { await refreshStatuses() }
    .task {
      while !Task.isCancelled {
        reads = log.recent(8)
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  @ViewBuilder func row(_ client: AgentClient) -> some View {
    let status = statuses[client]
    LabeledContent(client.name) {
      HStack {
        Text(Self.label(status)).font(.caption).foregroundStyle(.secondary)
        Button(working == client ? "Working…" : status == .connected ? "Disconnect" : "Connect") { toggle(client, connected: status == .connected) }
          .disabled(working != nil || status == nil || status == .missing)
      }
    }
  }

  static func label(_ status: AgentInstaller.Status?) -> String {
    switch status {
    case nil: "Checking…"
    case .missing: "Not installed"
    case .disconnected: "Not connected"
    case .connected: "Connected"
    case .connectedElsewhere: "Set to another Screencap"
    }
  }

  static func when(_ at: Double) -> String {
    let date = Date(timeIntervalSince1970: at)
    return Calendar.current.isDateInToday(date)
      ? date.formatted(date: .omitted, time: .shortened) : date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
  }

  func toggle(_ client: AgentClient, connected: Bool) {
    working = client
    let installer = self.installer
    Task {
      let result = await Task.detached { () -> String in
        do { return connected ? try installer.uninstall(client) : try installer.install(client) } catch { return String(describing: error) }
      }.value
      message = result
      working = nil
      await refreshStatuses()
    }
  }

  /// Looking for Claude Code can start a login shell, so statuses are read off the main thread.
  func refreshStatuses() async {
    let installer = self.installer
    let found = await Task.detached {
      Dictionary(uniqueKeysWithValues: AgentClient.allCases.map { ($0, installer.status($0)) })
    }.value
    statuses = found
  }
}
