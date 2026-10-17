import AppKit
import ScreencapCore
import SwiftUI

/// One thread as the palette shows it.
struct ResumeRow: Identifiable, Sendable {
  var id: Int64
  var name: String
  /// What was being done when the thread was last left.
  var leftOff: String
  var lastSeenAt: Double
  var scores: [ThingScore]
  /// The screen as it was when the thread was last left: the preview.
  var preview: Capture?

  /// The one icon the row shows: the site of the place it is most about, else that place's app.
  var place: Place? { scores.first.flatMap { ResumeRowView.place(of: $0.thing) } }

  /// The browser a site was seen in, which stands in while its own icon is being fetched.
  var fallbackApp: String? { scores.first?.thing.bundleID }

  /// One entry per site or app among the places, in score order.
  var distinctPlaces: [(place: Place?, app: String?)] {
    var seen: Set<Place> = []
    var out: [(place: Place?, app: String?)] = []
    for score in scores {
      guard let place = ResumeRowView.place(of: score.thing), seen.insert(place).inserted else { continue }
      out.append((place, score.thing.bundleID))
    }
    return out
  }

  /// "Claude session · 2 tabs": what pressing return would bring forward.
  var summary: String {
    var counts: [ThingKind: Int] = [:]
    for score in scores { counts[score.thing.kind, default: 0] += 1 }
    let names: [(ThingKind, String, String)] = [
      (.session, "session", "sessions"), (.tab, "tab", "tabs"), (.window, "window", "windows"),
      (.app, "app", "apps"),
    ]
    let parts = names.compactMap { kind, one, many -> String? in
      guard let count = counts[kind], count > 0 else { return nil }
      return "\(count) \(count == 1 ? one : many)"
    }
    return parts.isEmpty ? "nothing bound yet" : parts.joined(separator: " · ")
  }
}

/// What the list can be asked to scroll to: a thread's row, or one of its places while they are being looked at.
enum ResumeScrollID: Hashable {
  case row(Int64)
}

/// The threads worth coming back to, which one is chosen, and what the list should scroll to.
///
/// The list scrolls only when the keys ask it to, and only as far as it takes to show the chosen row. The pointer
/// never scrolls it. Those two rules are what stop the list chasing itself: when the pointer chose a row and the
/// list then scrolled to it, a different row slid under the still pointer, took the choice, and scrolled again.
@MainActor
@Observable
final class ResumeModel {
  private let database: AppDatabase
  private let location: StoreLocation
  private let corrections: Corrections?
  private let sessionCache: URL
  private let resumer: Resumer

  private(set) var rows: [ResumeRow] = []
  var query = "" {
    didSet {
      guard query != oldValue else { return }
      selection = 0
      peeking = nil
      if let first = shown.first { scroll(to: .row(first.id), anchor: .top) }
    }
  }
  private(set) var selection = 0
  /// The row whose places are being looked at without acting on them, and which of them is chosen.
  private(set) var peeking: Int64?
  private(set) var peekSelection = 0
  /// A line in the footer in place of the keys: what a drop or a split did.
  var note: String?
  /// The place ⌘⌫ dropped last, which ⌘Z puts back while the palette is open.
  private(set) var lastDropped: (threadID: Int64, thingID: Int64, label: String)?
  /// Threads whose activities fall into two groups sharing no place at all.
  private(set) var splitCandidates: Set<Int64> = []
  private(set) var splitting = false
  /// Site and app icons, fetched once and kept on disk (`PlaceIcons`).
  let icons = PlaceIcons()
  /// The app, window and page in front, as the capture engine last read them. Nil where nothing reads them, as in the
  /// probes.
  @ObservationIgnored var front: (() -> ForegroundContext)?
  /// The thread being worked in, which the list puts last, or nil when what is in front belongs to no thread.
  @ObservationIgnored private(set) var current: Int64?

  struct ScrollRequest: Equatable {
    var target: ResumeScrollID
    var anchor: UnitPoint?
    /// Two requests for the same row are still two requests.
    var serial: Int
  }
  private(set) var scrollRequest: ScrollRequest?
  /// Bumped each time the palette is shown. The view is built once and shown many times, so its appearing once
  /// cannot be what puts the keys in the search field (the menu-bar panel learned the same).
  private(set) var focusRequests = 0

