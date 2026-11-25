import AppKit
import ScreencapCore
import SwiftUI

/// The ruler beside the stack: a line per day, as long as the day was busy. Its middle stands still and days move under
/// it; scrolling travels through them, and a click goes to one.
final class DayRuler: NSView {
  private let model: CanvasModel
  private var days: [CanvasDaySummary] = []
  private var shown = Date.distantPast
  /// Days before today at the middle, and where that is going.
  private var position = 0.0
  private var target = 0.0
  private var slowing = 0.12
  /// Going to a day picked elsewhere, without showing every day on the way.
  private var following = false
  private var link: CADisplayLink?
  private var lastTick: CFTimeInterval = 0
  private var rest: Task<Void, Never>?
  private var peak = 1.0
  private let spacing = 14.0, base = 78.0
  /// Frames are drawn one by one: it moves by `step` and not by the display's clock.
  var isStepped = false
  /// Travels to a day while the ruler moves, lightly.
  var travel: (Date) -> Void = { _ in }

  init(model: CanvasModel) {
    self.model = model
    super.init(frame: .zero)
    wantsLayer = true
  }

  required init?(coder: NSCoder) { nil }

  override var isFlipped: Bool { true }

  private func back(_ start: Double) -> Int {
    let calendar = Calendar.current
    return calendar.dateComponents([.day], from: Date(timeIntervalSince1970: start), to: calendar.startOfDay(for: model.today())).day ?? 0
  }

  private var byBack: [Int: CanvasDaySummary] { Dictionary(days.map { (back($0.start), $0) }) { first, _ in first } }

  func update() {
    if model.days != days {
      days = model.days
      let sorted = days.map(\.captures).sorted()
      peak = Double(sorted.isEmpty ? 1 : max(1, sorted[Int(Double(sorted.count) * 0.9)]))
      needsDisplay = true
    }
    if model.dayStart != shown {
      let first = shown == .distantPast
      shown = model.dayStart
      let here = Double(back(shown.timeIntervalSince1970))
      if first {
        position = here
        target = here
      } else if Int(target.rounded()) != Int(here) {
        target = here
        slowing = 0.12
        following = true
        run()
      }
      needsDisplay = true
    }
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    needsDisplay = true
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { stop() }
  }

  override func draw(_ dirtyRect: NSRect) {
    guard !days.isEmpty, let last = days.last else { return }
    let ink = NSColor(Theme.ink)
    let middle = bounds.midY
    let known = byBack
    let here = back(shown.timeIntervalSince1970)
    let from = max(0, Int((position - middle / spacing).rounded(.down)))
    let to = min(back(last.start), Int((position + middle / spacing).rounded(.up)))
    guard from <= to else { return }
    let mine = middle + (position - Double(here)) * spacing
    text(here == 0 ? "Today" : shown.formatted(.dateTime.day().month(.abbreviated)), .systemFont(ofSize: 11.5, weight: .semibold), ink, at: mine, x: base + 7)
    var lastLabel = -100.0
    for day in from...to {
      let y = middle + (position - Double(day)) * spacing
      let captures = Double(known[day]?.captures ?? 0)
      let weight = captures > 0 ? pow(min(1, captures / peak), 0.8) : 0
      let close = max(0, 1 - abs(y - middle) / 60)
      let alpha = day == here ? 1 : captures > 0 ? 0.22 + 0.4 * weight + 0.2 * close : 0.12
      let length = (captures > 0 ? 5 + weight * 58 : 2) * (1 + 0.2 * close)
      let path = NSBezierPath()
      path.lineWidth = day == here ? 2.5 : 1.5
      path.lineCapStyle = .round
      path.move(to: NSPoint(x: base, y: y))
      path.line(to: NSPoint(x: base - length, y: y))
      ink.withAlphaComponent(alpha).setStroke()
      path.stroke()
      guard let date = Calendar.current.date(byAdding: .day, value: -day, to: Calendar.current.startOfDay(for: model.today())) else { continue }
      let parts = Calendar.current.dateComponents([.day, .weekday], from: date)
      let label = day == 0 ? "Today" : parts.day == 1 ? date.formatted(.dateTime.month(.abbreviated)) : parts.weekday == 2 ? "\(parts.day!)" : ""
      guard !label.isEmpty, abs(y - lastLabel) > 16, abs(y - mine) > 15 else { continue }
      text(label, .monospacedDigitSystemFont(ofSize: 10.5, weight: .medium), ink.withAlphaComponent(label.count > 2 ? 0.85 : 0.5), at: y, x: base + 9)
      lastLabel = y
    }
  }

  private func text(_ string: String, _ font: NSFont, _ color: NSColor, at y: Double, x: Double) {
    let text = NSAttributedString(string: string, attributes: [.font: font, .foregroundColor: color])
    text.draw(at: NSPoint(x: x, y: y - text.size().height / 2))
  }

  // MARK: Travelling

  private func run() {
    guard link == nil, !isStepped else { return }
    if window == nil || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      position = target
      following = false
      needsDisplay = true
      return arrive()
    }
    lastTick = 0
    let link = displayLink(target: self, selector: #selector(tick(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  private func stop() {
    link?.invalidate()
    link = nil
  }

  @objc private func tick(_ link: CADisplayLink) {
    let elapsed = min(0.05, lastTick == 0 ? link.duration : link.timestamp - lastTick)
    lastTick = link.timestamp
    step(elapsed)
  }

  func step(_ elapsed: Double) {
    guard position != target else { return }
    position += (target - position) * (1 - exp(-elapsed / slowing))
    let done = abs(target - position) < 0.002
    if done { position = target }
    needsDisplay = true
    arrive()
    if done {
      following = false
      stop()
    }
  }

  /// Shows the day under the middle; days with nothing on them are passed over.
  private func arrive() {
    guard !following, let day = byBack[Int(position.rounded())], day.start != shown.timeIntervalSince1970 else { return }
    shown = model.date(day)
    travel(shown)
  }

  private func nearest(_ position: Double) -> Double {
    let known = byBack
    let middle = Int(position.rounded())
    for step in 0..<400 {
      if known[middle + step] != nil { return Double(middle + step) }
      if known[middle - step] != nil { return Double(middle - step) }
    }
    return 0
  }

  override func scrollWheel(with event: NSEvent) {
    guard let last = days.last else { return }
    let step = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 14
    scroll(by: step / spacing, upTo: Double(back(last.start)))
    rest?.cancel()
    rest = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(140))
      guard let self, !Task.isCancelled else { return }
      self.land()
    }
  }

  func scroll(by days: Double, upTo last: Double) {
    following = false
    target = min(max(0, target + days), last)
    slowing = 0.08
    run()
  }

  /// Comes to rest on the nearest day with something on it.
  func land() {
    target = nearest(target)
    slowing = 0.12
    run()
  }

  override func mouseDown(with event: NSEvent) {
    let y = convert(event.locationInWindow, from: nil).y
    if let day = byBack[Int(nearest(position + (bounds.midY - y) / spacing))] { model.go(model.date(day)) }
  }
}
