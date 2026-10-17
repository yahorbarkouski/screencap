import AppKit
import ScreencapCore

/// Brings one kind of place back to the front.
///
/// The mirror of `ThingReader`: a reader says what a capture was looking at, a driver puts that place in front
/// again. They are apart because reading happens over stored captures, with no windows involved, while driving
/// needs AppKit, Accessibility and Apple Events. Adding an app means writing one of each.
@MainActor
protocol ThingDriver {
  /// Whether this driver knows how to reach that place.
  func handles(_ thing: Thing) -> Bool
  func bring(_ thing: Thing) -> WindowIndex.Outcome
  /// Opens a place that is not open any more.
  func reopen(_ thing: Thing) -> WindowIndex.Outcome
  /// What to say about an outcome that left the place out of reach, when the outcome's name is not enough.
  func note(for outcome: WindowIndex.Outcome) -> String?
}

extension ThingDriver {
  func reopen(_ thing: Thing) -> WindowIndex.Outcome { .unsupported }
}

/// The drivers, asked in order.
@MainActor
struct ThingDrivers {
  let drivers: [any ThingDriver]

  static let standard = ThingDrivers(drivers: [BrowserDriver(), ClaudeDriver(), WindowDriver()])

  func driver(for thing: Thing) -> (any ThingDriver)? {
    drivers.first { $0.handles(thing) }
  }

  /// Puts a place in front, opening it again when it is not open any more.
  ///
  /// Coming back to a thread means coming back to all of it. A page you closed is still part of the work, and
  /// opening it costs a tab; it is the places that cannot be opened — a conversation inside an app — that are
  /// reported instead.
  func bring(_ thing: Thing) -> (outcome: WindowIndex.Outcome, note: String?) {
    guard let driver = driver(for: thing) else { return (.unsupported, nil) }
    var outcome = driver.bring(thing)
    if outcome == .missing { outcome = driver.reopen(thing) }
    let settled: Set<WindowIndex.Outcome> = [.brought, .opened]
    return (outcome, settled.contains(outcome) ? nil : driver.note(for: outcome))
  }

  func reopen(_ thing: Thing) -> WindowIndex.Outcome {
    driver(for: thing)?.reopen(thing) ?? .unsupported
  }
}

extension ThingDriver {
  func note(for outcome: WindowIndex.Outcome) -> String? { nil }
}