  func requestFocus() { focusRequests += 1 }
  @ObservationIgnored private var scrollSerial = 0
  @ObservationIgnored private var lastPointer: (location: CGPoint, timestamp: TimeInterval, moved: Bool)?

  init(database: AppDatabase, location: StoreLocation, corrections: Corrections?) {
    self.database = database
    self.location = location
    self.corrections = corrections
    sessionCache = location.claudeSessionCache
    resumer = Resumer(database: database)
  }

  var shown: [ResumeRow] {
    let text = query.trimmingCharacters(in: .whitespaces).lowercased()
    guard !text.isEmpty else { return rows }
    return rows.filter { $0.name.lowercased().contains(text) || $0.leftOff.lowercased().contains(text) }
  }

  var chosen: ResumeRow? {
    let list = shown
    return list.indices.contains(selection) ? list[selection] : nil
  }

  /// Builds every row in one pass over the bindings, the things and the latest activities, so the palette is ready
  /// in the frame it is shown.
  ///
  /// The thread being worked in right now goes last: return on it would bring forward what is already in front,
  /// and the thread you mean to go back to is the one you were in before it.
  ///
  /// The minutes the understanding has not sorted yet count too: each of their screenshots that shows a place one
  /// thread owns moves that thread's last-seen time up, and the window in front, or else the newest screenshot, says
  /// which thread is in front. Without them the palette lagged the screen by the four minutes or so an activity takes
  /// to be given its thread.
  func reload(now: Double = Date().timeIntervalSince1970) {
    do {
      let bindings = try database.allBindings()
      let things = try database.allThings()
      let latest = try database.latestActivityPerThread()
      let excluded = try database.exclusions()
      let frames = try database.latestFramePerThread()
      let byThread = Dictionary(grouping: bindings, by: \.threadID)
      let owners = ResumeFreshness.owners(bindings: bindings, now: now)
      let unsorted = try unsortedScreens(now: now, things: things)
      let recent = ResumeFreshness.lastSeen(unsorted, owners: owners)
      var rows: [ResumeRow] = []
      for thread in try database.threadsWithBindings(limit: 60) {
        guard let id = thread.id, let mine = byThread[id] else { continue }
        let scores = ResumeRanking.scores(threadID: id, bindings: mine, everyBinding: bindings, things: things, now: now)
        let plan = ResumeRanking.plan(scores, excluded: excluded[id] ?? [])
        guard !plan.isEmpty else { continue }
        rows.append(
          ResumeRow(
            id: id, name: thread.name.isEmpty ? "Unnamed thread" : thread.name,
            leftOff: latest[id]?.text ?? "", lastSeenAt: max(thread.lastSeenAt, latest[id]?.at ?? 0, recent[id] ?? 0),
            scores: plan, preview: frames[id]))
      }
      rows.sort { $0.lastSeenAt > $1.lastSeenAt }
      let current =
        unsorted.isEmpty ? try currentThread(now: now) : ResumeFreshness.current(unsorted, owners: owners, now: now)
      if let current, let index = rows.firstIndex(where: { $0.id == current }) {
        rows.append(rows.remove(at: index))
      }
      self.current = current
      self.rows = rows
      selection = min(selection, max(0, shown.count - 1))
    } catch {
      rows = []
      note = "Could not read your history: \(error.localizedDescription)"
    }
  }

  /// Reloads while the palette is open, keeping the chosen thread chosen when the rows move under it.
  func refresh() {
    let chosenID = chosen?.id
    reload(now: now)
    if let chosenID, let index = shown.firstIndex(where: { $0.id == chosenID }) { selection = index }
  }

