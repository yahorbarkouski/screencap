import ScreencapCore
import SwiftUI

/// The selected activity: its screenshots, caption, thread, apps and sites, screen text and corrections.
struct InspectorView: View {
  @Bindable var model: AppModel
  let activity: Activity
  @State private var confirmDelete = false

  var captures: [Capture] { model.captures(of: activity) }

  var selectedCapture: Capture? {
    let all = captures
    return all.first { $0.id == model.selectedCaptureID } ?? (all.isEmpty ? nil : all[all.count / 2])
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        ExpandableScreenshot(model: model, capture: selectedCapture)
        filmstrip.padding(.top, 8)
        if let capture = selectedCapture { PlaceLink(model: model, capture: capture).padding(.top, 10) }
        Text(activity.captionText).font(.ui(15, .medium)).foregroundStyle(Theme.ink).padding(.top, 16)
          .fixedSize(horizontal: false, vertical: true)
        Text("\(clockText(activity.startAt))–\(clockText(activity.endAt)) · \(captures.count) captures")
          .font(.ui(12.5)).foregroundStyle(Theme.ink5).monospacedDigit().padding(.top, 4)
        threadSection.padding(.top, 18)
        appsSection.padding(.top, 18)
        textSection.padding(.top, 18)
        actions.padding(.top, 18)
      }
      .padding(.init(top: 20, leading: 24, bottom: 24, trailing: 24))
    }
    .confirmationDialog("Delete this activity?", isPresented: $confirmDelete) {
      Button("Delete \(captures.count) captures", role: .destructive) {
        let id = activity.id!
        model.selectedActivityID = nil
        model.perform { try $0.delete(activityID: id) }
      }
    } message: {
      Text("Its screenshots and text are removed from this Mac and from the backup.")
    }
  }

  var filmstrip: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(captures.filter { !$0.isDuplicate }, id: \.id) { capture in
          Screenshot(url: model.thumbURL(capture), maxPixels: 200, cornerRadius: 7)
            .frame(width: 54, height: 34)
            .opacity(capture.id == selectedCapture?.id ? 1 : 0.55)
            .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(capture.id == selectedCapture?.id ? Theme.ink : .clear, lineWidth: 1.5))
            .onTapGesture { model.selectedCaptureID = capture.id }
        }
      }
    }
  }

  var threadSection: some View {
    VStack(alignment: .leading, spacing: 6) {
      SectionLabel("Thread")
      HStack(spacing: 6) {
        ThreadChip(threadID: activity.threadID, title: model.threadName(of: activity))
        Menu {
          ForEach(model.threads.values.sorted { $0.lastSeenAt > $1.lastSeenAt }.prefix(30), id: \.id) { thread in
            Button(thread.name) { move(to: thread.id) }
          }
          Divider()
          Button("New thread") { move(to: nil) }
        } label: {
          Text("Move…")
        }
        .menuStyle(.button).buttonStyle(OutlinePillStyle()).fixedSize()
        .disabled(activity.caption == nil)
        .help(activity.caption == nil ? "Available once the activity is described" : "Move to another thread")
        if activity.isThreadProvisional {
          Text("provisional").font(.ui(11.5)).foregroundStyle(Theme.ink6)
        }
      }
    }
  }

  func move(to threadID: Int64?) {
    let id = activity.id!
    model.perform { try await $0.move(activityID: id, to: threadID) }
  }

  /// Where the activity happened, most time first; a site opens the page last seen there, an app opens the app.
  var appsSection: some View {
    let groups = Dictionary(grouping: captures) { $0.context.urlHost ?? $0.context.bundleID ?? $0.context.appName ?? "?" }
    let places = groups.map { key, items in (key: key, last: items.max { $0.at < $1.at }!, minutes: Double(items.count) * (model.settings.current.captureInterval / 60)) }
      .sorted { $0.minutes > $1.minutes }
      .prefix(5)
    return VStack(alignment: .leading, spacing: 2) {
      SectionLabel("Apps and sites")
      ForEach(Array(places), id: \.key) { place in
        PlaceRow(model: model, capture: place.last, minutes: place.minutes)
      }
    }
  }

  @ViewBuilder var textSection: some View {
    let text = selectedCapture.map { CaptureText.excerpt((try? model.database.ocrLines(captureID: $0.id)) ?? [], limit: 700) } ?? ""
    if !text.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        SectionLabel("Text on screen")
        Text(text).font(.ui(12.5)).foregroundStyle(Theme.ink3).lineSpacing(2).textSelection(.enabled)
          .padding(.horizontal, 12).padding(.vertical, 10)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.wash))
      }
    }
  }

  var actions: some View {
    HStack(spacing: 6) {
      Button("Split here") {
        guard let id = activity.id, let capture = selectedCapture?.id else { return }
        model.perform { try $0.split(activityID: id, before: capture) }
      }
      .buttonStyle(PillStyle())
      .disabled(selectedCapture?.id == nil || selectedCapture?.id == activity.firstCaptureID)
      .help("End the activity before the selected screenshot")
      Button("Not this thread") {
        let id = activity.id!
        model.perform { try await $0.notThisThread(activityID: id) }
      }
      .buttonStyle(PillStyle())
      .disabled(activity.threadID == nil || activity.caption == nil)
      Spacer()
      Button("Delete") { confirmDelete = true }.buttonStyle(PillStyle(destructive: true))
    }
  }
}

