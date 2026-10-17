import AppKit
import ScreenCaptureKit
import ApplicationServices
import Foundation
import ScreencapCore

/// Bindings from the command line:
///
///   Screencap rebuild-bindings [--store DIR] [--since DAYS] [--from-scratch]
///   Screencap bindings [--store DIR] [--thread N | --name TEXT] [--all]
///
/// `rebuild-bindings` reads the captures that already have a thread and writes how long each place was on screen;
/// `bindings` prints what a resume would bring forward, and what it left out and why.
enum ResumeCommands {
  static func rebuild(location: StoreLocation, option: (String) -> String?, fromScratch: Bool) throws {
    let database = try location.openDatabase()
    let since = option("--since").flatMap(Double.init).map { Date().timeIntervalSince1970 - $0 * 86_400 } ?? 0
    if fromScratch { try database.clearBindings() }

    let started = Date()
    let cache = location.claudeSessionCache
    let sessions = ClaudeSessionIndex.build(since: since > 0 ? since - 86_400 : 0, cache: cache)
    let indexed = Date()
    let report = try BindingBuilder().rebuild(
      in: database, since: since, readers: ThingReaders.standard(sessions: sessions))
    let finished = Date()

    print(
      "sessions: \(sessions.sessions.count) read in \(Int(indexed.timeIntervalSince(started) * 1000)) ms"
        + " (\(sessions.sessions.filter(\.isDesktop).count) from the desktop app)")
    print(
      "bindings: \(report.rows) rows over \(report.things) things in \(report.threads) threads,"
        + " \(Int(report.seconds / 60)) min, in \(Int(finished.timeIntervalSince(indexed) * 1000)) ms")
    let claude = report.claudeNamed + report.claudeUnnamed
    if claude > 0 {
      let share = Int((Double(report.claudeNamed) / Double(claude) * 100).rounded())
      let named = "\(report.claudeNamed)/\(claude)"
      print("Claude captures named with a session: " + named + " (\(share)%)")
    }
  }

  static func show(location: StoreLocation, option: (String) -> String?, all: Bool) throws {
    let database = try location.openDatabase()
    let now = Date().timeIntervalSince1970
    let thresholds = ResumeThresholds()

    var threads: [ActivityThread] = []
    if let id = option("--thread").flatMap(Int64.init) {
      guard let thread = try database.thread(id: id) else { throw Failure("no thread \(id)") }
      threads = [thread]
    } else if let name = option("--name")?.lowercased() {
      threads = try database.threadsWithBindings(limit: 200).filter { $0.name.lowercased().contains(name) }
      guard !threads.isEmpty else { throw Failure("no thread whose name holds “\(name)”") }
    } else {
      threads = try database.threadsWithBindings(limit: all ? 200 : 8)
    }

    for thread in threads {
      guard let id = thread.id else { continue }
      let bindings = try database.bindings(threadID: id)
      let thingIDs = Array(Set(bindings.map(\.thingID)))
      let everyBinding = try database.bindings(thingIDs: thingIDs)
      let things = try database.things(ids: thingIDs)
      let scores = ResumeRanking.scores(
        threadID: id, bindings: bindings, everyBinding: everyBinding, things: things, now: now,
        thresholds: thresholds)
      let kept = ResumeRanking.plan(scores, thresholds: thresholds)
      let keptKeys = Set(kept.map(\.thing.key))

      print("")
      print("thread \(id) · \(thread.name) · \(thread.activityCount) activities · \(thread.category.rawValue)")
      guard !scores.isEmpty else {
        print("  nothing bound yet — run rebuild-bindings")
        continue
      }
      print("  " + row(["score", "share", "min", "caps", "kind", "thing"]))
      for score in scores {
        // A dot marks what a resume would leave out.
        let mark = keptKeys.contains(score.thing.key) ? "  " : "· "
        print(
          mark
            + row([
              String(format: "%.0f", score.score), String(format: "%.2f", score.share),
              String(format: "%.0f", score.seconds / 60), "\(score.captures)", score.thing.kind.rawValue,
              label(score.thing),
            ]))
      }
      if scores.count > kept.count {
        print("  · left out: share under \(thresholds.minShare) or under \(Int(thresholds.minSeconds))s on screen")
      }
    }
  }

