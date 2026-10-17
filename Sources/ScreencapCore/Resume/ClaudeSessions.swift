import Foundation

/// One Claude conversation, as its transcript on disk describes it.
public struct ClaudeSession: Sendable, Hashable {
  public var id: String
  /// The name shown in Claude's sidebar, from the transcript's latest `custom-title` row.
  public var title: String
  /// The folder the session works in, from its own rows; empty for a session that never recorded one.
  public var directory: String
  /// Where the session runs. Only `claude-desktop` sessions appear in the app's sidebar, so only those can be
  /// selected by clicking; the rest are still worth binding, to name what was in front.
  public var entrypoint: String?
  /// Moments the person sent a message, oldest first. Typing is the only proof that a session had the keys: every
  /// other kind of row is written by sessions running in the background too.
  public var promptTimes: [Double]
  public var lastPromptAt: Double

  public var isDesktop: Bool { entrypoint == "claude-desktop" }

  /// A short name for the folder, for the second line of a row.
  public var directoryName: String {
    let name = URL(fileURLWithPath: directory).lastPathComponent
    return name == "/" ? "" : name
  }
}

/// Which Claude session was in front at a given moment, read from the transcripts under `~/.claude/projects`.
///
/// Claude keeps every conversation in one window whose title is always "Claude", so a capture's window title says
/// nothing about which of them was on screen, and the app often holds a dozen at once. The transcripts do say:
/// a row the person typed carries a timestamp, and the session they typed into is the one that was in front. The
/// session holding a moment is therefore the one whose last human message came closest before it.
public struct ClaudeSessionIndex: Sendable {
  public static let bundleID = "com.anthropic.claudefordesktop"

  /// Sessions with at least one human message, newest prompt last.
  public let sessions: [ClaudeSession]
  /// Prompt moments paired with their session, sorted, so a lookup is one binary search.
  private let timeline: [(at: Double, session: Int)]
  /// How long after a prompt its session still counts as the one in front. Reading without typing is common, so
  /// this is generous; it exists to stop a moment after a long break being credited to last night's work.
  public let staleAfter: Double