  /// The screenshots since the latest activity whose thread is settled, at most the last hour, each with the place
  /// it showed, and last the window in front now. A screenshot waits for the screen to change or settle, so pressing
  /// ⌥Space right after a switch would otherwise find the app you just left. Claude's transcripts are read only when
  /// one of them is of Claude.
  private func unsortedScreens(now: Double, things: [Int64: Thing]) throws -> [ResumeFreshness.Seen] {
    let since = max(try database.latestSettledActivityEnd() ?? 0, now - 3_600)
    let captures = try database.focusedCaptures(from: since).filter { $0.at <= now }
    // The engine's observers keep its reading current while it runs; a view-only copy never starts it, so the
    // reading is used only when its app is the one macOS has in front.
    var inFront = front?()
    if inFront?.bundleID != NSWorkspace.shared.frontmostApplication?.bundleIdentifier { inFront = nil }
    guard !captures.isEmpty || inFront != nil else { return [] }
    var ids: [String: Int64] = [:]
    for thing in things.values { if let id = thing.id { ids[thing.key] = id } }
    let needsSessions =
      inFront?.bundleID == ClaudeSessionIndex.bundleID
      || captures.contains { $0.context.bundleID == ClaudeSessionIndex.bundleID }
    let readers = ThingReaders.standard(
      sessions: needsSessions ? ClaudeSessionIndex.build(since: since - 86_400, cache: sessionCache) : nil)
    var seen = captures.map { capture in
      ResumeFreshness.Seen(at: capture.at, thingID: readers.ref(for: capture).flatMap { ids[$0.key] })
    }
    // Screencap's own windows are no place, and say nothing about which thread is in front.
    if let inFront, let ref = readers.ref(context: inFront, at: now) { seen.append(.init(at: now, thingID: ids[ref.key])) }
    return seen
  }

  /// The thread of what was on screen within the last ten minutes, which is the one being worked in.
  private func currentThread(now: Double) throws -> Int64? {
    guard let activity = try database.latestThreadedActivity(), now - activity.endAt < 600 else { return nil }
    return activity.threadID
  }

  /// Where a stored frame is on disk.
  func frameURL(_ capture: Capture) -> URL? { capture.framePath.map(location.url) }

  /// A keyboard move: among the rows, or among the places of the row being looked at in the preview.
  func move(_ offset: Int) {
    note = nil
    if let peeking, let row = chosen, row.id == peeking {
      peekSelection = min(max(0, peekSelection + offset), max(0, row.scores.count - 1))
      return
    }
    let count = shown.count
    guard count > 0 else { return }
    selection = min(max(0, selection + offset), count - 1)
    scroll(to: .row(shown[selection].id))
  }

  /// The pointer moved onto a row. It takes the choice, and never scrolls. While a thread's places are open in
  /// the preview the rows stay put: on the way across to the preview the pointer can pass over other rows, and it
  /// is not choosing them.
  func pointerEntered(row index: Int) {
    guard peeking == nil, pointerReallyMoved(), shown.indices.contains(index), index != selection else { return }
    selection = index
  }

  func pointerEntered(place index: Int) {
    guard pointerReallyMoved() else { return }
    peekSelection = index
  }

  /// Whether the person moved the mouse, as opposed to the list moving under a pointer that stayed still.
  ///
  /// Hover callbacks also run when content scrolls under the pointer, or when a row grows, and those must not take
  /// the choice. So a hover counts only for a mouse-moved event that put the pointer somewhere new on screen. One
  /// event reaches the row and the place inside it, so the verdict is kept per event rather than worked out twice.
  private func pointerReallyMoved() -> Bool {
    guard let event = NSApp.currentEvent, event.type == .mouseMoved || event.type == .leftMouseDragged else {
      return false
    }
    if let last = lastPointer, last.timestamp == event.timestamp { return last.moved }
    let location = NSEvent.mouseLocation
    let moved = lastPointer.map { hypot(location.x - $0.location.x, location.y - $0.location.y) > 0.5 } ?? false
    lastPointer = (location, event.timestamp, moved)
    return moved
  }

  func choose(row index: Int) {
    guard shown.indices.contains(index) else { return }
    peeking = nil
    selection = index
  }

  func togglePeek() {
    guard let row = chosen else { return }
    note = nil
    peekSelection = 0
    peeking = peeking == row.id ? nil : row.id
  }

