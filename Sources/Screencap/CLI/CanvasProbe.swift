import AppKit
import ScreencapCore

/// Drives the real canvas in a window that is never shown, over a store, and prints what each gesture did and what a
/// frame of zooming costs. The pointer and the screen stay with the person using the Mac.
@MainActor
enum CanvasProbe {
  static func run(location: StoreLocation, day: Date?) async throws {
    let database = try location.openDatabase()
    let model = AppModel(database: database, location: location, settings: SettingsStore())
    if let day {
      model.day = Calendar.current.startOfDay(for: day)
    } else if let last = try database.focusedCaptures(before: .greatestFiniteMagnitude, count: 1).last {
      model.day = Calendar.current.startOfDay(for: last.date)
    }
    let canvas = model.canvas
    canvas.go = { date in
      model.day = Calendar.current.startOfDay(for: date)
      canvas.show(model.day)
    }
    let view = CanvasView(model: canvas, icons: model.icons, location: location)
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 848), styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = view
    view.layoutSubtreeIfNeeded()
    canvas.show(model.day)
    for _ in 0..<120 where canvas.day == nil || canvas.days.isEmpty { try await Task.sleep(for: .milliseconds(100)) }
    view.update()
    try await Task.sleep(for: .seconds(1))

    var failures = 0
    func check(_ name: String, _ passed: Bool, _ detail: String = "") {
      if !passed { failures += 1 }
      print("\(passed ? "ok  " : "FAIL") \(name)\(detail.isEmpty ? "" : "  \(detail)")")
    }
    func mouse(_ type: NSEvent.EventType, _ point: CGPoint, clicks: Int = 1, at time: TimeInterval = 0) -> NSEvent {
      NSEvent.mouseEvent(
        with: type, location: view.convert(point, to: nil), modifierFlags: [], timestamp: time, windowNumber: window.windowNumber, context: nil,
        eventNumber: 0, clickCount: clicks, pressure: 1)!
    }
    func click(_ point: CGPoint, clicks: Int = 1) {
      view.mouseDown(with: mouse(.leftMouseDown, point, clicks: clicks))
      view.mouseUp(with: mouse(.leftMouseUp, point, clicks: clicks))
      view.update()
    }
    func settle() async throws { try await Task.sleep(for: .milliseconds(700)) }

    let plates = view.probePlates
    check("the whole day is in view", plates.allSatisfy { view.bounds.contains($0) }, "\(plates.count) pictures at \(canvas.zoomPercent)%")
    let wholeDay = view.probeState.camera

    if let index = plates.indices.first {
      let plate = plates[index]
      view.mouseMoved(with: mouse(.mouseMoved, CGPoint(x: plate.minX + plate.width * 0.1, y: plate.midY)))
      let early = view.probeState
      try await settle()
      view.mouseMoved(with: mouse(.mouseMoved, CGPoint(x: plate.minX + plate.width * 0.9, y: plate.midY)))
      let late = view.probeState
      check("the pointer skims a picture", early.skimming != nil && late.shown != early.shown, "screens \(early.shown ?? -1) then \(late.shown ?? -1)")
      check("space opens what is under the pointer", canvas.handle(keyCode: 49, characters: " "))
      view.update()
      check("it opens at the screen shown", view.probeState.opened != nil && canvas.opened?.index == late.shown)
      _ = canvas.handle(keyCode: 123, characters: nil)
      check("the arrows step through it", canvas.opened?.index == (late.shown ?? 1) - 1)
      _ = canvas.handle(keyCode: 53, characters: nil)
      view.update()
      check("escape closes it", view.probeState.opened == nil)
      view.mouseExited(with: mouse(.mouseMoved, .zero))
      click(CGPoint(x: plate.midX, y: plate.midY))
      check("a click opens it", view.probeState.opened != nil)
      click(CGPoint(x: 4, y: 4))
      check("a click beside it closes it", view.probeState.opened == nil)
    }

    view.mouseDown(with: mouse(.leftMouseDown, CGPoint(x: 700, y: 800)))
    for step in 1...10 { view.mouseDragged(with: mouse(.leftMouseDragged, CGPoint(x: 700 - Double(step) * 10, y: 800 - Double(step) * 5), at: Double(step) / 60)) }
    let dragged = view.probeState.camera
    view.mouseUp(with: mouse(.leftMouseUp, CGPoint(x: 600, y: 750), at: 5))
    check("a drag moves the canvas with the pointer", abs(dragged.x - wholeDay.x + 100) < 1 && abs(dragged.y - wholeDay.y + 50) < 1)
    view.showWholeDay()
    try await settle()
    check("0 goes back to the whole day", view.probeState.camera == wholeDay)

    if let name = view.probeNames.first {
      click(CGPoint(x: name.midX, y: name.maxY - 4))
      try await settle()
      check("a thread's name brings it close", canvas.zoomPercent > Int(wholeDay.zoom * 130), "\(canvas.zoomPercent)%")
    }
    _ = canvas.handle(keyCode: 53, characters: nil)
    try await settle()

    canvas.setStacked(true)
    view.update()
    try await settle()
    check("the stack shows the days before", view.probeState.cards == min(4, canvas.behind.count), "\(view.probeState.cards) cards")
    let day = canvas.dayStart
    if let next = canvas.behind.first {
      click(CGPoint(x: view.bounds.midX + CanvasView.sheetShift, y: CanvasView.sheetTop - CanvasView.cardStep / 2))
      for _ in 0..<40 where canvas.dayStart == day { try await Task.sleep(for: .milliseconds(50)) }
      view.update()
      check("a card goes to its day", canvas.dayStart == canvas.date(next))
      _ = canvas.handle(keyCode: 124, characters: nil)
      for _ in 0..<40 where canvas.dayStart != day { try await Task.sleep(for: .milliseconds(50)) }
      view.update()
      check("the arrows step between days", canvas.dayStart == day)
    }
    canvas.setStacked(false)
    view.update()
    try await settle()

    canvas.find = canvas.day?.threads.last?.things.first.map { String($0.title.prefix(5)) } ?? "a"
    view.update()
    view.showNextFound()
    check("find goes to a match", view.probeState.camera != wholeDay)
    canvas.find = ""
    view.update()

    // What one frame of zooming costs: every name and caption placed again.
    view.showWholeDay()
    try await settle()
    var times: [Double] = []
    for step in 0..<120 {
      let started = CACurrentMediaTime()
      view.zoom(by: step < 60 ? 1.02 : 1 / 1.02)
      view.layer?.displayIfNeeded()
      CATransaction.flush()
      times.append((CACurrentMediaTime() - started) * 1000)
      try await Task.sleep(for: .milliseconds(8))
    }
    times.sort()
    print(String(format: "a frame of zooming: median %.1f ms, 95th %.1f ms, worst %.1f ms", times[60], times[114], times[119]))
    print(failures == 0 ? "all passed" : "\(failures) failed")
    if failures > 0 { exit(1) }
  }
}