  public static var defaultRoot: URL {
    URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true).appending(path: ".claude/projects", directoryHint: .isDirectory)
  }

  public init(sessions: [ClaudeSession], staleAfter: Double = 4 * 3_600) {
    self.sessions = sessions
    self.staleAfter = staleAfter
    var timeline: [(at: Double, session: Int)] = []
    for (index, session) in sessions.enumerated() {
      for at in session.promptTimes { timeline.append((at, index)) }
    }
    self.timeline = timeline.sorted { $0.at < $1.at }
  }

  /// The session in front at `at`, or nil when nobody had typed into one recently enough.
  public func session(at moment: Double) -> ClaudeSession? {
    guard !timeline.isEmpty else { return nil }
    var low = 0
    var high = timeline.count - 1
    var found = -1
    while low <= high {
      let mid = (low + high) / 2
      if timeline[mid].at <= moment {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    guard found >= 0, moment - timeline[found].at <= staleAfter else { return nil }
    return sessions[timeline[found].session]
  }

  public func session(id: String) -> ClaudeSession? { sessions.first { $0.id == id } }

  /// Reads every transcript under `root` touched since `since`, skipping subagent transcripts (they are written by
  /// agents, not by the person, and never appear in the sidebar).
  ///
  /// Only two kinds of row are parsed, picked out by a byte match before any JSON is decoded: a transcript holds
  /// thousands of rows and all but a few hundred are of no use here. Even so, reading them all takes seconds, so
  /// `cache` keeps what was read, keyed by each file's size and modification time: a transcript is parsed again
  /// only after it has been written to.
  public static func build(root: URL = defaultRoot, since: Double = 0, cache: URL? = nil) -> ClaudeSessionIndex {
    let manager = FileManager.default
    guard let folders = try? manager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else {
      return ClaudeSessionIndex(sessions: [])
    }
    let stored = cache.flatMap { SessionCache.read(from: $0) } ?? SessionCache()
    var fresh = SessionCache()
    var sessions: [ClaudeSession] = []
    for folder in folders {
      guard let files = try? manager.contentsOfDirectory(
        at: folder, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey])
      else { continue }
      for file in files where file.pathExtension == "jsonl" {
        guard let values = try? file.resourceValues(forKeys: [
          .contentModificationDateKey, .fileSizeKey, .isRegularFileKey,
        ]), values.isRegularFile == true
        else { continue }
        let modified = values.contentModificationDate?.timeIntervalSince1970 ?? 0
        let size = values.fileSize ?? 0
        let path = file.path
        let cached = stored.files[path].flatMap { $0.modified == modified && $0.size == size ? $0 : nil }
        if modified < since {
          // Out of this pass, still on disk: what was read of it stays cached. Dropping it here would leave the next
          // full pass to read two hundred transcripts again, which is twenty seconds of CPU.
          if let cached { fresh.files[path] = cached }
          continue
        }
        if let cached {
          fresh.files[path] = cached
          sessions.append(cached.session())
          continue
        }
        guard let session = read(file: file) else { continue }
        fresh.files[path] = SessionCache.Entry(session, modified: modified, size: size)
        sessions.append(session)
      }
    }
    if let cache, fresh.files != stored.files { fresh.write(to: cache) }
    return ClaudeSessionIndex(sessions: sessions.sorted { $0.lastPromptAt < $1.lastPromptAt })
  }

  static let promptMarker = Data("\"type\":\"user\"".utf8)
  static let titleMarker = Data("\"type\":\"custom-title\"".utf8)

  /// One transcript's session, or nil when nobody ever typed into it.
  static func read(file: URL) -> ClaudeSession? {
    guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return nil }
    var times: [Double] = []
    var title: String?
    var directory = ""
    var entrypoint: String?
    for line in data.split(separator: UInt8(ascii: "\n")) {
      let slice = Data(line)
      let isPrompt = slice.range(of: promptMarker) != nil
      guard isPrompt || slice.range(of: titleMarker) != nil else { continue }
      guard let row = try? JSONSerialization.jsonObject(with: slice) as? [String: Any] else { continue }
      switch row["type"] as? String {
      case "custom-title":
        if let value = row["customTitle"] as? String, !value.isEmpty { title = value }
      case "user":
        // Rows a subagent or a tool wrote are not someone typing, and say nothing about what was on screen.
        guard row["isSidechain"] as? Bool != true else { continue }
        if let origin = row["origin"] as? [String: Any], let kind = origin["kind"] as? String, kind != "human" { continue }
        guard let stamp = row["timestamp"] as? String, let at = moment(stamp) else { continue }
        // Whole seconds, matching what the cache stores, so a run off the cache binds exactly as a run that read
        // the transcripts.
        times.append(at.rounded())
        if let cwd = row["cwd"] as? String, !cwd.isEmpty { directory = cwd }
        if let value = row["entrypoint"] as? String { entrypoint = value }
      default:
        continue
      }
    }
    guard let last = times.max() else { return nil }
    let id = file.deletingPathExtension().lastPathComponent
    return ClaudeSession(
      id: id, title: title ?? "", directory: directory, entrypoint: entrypoint,
      promptTimes: times.sorted(), lastPromptAt: last)
  }

  /// `2026-10-14T19:11:16.782Z` as seconds since 1970.
  ///
  /// Read by hand rather than with a formatter: a transcript holds thousands of these, and every one Claude writes
  /// has this shape. Anything else falls back to the parser in Foundation.
  static func moment(_ stamp: String) -> Double? {
    let bytes = Array(stamp.utf8)
    guard bytes.count >= 20, bytes.last == UInt8(ascii: "Z"), bytes[4] == UInt8(ascii: "-"),
      bytes[10] == UInt8(ascii: "T")
    else {
      return (try? Date(stamp, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))?
        .timeIntervalSince1970
        ?? (try? Date(stamp, strategy: .iso8601))?.timeIntervalSince1970
    }
    func number(_ range: Range<Int>) -> Int? {
      var value = 0
      for index in range {
        let digit = Int(bytes[index]) - 48
        guard (0...9).contains(digit) else { return nil }
        value = value * 10 + digit
      }
      return value
    }
    guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10),
      let hour = number(11..<13), let minute = number(14..<16), let second = number(17..<19),
      (1...12).contains(month), (1...31).contains(day)
    else { return nil }
    var fraction = 0.0
    if bytes.count > 20, bytes[19] == UInt8(ascii: ".") {
      let digits = bytes[20..<(bytes.count - 1)]
      if let value = number(digits.startIndex..<digits.endIndex), !digits.isEmpty {
        fraction = Double(value) / pow(10, Double(digits.count))
      }
    }
    let days = daysFromCivil(year: year, month: month, day: day)
    return Double(days * 86_400 + hour * 3_600 + minute * 60 + second) + fraction
  }

  /// What has already been read out of the transcripts, so that only a transcript written to since is read again.
  struct SessionCache: Codable, Equatable {
    var files: [String: Entry] = [:]

    struct Entry: Codable, Equatable {
      var id: String
      var title: String
      var directory: String
      var entrypoint: String?
      /// Whole seconds: the lookup never needs finer, and this halves the file.
      var prompts: [Int]
      var modified: Double
      var size: Int

      init(_ session: ClaudeSession, modified: Double, size: Int) {
        id = session.id
        title = session.title
        directory = session.directory
        entrypoint = session.entrypoint
        prompts = session.promptTimes.map { Int($0.rounded()) }
        self.modified = modified
        self.size = size
      }

      func session() -> ClaudeSession {
        let times = prompts.map(Double.init)
        return ClaudeSession(
          id: id, title: title, directory: directory, entrypoint: entrypoint, promptTimes: times,
          lastPromptAt: times.last ?? 0)
      }
    }

    static func read(from url: URL) -> SessionCache? {
      guard let data = try? Data(contentsOf: url) else { return nil }
      return try? JSONDecoder().decode(SessionCache.self, from: data)
    }

    func write(to url: URL) {
      guard let data = try? JSONEncoder().encode(self) else { return }
      try? FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? data.write(to: url, options: .atomic)
    }
  }

  /// Days between 1970-01-01 and a civil date, by Howard Hinnant's algorithm.
  static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
    let shifted = year - (month <= 2 ? 1 : 0)
    let era = (shifted >= 0 ? shifted : shifted - 399) / 400
    let yearOfEra = shifted - era * 400
    let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    return era * 146_097 + dayOfEra - 719_468
  }
}

extension StoreLocation {
  /// What has been read out of Claude's transcripts, kept beside the store. Every index built for this store
  /// should use it: without it a build reads two hundred transcripts again, which is twenty seconds of CPU.
  public var claudeSessionCache: URL { root.appendingPathComponent("claude-sessions.json") }
}