  func leavePeek() {
    peeking = nil
    note = nil
  }

  private func scroll(to target: ResumeScrollID, anchor: UnitPoint? = nil) {
    scrollSerial += 1
    scrollRequest = ScrollRequest(target: target, anchor: anchor, serial: scrollSerial)
  }

  /// "This is not part of that thread." It stays out until it is put back, which no rebuild undoes.
  func dropChosenPlace() {
    guard let row = chosen, peeking == row.id, row.scores.indices.contains(peekSelection),
      let thingID = row.scores[peekSelection].thing.id
    else { return }
    let label = row.scores[peekSelection].thing.label
    do {
      try database.exclude(thingID: thingID, fromThread: row.id)
      lastDropped = (row.id, thingID, label)
      reload()
      let left = rows.first { $0.id == row.id }?.scores.count ?? 0
      if left == 0 { peeking = nil }
      peekSelection = min(peekSelection, max(0, left - 1))
      note = "Dropped \(label) · ⌘Z puts it back"
    } catch {
      note = "Could not drop it: \(error.localizedDescription)"
    }
  }

  /// Puts back the place ⌘⌫ just dropped. Settings lists every dropped place, for the ones dropped earlier.
  func undoDrop() {
    guard let dropped = lastDropped else { return }
    do {
      try database.include(thingID: dropped.thingID, inThread: dropped.threadID)
      lastDropped = nil
      reload()
      note = "Put \(dropped.label) back"
    } catch {
      note = "Could not put it back: \(error.localizedDescription)"
    }
  }

  /// Moves the smaller side of a thread holding two pieces of work into a thread of its own, named by the engine.
  func splitChosen() async {
    guard let row = chosen, splitCandidates.contains(row.id), !splitting else { return }
    guard let corrections else {
      note = "Splitting needs the models, which are not set up"
      return
    }
    splitting = true
    note = "Splitting \(row.name)…"
    defer { splitting = false }
    do {
      let readers = ThingReaders.standard(sessions: ClaudeSessionIndex.build(cache: sessionCache))
      guard let candidate = try ThreadSplits.candidate(for: row.id, in: database, readers: readers) else {
        splitCandidates.remove(row.id)
        note = "It no longer looks like two pieces of work"
        return
      }
      try await corrections.split(candidate)
      // Both threads changed shape, so their places are worked out again before the list is.
      try BindingBuilder().rebuild(in: database, readers: readers)
      splitCandidates.remove(row.id)
      reload()
      note = "Split \(candidate.groups[1].activityIDs.count) activities into a thread of their own"
    } catch {
      note = "Could not split it: \(error.localizedDescription)"
    }
  }

  /// Threads that hold two pieces of work, found in the background so the palette opens at once. The transcript
  /// index is built once for all of them.
  func findSplits(limit: Int = 12) {
    let ids = rows.prefix(limit).map(\.id)
    let database = database
    let cache = sessionCache
    Task.detached(priority: .utility) {
      let readers = ThingReaders.standard(sessions: ClaudeSessionIndex.build(cache: cache))
      var found: Set<Int64> = []
      for id in ids where (try? ThreadSplits.candidate(for: id, in: database, readers: readers)) ?? nil != nil {
        found.insert(id)
      }
      await MainActor.run { [found] in self.splitCandidates = found }
    }
  }

  /// Brings a thread's places forward, and says in a line what could not be brought back: empty when everything
  /// came. A page opened again counts as brought back.
  func resume(_ row: ResumeRow) -> (thread: String, leftOff: String, trouble: String, unasked: [String]) {
    do {
      guard let result = try resumer.run(threadID: row.id) else { return (row.name, row.leftOff, "", []) }
      let trouble = result.stuck.map { "\($0.thing.label): \($0.note ?? $0.outcome.rawValue)" }
      return (row.name, row.leftOff, trouble.joined(separator: " · "), Resumer.unaskedBrowsers(in: result))
    } catch {
      return (row.name, row.leftOff, error.localizedDescription, [])
    }
  }