/// The inspector's screenshot. Clicking it (or Space) shows it over the whole window; under the pointer a corner
/// button says so.
struct ExpandableScreenshot: View {
  let model: AppModel
  let capture: Capture?
  @State private var hovering = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Screenshot(url: capture.flatMap(model.frameURL), maxPixels: 1400, cornerRadius: 14)
      .aspectRatio(16.0 / 10.0, contentMode: .fit)
      .overlay(alignment: .topTrailing) {
        Image(systemName: "arrow.up.left.and.arrow.down.right")
          .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
          .frame(width: 26, height: 26)
          .background(Circle().fill(.black.opacity(0.55)))
          .padding(8)
          .opacity(hovering ? 1 : 0)
      }
      .animation(Theme.hover, value: hovering)
      .contentShape(Rectangle())
      .onHover { hovering = $0 }
      .onTapGesture { withAnimation(reduceMotion ? nil : Theme.easeOut) { model.expand(capture) } }
      .help("Expand  Space")
  }
}

/// Opens what a capture showed: the page at its address, or else its app.
@MainActor
enum PlaceOpener {
  static func url(of capture: Capture) -> URL? {
    guard let host = capture.context.urlHost, !host.isEmpty else { return nil }
    let scheme = PlaceIcons.isPublic(host) ? "https" : "http"
    return URL(string: "\(scheme)://\(host)\(capture.context.urlPath ?? "")")
  }

  static func open(_ capture: Capture) {
    if let url = url(of: capture) {
      NSWorkspace.shared.open(url)
    } else if let bundleID = capture.context.bundleID, let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
      NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration())
    }
  }
}

/// The page or app of the screenshot shown, one click from opening it.
struct PlaceLink: View {
  let model: AppModel
  let capture: Capture
  @State private var hovering = false

  var body: some View {
    let url = PlaceOpener.url(of: capture)
    HStack(spacing: 8) {
      PlaceIcon(icons: model.icons, place: place, app: capture.context.bundleID, size: 16)
      Text(url.map { ($0.host() ?? "") + $0.path() } ?? capture.context.appName ?? "")
        .font(.ui(12.5)).foregroundStyle(hovering ? Theme.ink : Theme.ink3).lineLimit(1).truncationMode(.middle)
      Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.ink5)
    }
    .padding(.horizontal, 10).frame(height: 28)
    .background(Capsule().fill(hovering ? Theme.washHover : Theme.wash))
    .animation(Theme.hover, value: hovering)
    .contentShape(Capsule())
    .onHover { hovering = $0 }
    .onTapGesture { PlaceOpener.open(capture) }
    .help(url == nil ? "Open \(capture.context.appName ?? "the app")" : "Open this page")
  }

  var place: Place? {
    if let host = capture.context.urlHost, !host.isEmpty { return .site(host) }
    return capture.context.bundleID.map { .app($0) }
  }
}

/// One place of an activity: its icon, name and time; clicking opens it.
struct PlaceRow: View {
  let model: AppModel
  let capture: Capture
  let minutes: Double
  @State private var hovering = false

  var body: some View {
    let host = capture.context.urlHost.flatMap { $0.isEmpty ? nil : $0 }
    HStack(spacing: 9) {
      PlaceIcon(icons: model.icons, place: host.map { .site($0) } ?? capture.context.bundleID.map { .app($0) }, app: capture.context.bundleID, size: 18)
        .frame(width: 18, height: 18)
      Text(host ?? capture.context.appName ?? "?").font(.ui(13)).foregroundStyle(Theme.ink2).lineLimit(1)
      if hovering { Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.ink5) }
      Spacer()
      Text(durationText(minutes)).font(.mono(11.5)).foregroundStyle(Theme.ink5)
    }
    .padding(.horizontal, 8).padding(.vertical, 5)
    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(hovering ? Theme.wash : .clear))
    .animation(Theme.hover, value: hovering)
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture { PlaceOpener.open(capture) }
    .padding(.horizontal, -8)
  }
}

