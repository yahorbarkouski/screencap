import Foundation

/// A conversation in Claude, named by the session that was in front.
///
/// Claude keeps every conversation in one window whose title is always "Claude", often a dozen at once,
/// so a capture says only that Claude was on screen. The transcripts say which conversation: a row the person
/// typed carries a timestamp, and sessions running in the background never write one.
public struct ClaudeReader: ThingReader {
  public let sessions: ClaudeSessionIndex
  public var bundleIDs: Set<String> { [ClaudeSessionIndex.bundleID] }

  public init(sessions: ClaudeSessionIndex) {
    self.sessions = sessions
  }

  public func ref(context: ForegroundContext, at: Double) -> ThingRef? {
    guard let bundleID = context.bundleID, let session = sessions.session(at: at) else { return nil }
    let label = session.title.isEmpty ? "Untitled session" : session.title
    return ThingRef(
      key: "claude:\(session.id)", kind: .session, label: label,
      detail: session.directoryName.isEmpty ? nil : session.directoryName, bundleID: bundleID)
  }
}