  /// The moment times are counted back from: now, except in the README's frames, which run on a made-up day.
  private(set) var pinnedNow: Double?
  var now: Double { pinnedNow ?? Date().timeIntervalSince1970 }

  /// Puts the palette in the state one frame of the README's GIF shows (`ReadmeFrames.resume`), without the moves
  /// that lead to it.
  func showcase(now: Double, selection: Int, peeking: Bool, place: Int) {
    pinnedNow = now
    self.selection = min(max(0, selection), max(0, shown.count - 1))
    self.peeking = peeking ? chosen?.id : nil
    peekSelection = place
  }

  /// A fresh start each time the palette is shown.
  func reset() {
    query = ""
    selection = 0
    peeking = nil
    peekSelection = 0
    note = nil
    lastDropped = nil
    lastPointer = nil
    scrollRequest = nil
  }
}

/// The switcher: one hotkey, the threads you have been working in, and return to be put back into one.
///
/// The list on the left, and beside it a preview of the chosen thread: the screen as it was when the thread was
/// last left, cut to the window that was in front, with where it was left and what return brings back. The
/// preview follows the choice, by key or by pointer, and never covers the list, so going through the threads
/// stays as quick as it was. Tab opens the thread's places in the preview, where one can be dropped.
///
/// The keys are handled by `ResumePaletteController`, ahead of the search field, which would otherwise swallow
/// the arrows. Space cannot open a preview the way it does in Finder, because it types into the search.
struct ResumePalette: View {
  @Bindable var model: ResumeModel
  var resume: () -> Void

  static let listWidth: CGFloat = 340
  static let cornerRadius: CGFloat = 20
  /// Exactly nine rows: nine 44-point rows two points apart inside six-point margins.
  static let contentHeight: CGFloat = 9 * 44 + 8 * 2 + 2 * 6
  /// A 52-point field, a hairline, the content, a hairline and a 34-point footer.
  static let size = CGSize(width: 880, height: 52 + 1 + contentHeight + 1 + 34)

  @FocusState private var fieldFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      field
      Divider().overlay(Theme.hairline)
      HStack(spacing: 0) {
        Group {
          if model.shown.isEmpty { empty } else { rows }
        }
        .frame(width: Self.listWidth, alignment: .top)
        Rectangle().fill(Theme.hairline).frame(width: 1)
        ResumePreview(model: model, row: model.chosen)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
      .frame(height: Self.contentHeight)
      Divider().overlay(Theme.hairline)
      footer
    }
    .frame(width: Self.size.width, height: Self.size.height, alignment: .top)
    // A hairline edge, which on a light page is what tells the glass from the page under it.
    .overlay(RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    .onAppear { fieldFocused = true }
    .onChange(of: model.focusRequests) { fieldFocused = true }
  }

  private var field: some View {
    HStack(spacing: 11) {
      Image(systemName: "arrow.uturn.backward")
        .font(.ui(13, .medium)).foregroundStyle(Theme.ink5).frame(width: 20)
      TextField("Jump to a thread", text: $model.query)
        .textFieldStyle(.plain)
        .font(.ui(16))
        .focused($fieldFocused)
      Key(ResumePaletteController.shortcutText)
    }
    .padding(.horizontal, 16)
    .frame(height: 52)
  }

  private var rows: some View {
    ScrollViewReader { proxy in
      ScrollView(.vertical) {
        VStack(spacing: 2) {
          ForEach(Array(model.shown.enumerated()), id: \.element.id) { index, row in
            ResumeRowView(
              row: row, icons: model.icons, isChosen: index == model.selection,
              isQuiet: model.peeking != nil && index == model.selection, now: model.now)
              .id(ResumeScrollID.row(row.id))
              .contentShape(.rect)
              .pointerStyle(.link)
              .onContinuousHover { phase in
                if case .active = phase { model.pointerEntered(row: index) }
              }
              // The pointer already shows the preview, so a click goes: look by hovering, go by clicking.
              .onTapGesture {
                model.choose(row: index)
                resume()
              }
          }
        }
        .padding(.horizontal, 8)
      }
      // A margin rather than padding: padding is part of the content, so scrolling back to the first row stopped
      // at the row and left the space above it hidden; the scroll view keeps a margin clear when it scrolls.
      .contentMargins(.vertical, 6, for: .scrollContent)
      // No anchor: the list moves the least it can to show the chosen row, and not at all when it is already in
      // view. A centred anchor moved the list on every key, which reads as the list scrolling by itself.
      .onChange(of: model.scrollRequest) { _, request in
        guard let request else { return }
        proxy.scrollTo(request.target, anchor: request.anchor)
      }
    }
  }

