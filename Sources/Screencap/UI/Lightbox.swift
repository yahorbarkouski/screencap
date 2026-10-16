import ScreencapCore
import SwiftUI

/// A screenshot of the selected activity over the whole main window: what it is above, the picture as large as the
/// window allows, the activity's other screenshots below. ← and → step through them, Space or Esc closes
/// (`MainWindowController` routes the keys), and Window / Screen switches between the cut to the window in front and
/// the whole screen when the capture knows where that window was.
struct Lightbox: View {
  @Bindable var model: AppModel
  let activity: Activity
  @AppStorage("lightboxWindowCut") private var windowCut = false

  var body: some View {
    let captures = model.expandableCaptures
    let index = captures.firstIndex { $0.id == model.expandedCaptureID } ?? 0
    VStack(spacing: 0) {
      if captures.indices.contains(index) {
        let capture = captures[index]
        let cut = windowCut && capture.window?.isWorthCropping == true ? capture.window : nil
        bar(capture)
        HStack(spacing: 14) {
          RoundIconButton(systemName: "chevron.left", size: 32) { model.step(-1) }.opacity(index > 0 ? 1 : 0.3).disabled(index == 0)
          FullFrame(url: model.frameURL(capture), crop: cut, neighbours: neighbours(captures, index, cut))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
          RoundIconButton(systemName: "chevron.right", size: 32) { model.step(1) }
            .opacity(index < captures.count - 1 ? 1 : 0.3).disabled(index == captures.count - 1)
        }
        .padding(.horizontal, 16)
        filmstrip(captures, index)
      }
    }
    .background(Theme.page)
    .contentShape(Rectangle())
  }

  func bar(_ capture: Capture) -> some View {
    HStack(spacing: 10) {
      ThreadMark(model: model, threadID: activity.threadID, size: 22)
      Text(model.threadName(of: activity)).font(.ui(13, .medium)).foregroundStyle(Theme.ink2).lineLimit(1).layoutPriority(1)
      Text(activity.label).font(.ui(13)).foregroundStyle(Theme.ink4).lineLimit(1)
      Spacer(minLength: 16)
      if capture.window?.isWorthCropping == true { cutToggle }
      Text(clockText(capture.at)).font(.mono(12)).foregroundStyle(Theme.ink4)
      // Closing is immediate, by click as by key: a fading full-window picture over a changing inspector stuttered.
      RoundIconButton(systemName: "xmark", size: 28) { model.collapse() }
      .help("Close  Esc")
    }
    .padding(.horizontal, 20).frame(height: 56)
  }

  var cutToggle: some View {
    HStack(spacing: 0) {
      ForEach([true, false], id: \.self) { window in
        Text(window ? "Window" : "Screen").font(.ui(12, .medium))
          .foregroundStyle(windowCut == window ? Theme.onInk : Theme.ink3)
          .padding(.horizontal, 11).frame(height: 24)
          .background { if windowCut == window { Capsule().fill(Theme.ink) } }
          .contentShape(Capsule())
          .onTapGesture { windowCut = window }
      }
    }
    .padding(2).background(Capsule().fill(Theme.wash))
  }

  func filmstrip(_ captures: [Capture], _ index: Int) -> some View {
    GeometryReader { geo in
    ScrollViewReader { proxy in
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(Array(captures.enumerated()), id: \.element.id) { i, capture in
            Screenshot(url: model.thumbURL(capture), maxPixels: 200, cornerRadius: 6)
              .frame(width: 60, height: 38)
              .opacity(i == index ? 1 : 0.5)
              .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(i == index ? Theme.ink : .clear, lineWidth: 1.5))
              .id(capture.id)
              .onTapGesture { model.expandedCaptureID = capture.id }
          }
        }
        .padding(.horizontal, 20)
        // Few screenshots sit centred; many scroll, following the one shown.
        .frame(minWidth: geo.size.width, minHeight: geo.size.height)
      }
      .onAppear { proxy.scrollTo(captures[index].id, anchor: .center) }
      .onChange(of: index) { _, now in proxy.scrollTo(captures[now].id, anchor: .center) }
    }
    }
    .frame(height: 74)
  }

  /// The whole screens either side, decoded ahead so stepping shows them at once (a cut differs per screenshot).
  func neighbours(_ captures: [Capture], _ index: Int, _ cut: ScreenRect?) -> [URL] {
    guard cut == nil else { return [] }
    return [index - 1, index + 1].filter(captures.indices.contains).compactMap { model.frameURL(captures[$0]) }
  }
}

/// A frame at the size of the space it has, whole (fit, not fill). The previous picture stays up until the next one is
/// decoded, so stepping never flashes.
struct FullFrame: View {
  let url: URL?
  var crop: ScreenRect?
  var neighbours: [URL] = []
  @State private var image: NSImage?

  static let maxPixels = 2400

  var body: some View {
    ZStack {
      if let image {
        Image(nsImage: image).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
          .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline))
      }
    }
    .task(id: "\(url?.path ?? "") \(crop.map { "\($0)" } ?? "")") {
      guard let url else { return }
      image = await ImageLoader.shared.load(url, maxPixels: Self.maxPixels, crop: crop)
      for next in neighbours { _ = await ImageLoader.shared.load(next, maxPixels: Self.maxPixels, crop: crop) }
    }
  }
}
