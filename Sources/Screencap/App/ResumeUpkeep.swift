import Foundation
import ScreencapCore

/// Keeps the bindings current without anybody asking.
///
/// A rebuild reads only the captures of activities that ended recently, and the transcripts it needs are cached by
/// size and modification time, so a pass costs tens of milliseconds once the first one has been paid. The first
/// pass after an update reads every transcript, which is why this never runs on the main thread.
actor ResumeUpkeep {
  private let database: AppDatabase
  private let cache: URL
  private let builder = BindingBuilder()
  /// Activities that ended within this many days are rebuilt each pass; a thread older than that only changes
  /// when a correction moves it, which asks for a rebuild of its own.
  private let days: Double = 3
  private var task: Task<Void, Never>?
  private var lastPass: Double = 0

  init(database: AppDatabase, location: StoreLocation) {
    self.database = database
    cache = location.claudeSessionCache
  }

  /// Runs a full pass now, then a pass over the last few days every ten minutes.
  ///
  /// The first pass is full because a correction made while the app was closed — a thread split from the command
  /// line, an activity moved — can change days the recent passes never read. With the transcripts cached it costs
  /// about a tenth of a second.
  func start(every seconds: Double = 600) {
    guard task == nil else { return }
    task = Task { [weak self] in
      await self?.pass(full: true)
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(seconds))
        await self?.pass(full: false)
      }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
  }

  /// A pass now, over the last few days, unless one ran in the last few seconds: after an understanding pass that
  /// may have given an activity its thread, and when the palette opens. Waiting for the ten-minute pass left the
  /// palette that far behind the threads.
  func refresh() {
    guard Date().timeIntervalSince1970 - lastPass > 3 else { return }
    pass(full: false)
  }

  func pass(full: Bool) {
    lastPass = Date().timeIntervalSince1970
    let since = full ? 0 : Date().timeIntervalSince1970 - days * 86_400
    let sessions = ClaudeSessionIndex.build(since: full ? 0 : since - 86_400, cache: cache)
    do {
      let report = try builder.rebuild(
        in: database, since: since, readers: ThingReaders.standard(sessions: sessions))
      Log.ui.debug("bindings: \(report.rows, privacy: .public) rows over \(report.things, privacy: .public) things")
    } catch {
      Log.ui.error("binding rebuild failed: \(String(describing: error), privacy: .public)")
    }
  }
}