  /// Brings a thread's places to the front, and prints what happened to each.
  @MainActor
  static func resume(location: StoreLocation, option: (String) -> String?) throws {
    let database = try location.openDatabase()
    let resumer = Resumer(database: database)
    guard let thread = try pick(option: option, in: database) else { throw Failure("name a thread with --thread or --name") }
    guard let id = thread.id, let result = try resumer.run(threadID: id) else { throw Failure("no thread to resume") }

    print("thread \(id) · \(thread.name)")
    if let left = result.plan.leftOff, !left.isEmpty { print("left off: \(left)") }
    for step in result.steps {
      let note = step.note.map { " (\($0))" } ?? ""
      print("  \(step.outcome.rawValue)  \(step.thing.kind.rawValue)  \(label(step.thing))\(note)")
    }
    var said = "brought \(result.brought) of \(result.steps.count) forward"
    if result.opened > 0 { said += ", opened \(result.opened) again" }
    print(said)
    if !result.stuck.isEmpty {
      print("could not reach: \(result.stuck.map { label($0.thing) }.joined(separator: ", "))")
    }
  }

  /// What each browser and Claude will answer, for working out a Mac where a resume cannot reach something.
  @MainActor
  static func probe(option: (String) -> String?) async throws {
    // --find reports whether a conversation's row can be reached, pressing nothing.
    if let title = option("--find") {
      let found = ClaudeWindow.locate(title: title)
      let cost = ClaudeWindow.lastSearch
      let report =
        (found.map { "found “\($0.text)”, pressable: \($0.pressable)" } ?? "no row for “\(title)”")
        + " · read \(cost.visited) elements in \(Int(cost.seconds * 1000)) ms"
        + (cost.exhausted ? " · ran out of budget" : "")
      try write(report, to: option("--out"))
      return
    }
    // --ask runs the permission request exactly as the onboarding card does, for checking it on a real Mac.
    if option("--ask") != nil {
      let states = await AutomationAccess.request()
      try write(AutomationAccess.outcome(of: states), to: option("--out"))
      return
    }
    if option("--menus") != nil {
      try write(ClaudeWindow.menus().joined(separator: "\n"), to: option("--out"))
      return
    }
    var lines: [String] = ["Accessibility permission: \(AXIsProcessTrusted())"]
    lines.append("Automation: " + AutomationAccess.summary())
    for bundleID in AutomationAccess.installedBrowsers() {
      lines.append("    \(bundleID): \(AutomationAccess.state(of: bundleID).rawValue)")
    }
    for (bundleID, family) in PrivateWindows.browsers.sorted(by: { $0.key < $1.key })
    where WindowIndex.isRunning(bundleID: bundleID) {
      if let tabs = BrowserTabs.tabs(bundleID: bundleID) {
        lines.append("\(bundleID) (\(family)): \(tabs.count) tabs")
        // Keys only: what a resume matches on, not what the pages say.
        for tab in tabs.prefix(12) {
          lines.append("    window \(tab.windowIndex) tab \(tab.tabIndex)  \(tab.thingKey ?? "no key")")
        }
        // Which tab each window shows, window 1 being the browser's frontmost: what a resume should have changed.
        if let shown = BrowserTabs.shownTabs(bundleID: bundleID) {
          lines.append("    showing: " + shown.map { "window \($0.window) tab \($0.tab)" }.joined(separator: ", "))
        }
      } else {
        lines.append("\(bundleID) (\(family)): \(BrowserTabs.lastOutcome.rawValue) \(BrowserTabs.lastError ?? "")")
      }
    }
    lines.append("")
    lines.append("Claude's window:")
    lines += ClaudeWindow.probe().map { "    \($0)" }

    try write(lines.joined(separator: "\n"), to: option("--out"))
  }

  /// Prints a report, or writes it where `open` can be read from: a command started through the signed app has no
  /// terminal to print to.
  static func write(_ text: String, to path: String?) throws {
    guard let path else {
      print(text)
      return
    }
    try text.write(to: URL(fileURLWithPath: path), atomically: true, encoding: .utf8)
    print("wrote \(path)")
  }

