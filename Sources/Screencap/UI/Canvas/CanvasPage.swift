import AppKit
import ScreencapCore
import SwiftUI

/// The day as one canvas: a block per thread, as large as the time it took, with a picture for each thing it was about.
struct CanvasPage: View {
  @Bindable var model: AppModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.drawnOffscreen) private var drawnOffscreen

  var canvas: CanvasModel { model.canvas }

  var body: some View {
    ZStack(alignment: .bottomTrailing) {
      CanvasSurface(model: model, canvas: canvas)
      if canvas.day?.threads.isEmpty == true { empty.frame(maxWidth: .infinity, maxHeight: .infinity).allowsHitTesting(false) }
      if canvas.opened == nil { tools.padding(16).transition(.opacity) }
      if let opened = canvas.opened {
        CanvasViewer(model: model, opened: opened).transition(.opacity)
      }
    }
    .animation(reduceMotion || NSApp.currentEvent?.type == .keyDown ? nil : Theme.easeOut, value: canvas.opened == nil)
    .onAppear { canvas.show(model.day) }
    .onChange(of: model.day) { canvas.show(model.day) }
    .onChange(of: model.query) { canvas.find = model.query }
  }

  @ViewBuilder var empty: some View {
    Text(
      !model.keptCaptures.isEmpty ? model.unsortedNote : model.isToday ? "Nothing captured yet today." : "Nothing was captured on this day."
    )
    .font(.ui(13.5)).foregroundStyle(Theme.ink6)
  }

  /// Earlier days, and the zoom.
  var tools: some View {
    HStack(spacing: 0) {
      CanvasToolButton(systemName: "clock.arrow.circlepath", isOn: canvas.isStacked) { canvas.setStacked(!canvas.isStacked) }
        .help("Earlier days  T")
      Rectangle().fill(Theme.hairline).frame(width: 1, height: 16).padding(.horizontal, 3)
      CanvasToolButton(systemName: "minus") { canvas.view?.zoom(by: 1 / 1.5) }.help("Zoom out  −")
      Button { canvas.view?.showWholeDay() } label: {
        Text("\(canvas.zoomPercent)%").font(.mono(11)).foregroundStyle(Theme.ink2).frame(width: 46, height: 30).contentShape(Rectangle())
      }
      .buttonStyle(.plain).help("Whole day  0")
      CanvasToolButton(systemName: "plus") { canvas.view?.zoom(by: 1.5) }.help("Zoom in  +")
    }
    .padding(3)
    .background { if drawnOffscreen { Capsule().fill(Theme.page.opacity(0.94)).overlay(Capsule().strokeBorder(Theme.hairline)) } }
    .glassEffect(.regular, in: .capsule)
  }
}

struct CanvasToolButton: View {
  let systemName: String
  var isOn = false
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: systemName).font(.system(size: 13, weight: .medium))
        .foregroundStyle(isOn ? Theme.onInk : Theme.ink2)
        .frame(width: 34, height: 30)
        .background(Capsule().fill(isOn ? Theme.ink : hovering ? Theme.washHover : .clear))
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Theme.hover, value: hovering)
  }
}

private struct DrawnOffscreen: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// Drawn into a picture rather than on screen, where glass has nothing behind it to show.
  var drawnOffscreen: Bool {
    get { self[DrawnOffscreen.self] }
    set { self[DrawnOffscreen.self] = newValue }
  }
}

/// The AppKit canvas and its ruler.
struct CanvasSurface: NSViewRepresentable {
  let model: AppModel
  let canvas: CanvasModel

  func makeNSView(context: Context) -> CanvasContainer {
    canvas.go = { [weak model] date in model?.go(toDay: date) }
    let container = CanvasContainer(canvas: CanvasView(model: canvas, icons: model.icons, location: model.location), ruler: DayRuler(model: canvas))
    container.ruler.travel = { [weak model] date in model?.travel(toDay: date) }
    return container
  }

  func updateNSView(_ container: CanvasContainer, context: Context) {
    // Read here so a change of any of them comes back as an update.
    _ = (canvas.day, canvas.dayStart, canvas.days, canvas.isStacked, canvas.find, canvas.opened, model.icons.sites.count, model.icons.darkGlyphs.count)
    container.update(isStacked: canvas.isStacked && canvas.opened == nil)
  }
}

final class CanvasContainer: NSView {
  let canvas: CanvasView
  let ruler: DayRuler

