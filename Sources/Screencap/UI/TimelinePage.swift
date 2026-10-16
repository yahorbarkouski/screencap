import ScreencapCore
import SwiftUI

/// The day as threads side by side, on a page of its own: how it is drawn is set at the top (zoom, how many threads
/// get a column, how close a thread's activities must be to draw as one), the column titles stay pinned, and the
/// settings are remembered.
struct TimelinePage: View {
  @Bindable var model: AppModel
  @AppStorage("timeline.zoom") private var zoom = 2.2
  @AppStorage("timeline.columns") private var columns = 6
  @AppStorage("timeline.merge") private var merge = 5.0
  @State private var position = ScrollPosition(edge: .top)

  var options: TimelineOptions { TimelineOptions(zoom: zoom, columns: columns, mergeMinutes: merge) }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
        controls.padding(.top, 20).padding(.bottom, 6)
        if model.timeline.items.isEmpty {
          Text(model.isToday ? "Nothing captured yet today." : "Nothing was captured on this day.")
            .font(.ui(13.5)).foregroundStyle(Theme.ink6).padding(.top, 14)
        } else {
          Section {
            ParallelTimeline(model: model, options: options).padding(.top, 6)
          } header: {
            ParallelTimeline.Header(model: model, options: options)
              .padding(.top, 10).padding(.bottom, 8)
              .background(Theme.page)
              .overlay(alignment: .bottom) { Rectangle().fill(Theme.hairline).frame(height: 1) }
          }
        }
      }
      .padding(.horizontal, 40).padding(.bottom, 44)
    }
    .scrollPosition($position)
    .scrollContentBackground(.hidden)
    .onChange(of: model.day) { position.scrollTo(edge: .top) }
  }

  var controls: some View {
    HStack(spacing: 18) {
      Text(durationText(model.timeline.activeMinutes)).font(.mono(13)).foregroundStyle(Theme.ink4)
      Spacer()
      setting("Zoom", selection: $zoom, options: [(1.2, "Day"), (2.2, "Hours"), (4.0, "Minutes")])
      setting("Columns", selection: $columns, options: [(4, "4"), (6, "6"), (8, "8")])
      setting("Join gaps under", selection: $merge, options: [(0.0, "Off"), (2.0, "2m"), (5.0, "5m"), (15.0, "15m")])
    }
  }

  func setting<Value: Hashable>(_ label: String, selection: Binding<Value>, options: [(Value, String)]) -> some View {
    HStack(spacing: 8) {
      Text(label).font(.ui(12)).foregroundStyle(Theme.ink5)
      Picker(label, selection: selection) {
        ForEach(options, id: \.0) { value, name in Text(name).tag(value) }
      }
      .pickerStyle(.segmented).labelsHidden().fixedSize()
    }
  }
}