  private var empty: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(model.rows.isEmpty ? "No threads to go back to yet" : "No thread by that name")
        .font(.ui(13, .medium)).foregroundStyle(Theme.ink3)
      if model.rows.isEmpty {
        Text("They appear here after you have worked in something for a few minutes.")
          .font(.ui(12)).foregroundStyle(Theme.ink5).fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
  }

  private var footer: some View {
    HStack(spacing: 0) {
      if let note = model.note, !note.isEmpty {
        Text(note).font(.ui(11.5)).foregroundStyle(Theme.ink4).lineLimit(1).truncationMode(.tail)
      } else if model.peeking != nil {
        hint("Resume", "↩")
        hint("Drop this place", "⌘⌫")
        hint("Back", "esc")
      } else {
        hint("Resume", "↩")
        hint("Places", "⇥")
        if model.splitCandidates.contains(model.chosen?.id ?? -1) { hint("Split in two", "⌘K") }
      }
      Spacer(minLength: 8)
    }
    .padding(.horizontal, 16)
    .frame(height: 34)
  }

  private func hint(_ label: String, _ key: String) -> some View {
    HStack(spacing: 5) {
      Text(label).font(.ui(11.5)).foregroundStyle(Theme.ink4)
      Key(key, small: true)
    }
    .padding(.trailing, 14)
  }
}

/// The chosen thread, beside the list: the screen it was left on and what return brings back, or, with its places
/// open, those places to pick from.
private struct ResumePreview: View {
  let model: ResumeModel
  let row: ResumeRow?

  static let screenHeight: CGFloat = 300

  var body: some View {
    if let row {
      VStack(alignment: .leading, spacing: 0) {
        if model.peeking == row.id {
          places(of: row)
        } else {
          screen(of: row)
          summary(of: row).padding(.top, 14)
        }
      }
      .padding(16)
      // A new thread is a new picture: the old one does not stretch into it.
      .id(row.id)
      .transition(.opacity)
    }
  }

  @ViewBuilder func screen(of row: ResumeRow) -> some View {
    if let capture = row.preview, let url = model.frameURL(capture) {
      Screenshot(
        url: url, maxPixels: 1_100, cornerRadius: 10,
        crop: capture.window.flatMap { $0.isWorthCropping ? $0 : nil })
        .frame(maxWidth: .infinity)
        .frame(height: Self.screenHeight)
    } else {
      // No frame was kept of this one (it may have been deleted, or never captured): its place stands in.
      RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.wash)
        .overlay {
          PlaceIcon(icons: model.icons, place: row.place, app: row.fallbackApp, size: 40).opacity(0.8)
        }
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline))
        .frame(maxWidth: .infinity)
        .frame(height: Self.screenHeight)
    }
  }

  func summary(of row: ResumeRow) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(row.name).font(.ui(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
      HStack(spacing: 6) {
        if !row.leftOff.isEmpty {
          Text(row.leftOff).font(.ui(12)).foregroundStyle(Theme.ink3).lineLimit(1)
          Text("·").font(.ui(12)).foregroundStyle(Theme.ink5)
        }
        Text(agoText(row.lastSeenAt, now: model.now)).font(.ui(12)).foregroundStyle(Theme.ink4).fixedSize()
      }
      HStack(spacing: 6) {
        // One icon per kind of place, so three Claude sessions do not read as three of the same thing.
        ForEach(Array(row.distinctPlaces.prefix(5).enumerated()), id: \.offset) { _, place in
          PlaceIcon(icons: model.icons, place: place.place, app: place.app, size: 14).frame(width: 14, height: 14)
        }
        Text("Brings back " + row.summary).font(.ui(11.5)).foregroundStyle(Theme.ink4).lineLimit(1)
      }
      .padding(.top, 4)
    }
  }

  func places(of row: ResumeRow) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(row.name).font(.ui(15, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
      Text("What return brings back").font(.ui(12)).foregroundStyle(Theme.ink4).padding(.bottom, 10)
      ForEach(Array(row.scores.enumerated()), id: \.element.thing.key) { index, score in
        HStack(spacing: 10) {
          PlaceIcon(
            icons: model.icons, place: ResumeRowView.place(of: score.thing), app: score.thing.bundleID, size: 16)
            .frame(width: 16, height: 16)
          Text(score.thing.label)
            .font(.ui(12.5))
            .foregroundStyle(index == model.peekSelection ? Theme.ink : Theme.ink3)
            .lineLimit(1).truncationMode(.middle)
          Spacer(minLength: 8)
          Text(durationText(score.seconds / 60)).font(.ui(11.5)).foregroundStyle(Theme.ink5)
        }
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(index == model.peekSelection ? Theme.glassSelection : Color.clear))
        .contentShape(.rect)
        .onContinuousHover { phase in
          if case .active = phase { model.pointerEntered(place: index) }
        }
      }
    }
  }
}