  init(canvas: CanvasView, ruler: DayRuler) {
    self.canvas = canvas
    self.ruler = ruler
    super.init(frame: .zero)
    addSubview(canvas)
    addSubview(ruler)
    ruler.alphaValue = 0
    ruler.isHidden = true
  }

  required init?(coder: NSCoder) { nil }

  override func layout() {
    super.layout()
    canvas.frame = bounds
    ruler.frame = CGRect(x: bounds.width - CanvasView.ruler, y: 0, width: CanvasView.ruler, height: bounds.height)
  }

  func update(isStacked: Bool) {
    canvas.update()
    ruler.update()
    guard ruler.isHidden == isStacked else { return }
    ruler.isHidden = !isStacked
    ruler.alphaValue = isStacked ? 1 : 0
  }
}

/// Over an open screen: what it is above, the thing's whole day as a film strip below. The screen itself is drawn by
/// the canvas, so it can grow out of its plate.
struct CanvasViewer: View {
  @Bindable var model: AppModel
  let opened: CanvasModel.Opened
  static let top: CGFloat = 56, bottom: CGFloat = 96

  var canvas: CanvasModel { model.canvas }
  var thing: CanvasThing { opened.thing }

  var body: some View {
    VStack(spacing: 0) {
      bar
      Spacer(minLength: 0).allowsHitTesting(false)
      film
    }
  }

  var bar: some View {
    HStack(spacing: 9) {
      if let image = model.icons.image(for: place, app: thing.bundleID) {
        model.icons.icon(image, for: place).frame(width: 18, height: 18).clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
      }
      Text(thing.title).font(.ui(13, .medium)).foregroundStyle(Theme.ink).lineLimit(1).layoutPriority(1)
      Text([thing.place, opened.thread.name].filter { !$0.isEmpty }.joined(separator: "  ·  ")).font(.ui(13)).foregroundStyle(Theme.ink4).lineLimit(1)
      Spacer(minLength: 16)
      Button("Show in Day") { model.showInDay(opened.shot) }.buttonStyle(PillStyle())
      RoundIconButton(systemName: "xmark", size: 28) { canvas.opened = nil }.help("Close  Esc")
    }
    .padding(.horizontal, 20).frame(height: Self.top)
  }

  var place: Place {
    switch thing.icon {
    case .site(let host): .site(host)
    case .app(let bundleID): .app(bundleID)
    }
  }

  var film: some View {
    VStack(spacing: 8) {
      if thing.shots.count > 1 {
        GeometryReader { geo in
          let cells = min(14, thing.shots.count)
          let width = geo.size.width / CGFloat(cells)
          ZStack(alignment: .leading) {
            HStack(spacing: 0) {
              ForEach(0..<cells, id: \.self) { cell in
                let shot = thing.shots[cell * thing.shots.count / cells]
                FilmCell(url: model.location.url(shot.thumbPath), crop: shot.crop).frame(width: width, height: 44).clipped()
              }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline))
            RoundedRectangle(cornerRadius: 1.5).fill(.white).strokeBorder(.black.opacity(0.55), lineWidth: 0.5).frame(width: 4, height: 44)
              .offset(x: (CGFloat(opened.index) + 0.5) / CGFloat(thing.shots.count) * geo.size.width - 2)
          }
          .contentShape(Rectangle())
          .gesture(
            DragGesture(minimumDistance: 0).onChanged { value in
              canvas.showShot(Int(min(max(value.location.x / geo.size.width, 0), 0.9999) * CGFloat(thing.shots.count)))
            })
        }
        .frame(maxWidth: 760).frame(height: 44)
      }
      HStack(spacing: 10) {
        Text(clockText(opened.shot.at)).foregroundStyle(Theme.ink3)
        if thing.shots.count > 1 { Text("\(opened.index + 1) of \(thing.shots.count)").foregroundStyle(Theme.ink5) }
        Text(canvasDuration(thing.seconds)).foregroundStyle(Theme.ink5)
      }
      .font(.mono(11.5))
    }
    .padding(.horizontal, 60).frame(maxWidth: .infinity).frame(height: Self.bottom)
  }
}

private struct FilmCell: View {
  let url: URL
  let crop: ScreenRect?
  @State private var image: NSImage?

  var body: some View {
    Rectangle().fill(Theme.wash)
      .overlay { if let image { Image(nsImage: image).resizable().aspectRatio(contentMode: .fill) } }
      .clipped()
      .task(id: url) { image = await ImageLoader.shared.load(url, maxPixels: 160, crop: crop) }
  }
}
