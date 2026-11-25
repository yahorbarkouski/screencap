import AppKit
import Observation
import ScreencapCore
import SwiftUI

/// The day the canvas shows, the days around it, and the screen that is open over it.
@MainActor
@Observable
final class CanvasModel {
  /// A thing opened over the canvas, at one of its screens.
  struct Opened: Equatable {
    let thread: CanvasThread
    let thing: CanvasThing
    var index: Int
    var shot: CanvasShot { thing.shots[index] }
  }

  /// The shown day; nil while its first read is under way.
  private(set) var day: CanvasDay?
  private(set) var dayStart = Date.distantPast
  /// Every day with activities, newest first.
  private(set) var days: [CanvasDaySummary] = []
  var opened: Opened?
  /// Earlier days stand behind this one, with the ruler beside them.
  private(set) var isStacked = false
  /// What to find on the day; what does not match steps back.
  var find = ""
  var zoomPercent = 100
  @ObservationIgnored weak var view: CanvasView?
  /// What the ruler counts days back from; a drawn film says its own.
  @ObservationIgnored var today: () -> Date = { Date() }
  /// Goes to another day, as the title bar does.
  @ObservationIgnored var go: (Date) -> Void = { _ in }
  @ObservationIgnored private let loader: CanvasLoader
  @ObservationIgnored private var cache: [Date: CanvasDay] = [:]
  @ObservationIgnored private var wanted = Date.distantPast
  @ObservationIgnored private var loading: Task<Void, Never>?

  init(database: AppDatabase, location: StoreLocation) {
    loader = CanvasLoader(database: database, location: location)
  }

  // MARK: Days

  /// Shows `date`'s day: at once when it was read before, and again when a read finds it changed.
  func show(_ date: Date) {
    let start = Calendar.current.startOfDay(for: date)
    if start != dayStart { opened = nil }
    wanted = start
    if let known = cache[start] { set(known, start) }
    loading?.cancel()
    loading = Task {
      await read(start)
      guard !Task.isCancelled, let days = try? await loader.days() else { return }
      if days != self.days { self.days = days }
      for near in neighbours(of: start) where cache[near] == nil && !Task.isCancelled { await read(near) }
    }
  }

  /// Days other than the shown one may have changed (a correction, a merge of threads).
  func forget() { cache = cache.filter { $0.key == dayStart } }

  private func read(_ start: Date) async {
    guard let end = Calendar.current.date(byAdding: .day, value: 1, to: start) else { return }
    do {
      let day = try await loader.day(from: start, to: end)
      if cache.count > 40 { cache = cache.filter { abs($0.key.timeIntervalSince(wanted)) < 8 * 86_400 } }
      cache[start] = day
      if start == wanted { set(day, start) }
    } catch {
      Log.ui.error("canvas failed: \(String(describing: error), privacy: .public)")
    }
  }

  private func set(_ day: CanvasDay, _ start: Date) {
    guard day != self.day || start != dayStart else { return }
    dayStart = start
    self.day = day
  }

  private func neighbours(of start: Date) -> [Date] {
    guard let index = index(of: start) else { return [] }
    return [index + 1, index - 1, index + 2].filter(days.indices.contains).map { date(days[$0]) }
  }

  func date(_ summary: CanvasDaySummary) -> Date { Date(timeIntervalSince1970: summary.start) }

  /// The shown day's place in `days`, or that of the first day before it.
  func index(of date: Date) -> Int? { days.firstIndex { $0.start <= date.timeIntervalSince1970 } }

  /// The shown day and up to four before it, for the stack.
  var behind: [CanvasDaySummary] { Array(days.drop { $0.start >= dayStart.timeIntervalSince1970 }.prefix(4)) }

  /// The nearest day with something on it in a direction: 1 is older.
  func step(_ direction: Int) {
    let at = dayStart.timeIntervalSince1970
    let next = direction > 0 ? days.first { $0.start < at } : days.last { $0.start > at }
    if let next { go(date(next)) }
  }

  func setStacked(_ stacked: Bool) {
    guard stacked != isStacked else { return }
    isStacked = stacked
  }

  // MARK: An open screen

  func open(_ thing: CanvasThing, in thread: CanvasThread, at index: Int) {
    opened = Opened(thread: thread, thing: thing, index: min(max(0, index), thing.shots.count - 1))
  }

  func stepShot(_ offset: Int) {
    guard let opened else { return }
    showShot(opened.index + offset)
  }

  func showShot(_ index: Int) {
    guard let opened else { return }
    let index = min(max(0, index), opened.thing.shots.count - 1)
    if index != opened.index { self.opened?.index = index }
  }

  // MARK: Keys

  /// Whether the key was taken. Keys act at once, without motion.
  func handle(keyCode: UInt16, characters: String?) -> Bool {
    if opened != nil {
      switch keyCode {
      case 123: stepShot(-1)
      case 124: stepShot(1)
      case 49, 53: opened = nil
      default: return false
      }
      return true
    }
    switch keyCode {
    case 123: step(1)
    case 124: step(-1)
    case 49: return view?.openHovered() ?? false
    case 53: return escape()
    default:
      switch characters {
      case "t": setStacked(!isStacked)
      case "0": view?.showWholeDay()
      case "=", "+": view?.zoom(by: 1.5)
      case "-": view?.zoom(by: 1 / 1.5)
      default: return false
      }
    }
    return true
  }

  /// Esc: closes what is open, then goes back to the whole day, then leaves the stack.
  func escape() -> Bool {
    if opened != nil {
      opened = nil
    } else if view?.isWholeDay == false {
      view?.showWholeDay()
    } else if isStacked {
      setStacked(false)
    } else {
      return false
    }
    return true
  }
}
