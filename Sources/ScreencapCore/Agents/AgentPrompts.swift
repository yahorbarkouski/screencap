import Foundation

/// Ready-made requests a client offers the person as commands (Claude Code lists them as `/mcp__screencap__standup`
/// and so on). Each one only words a request; the agent then answers it with the tools, so getting a prompt reads
/// nothing from the history.
public struct AgentPrompt: Sendable {
  public struct Argument: Sendable {
    public var name: String
    public var description: String
    public var required: Bool
  }

  public var name: String
  public var title: String
  public var description: String
  public var arguments: [Argument]
  /// The request, from the arguments the person gave (only those they gave, trimmed and non-empty).
  let text: @Sendable ([String: String]) -> String

  public var json: JSONValue {
    .fields([
      ("name", .string(name)),
      ("title", .string(title)),
      ("description", .string(description)),
      (
        "arguments",
        arguments.isEmpty
          ? nil
          : .array(
            arguments.map { ["name": .string($0.name), "description": .string($0.description), "required": .bool($0.required)] })
      ),
    ])
  }

  /// The prompt filled in, or the problem with the arguments.
  public func messages(_ json: JSONValue?) throws -> JSONValue {
    var given: [String: String] = [:]
    for (key, value) in json?.pairs ?? [] {
      guard arguments.contains(where: { $0.name == key }) else {
        let takes = arguments.isEmpty ? "no arguments" : arguments.map(\.name).joined(separator: ", ")
        throw AgentTools.Problem("\(name) has no argument \(key). It takes \(takes).")
      }
      if let text = value.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty { given[key] = text }
    }
    if let missing = arguments.first(where: { $0.required && given[$0.name] == nil }) {
      throw AgentTools.Problem("\(name) needs \(missing.name).")
    }
    return [
      "description": .string(description),
      "messages": [["role": "user", "content": ["type": "text", "text": .string(text(given))]]],
    ]
  }

  public static let all: [AgentPrompt] = [
    AgentPrompt(
      name: "standup", title: "Standup from my screen history",
      description: "Write a standup from what you did on your last working day and so far today.",
      arguments: [],
      text: { _ in
        """
        Write my standup from my Screencap history. Call `day` for today and for yesterday; if yesterday has no \
        work, follow `previous_day` back to the last day that does. For each of the two days give three to six \
        bullets on the work itself, grouped by thread, leaving out leisure and chores. Open an `activity` only when a \
        title is too vague to say what was done. End with anything that looks unfinished.
        """
      }),
    AgentPrompt(
      name: "recap", title: "Recap of a day",
      description: "Tell the story of one day: what you worked on, where the time went, and what was left open.",
      arguments: [Argument(name: "date", description: "today, yesterday or YYYY-MM-DD; today when left out.", required: false)],
      text: { args in
        """
        Recap my day \(args["date"] ?? "today") from my Screencap history. Call `day` with that date. Tell it in a few \
        short paragraphs in time order: the main threads and how long each took, what I got done, what I read or \
        decided that matters, and what I left open. Then list the top places by time. Open an `activity` only where \
        a title leaves the work unclear.
        """
      }),
    AgentPrompt(
      name: "resume", title: "Pick up where I left off",
      description: "Find where you stopped on a project or topic and what to do next.",
      arguments: [Argument(name: "topic", description: "The project, task or subject, in a few words.", required: true)],
      text: { args in
        """
        Help me pick up where I left off on \(args["topic"]!). Find it in my Screencap history: call `threads` with a \
        query of its name or subject; if no thread fits, `search` words that would have been on screen. Read the \
        thread with `thread`, then open its latest activity or two with `activity`. Tell me when I last worked on it, \
        where I stopped (the page, file or message that was open), what was decided or still open, and the most \
        likely next step.
        """
      }),
  ]
}