  /// A PNG of a part of the screen, given in global points, at the display's own resolution.
  static func photograph(_ rect: NSRect, to url: URL) async throws {
    guard let screen = NSScreen.screens.first(where: { $0.frame.intersects(rect) }),
      let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    else { throw Failure("no screen holds the palette") }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == number.uint32Value }) else {
      throw Failure("the palette's screen is not one Screencap can capture")
    }
    let local = CGRect(
      x: rect.minX - screen.frame.minX, y: screen.frame.maxY - rect.maxY, width: rect.width, height: rect.height)
    let configuration = SCStreamConfiguration()
    configuration.sourceRect = local
    configuration.width = Int(local.width * screen.backingScaleFactor)
    configuration.height = Int(local.height * screen.backingScaleFactor)
    configuration.showsCursor = false
    let image = try await SCScreenshotManager.captureImage(
      contentFilter: SCContentFilter(display: display, excludingWindows: []), configuration: configuration)
    let rep = NSBitmapImageRep(cgImage: image)
    try rep.representation(using: .png, properties: [:])?.write(to: url)
  }

  /// How the palette's list really scrolls: its offset after every key, and whether it keeps moving afterwards.
  ///
  /// The palette is built exactly as the app builds it, over the real store, in a window off the screen. Each
  /// line is one step: the key, the chosen row, and the list's offset in points. A list that scrolls only to keep
  /// the chosen row in view stays at 0 while that row is visible and then moves about a row a step; one that
  /// scrolls by itself keeps changing when nothing is pressed.
  @MainActor
  static func probePalette(location: StoreLocation, option: (String) -> String?) async throws {
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApp.finishLaunching()
    let database = try location.openDatabase()
    // --rows prints the palette's rows as it would show them now, with the window in front read as the app reads it,
    // or at a moment given in seconds since 1970, from the screenshots alone. Each row says how long ago the thread
    // was seen and, beside it, what its last sorted activity alone would say, so the unsorted minutes' share can be
    // seen.
    if let rowsAt = option("--rows") {
      let model = ResumeModel(database: database, location: location, corrections: nil)
      let pinned = Double(rowsAt).flatMap { $0 > 1_000_000 ? $0 : nil }
      let now = pinned ?? Date().timeIntervalSince1970
      if pinned == nil {
        let monitor = ContextMonitor()
        model.front = { monitor.readContext() }
      }
      model.reload(now: now)
      let sorted = try database.latestActivityPerThread()
      let rows = model.shown
      for (index, row) in rows.enumerated() {
        let before = sorted[row.id].map { agoText($0.at, now: now) } ?? "never"
        let mark = row.id == model.current ? "  (in front now, so last)" : ""
        print("\(index + 1). \(row.name) · \(agoText(row.lastSeenAt, now: now)) · sorted alone: \(before)\(mark)")
      }
      return
    }
    let controller = ResumePaletteController(database: database, location: location, corrections: nil)
    // --shot shows the real palette where it opens and photographs that part of the screen with a margin, so its
    // edge, corners and shadow can be checked in the light and dark appearance without anyone pressing a key.
    if let shot = option("--shot") {
      controller.show()
      try? await Task.sleep(for: .milliseconds(900))
      let around = controller.frame.insetBy(dx: -48, dy: -48)
      defer { controller.hide() }
      try await photograph(around, to: URL(fileURLWithPath: shot))
      return
    }
    guard let scroll = controller.showOffscreenForProbe() else { throw Failure("the list has no scroll view") }
    let model = controller.model
    var lines = ["rows: \(model.shown.count) · viewport: \(Int(scroll.contentView.bounds.height)) pt"]
    func settle() async { try? await Task.sleep(for: .milliseconds(120)) }
    func offset() -> Int { Int(scroll.contentView.bounds.origin.y.rounded()) }
    func record(_ step: String) { lines.append("\(step)\tselection \(model.selection)\toffset \(offset())") }

    await settle()
    record("open")
    let downs = min(model.shown.count + 2, 24)
    for step in 1...downs {
      model.move(1)
      await settle()
      record("down \(step)")
    }
    // Nothing pressed: the list must not move.
    var drift: [Int] = []
    for _ in 0..<12 {
      await settle()
      drift.append(offset())
    }
    lines.append("idle after down\t\(Set(drift).count == 1 ? "still" : "MOVED") \(drift)")
    for step in 1...downs {
      model.move(-1)
      await settle()
      record("up \(step)")
    }
    // The list scrolled as a wheel would, with the keys untouched: the choice must stay where it was.
    let before = model.selection
    scroll.contentView.scroll(to: NSPoint(x: 0, y: 220))
    scroll.reflectScrolledClipView(scroll.contentView)
    var wheel: [Int] = []
    for _ in 0..<10 {
      await settle()
      wheel.append(offset())
    }
    lines.append(
      "wheel to 220\tselection \(before)→\(model.selection)\t\(Set(wheel).count == 1 ? "still" : "MOVED") \(wheel)")
    // Looking at a row's places near the bottom, then walking through them.
    model.query = ""
    await settle()
    for _ in 0..<max(0, min(model.shown.count, 8) - 1) { model.move(1) }
    await settle()
    model.togglePeek()
    await settle()
    record("peek")
    for step in 1...max(1, model.chosen?.scores.count ?? 1) {
      model.move(1)
      await settle()
      lines.append("place \(step)\tplace \(model.peekSelection)\toffset \(offset())")
    }
    try write(lines.joined(separator: "\n"), to: option("--out"))
  }

  /// The thread named by `--thread` or `--name`.
  static func pick(option: (String) -> String?, in database: AppDatabase) throws -> ActivityThread? {
    if let id = option("--thread").flatMap(Int64.init) {
      guard let thread = try database.thread(id: id) else { throw Failure("no thread \(id)") }
      return thread
    }
    guard let name = option("--name")?.lowercased() else { return nil }
    let threads = try database.threadsWithBindings(limit: 200).filter { $0.name.lowercased().contains(name) }
    guard let thread = threads.first else { throw Failure("no thread whose name holds “\(name)”") }
    return thread
  }

  /// Threads that hold two pieces of work, and with `--apply N`, moving the smaller side into its own thread.
  static func splits(location: StoreLocation, option: (String) -> String?) async throws {
    let database = try location.openDatabase()
    let cache = location.claudeSessionCache
    let readers = ThingReaders.standard(sessions: ClaudeSessionIndex.build(cache: cache))
    let applying = option("--apply").flatMap(Int64.init)

    var found = 0
    for thread in try database.threadsWithBindings(limit: 200) {
      guard let id = thread.id, applying == nil || applying == id else { continue }
      guard let candidate = try ThreadSplits.candidate(for: id, in: database, readers: readers) else { continue }
      found += 1
      print("")
      print(
        "thread \(id) · \(thread.name) · \(candidate.activityCount) activities ·"
          + " \(Int((candidate.sharedShare * 100).rounded()))% of its time is in activities that used both sides")
      for (number, group) in candidate.groups.enumerated() {
        print(
          "  side \(number + 1) · \(Int((group.share * 100).rounded()))% ·"
            + " \(group.activityIDs.count) activities · \(Int(group.seconds / 60)) min")
        for thing in group.things.prefix(4) {
          print("      \(thing.kind.rawValue)  \(thing.label)  (\(Int(thing.seconds / 60)) min)")
        }
        if group.things.count > 4 { print("      and \(group.things.count - 4) more") }
      }
      if !candidate.otherActivities.isEmpty {
        print("  \(candidate.otherActivities.count) other activities share nothing with either side and stay")
      }
      if applying == id {
        // Through the same correction the palette uses, so the new thread is named before anything moves.
        let (_, corrections) = try makeCorrections(at: location)
        let target = try await corrections.split(candidate)
        let name = try target.flatMap { try database.thread(id: $0) }?.name ?? ""
        try BindingBuilder().rebuild(in: database, readers: readers)
        print("  moved \(candidate.groups[1].activityIDs.count) activities into thread \(target ?? 0) · \(name)")
      }
    }
    if found == 0 { print("no thread looks like two") }
  }

  static func label(_ thing: Thing) -> String {
    guard let detail = thing.detail, !detail.isEmpty else { return thing.label }
    return "\(thing.label) · \(detail)"
  }

  static let widths = [6, 5, 4, 5, 7]

  /// One line of the table, each cell padded to its column.
  static func row(_ cells: [String]) -> String {
    cells.enumerated()
      .map { index, text in
        let width = index < widths.count ? widths[index] : 0
        guard text.count < width else { return text }
        return text + String(repeating: " ", count: width - text.count)
      }
      .joined(separator: " ")
  }

  struct Failure: LocalizedError {
    var message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
  }
}