private struct ResumeRowView: View {
  let row: ResumeRow
  let icons: PlaceIcons
  let isChosen: Bool
  /// Chosen, while the keys are working in the preview: still marked, more quietly.
  var isQuiet = false
  var now = Date().timeIntervalSince1970

  var body: some View {
    HStack(spacing: 11) {
      PlaceIcon(icons: icons, place: row.place, app: row.fallbackApp, size: 22)
        .frame(width: 22, height: 22)
      VStack(alignment: .leading, spacing: 1) {
        Text(row.name).font(.ui(13.5, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
        Text(row.leftOff.isEmpty ? row.summary : row.leftOff)
          .font(.ui(11.5)).foregroundStyle(Theme.ink4).lineLimit(1)
      }
      Spacer(minLength: 6)
      Text(agoText(row.lastSeenAt, now: now, short: true)).font(.ui(11)).foregroundStyle(Theme.ink5).fixedSize()
    }
    .frame(height: 44)
    .padding(.horizontal, 10)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(isChosen ? (isQuiet ? Theme.glassSelection.opacity(0.55) : Theme.glassSelection) : Color.clear))
  }

  nonisolated static func place(of thing: Thing) -> Place? {
    if thing.kind == .tab, let host = thing.key.dropFirst(4).split(separator: "/").first {
      return .site(String(host))
    }
    return thing.bundleID.map { Place.app($0) }
  }
}

/// A key as a palette draws one: the glyph on a quiet slab.
private struct Key: View {
  let text: String
  var small = false

  init(_ text: String, small: Bool = false) {
    self.text = text
    self.small = small
  }

  var body: some View {
    Text(text)
      .font(.ui(small ? 10.5 : 11, .medium))
      .foregroundStyle(Theme.ink4)
      .padding(.horizontal, small ? 5 : 7)
      .padding(.vertical, small ? 1.5 : 3)
      .background(
        RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Theme.wash)
          .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5)))
  }
}

/// "15 min ago", "3 hr ago", "yesterday", or with `short` "15m", "3h", "1d" for the narrow list. Whole units
/// counted down, so 59 minutes never reads as "60 min".
func agoText(_ at: Double, now: Double = Date().timeIntervalSince1970, short: Bool = false) -> String {
  let seconds = max(0, now - at)
  if seconds < 90 { return short ? "now" : "just now" }
  if seconds < 3_600 { return short ? "\(Int(seconds / 60))m" : "\(Int(seconds / 60)) min ago" }
  if seconds < 86_400 { return short ? "\(Int(seconds / 3_600))h" : "\(Int(seconds / 3_600)) hr ago" }
  let days = Int(seconds / 86_400)
  if short { return "\(days)d" }
  return days <= 1 ? "yesterday" : "\(days) days ago"
}
