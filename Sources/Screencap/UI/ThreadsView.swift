import ScreencapCore
import SwiftUI

/// Thread tiles ranked by time over the week ending on the selected day, filterable by category.
struct ThreadsView: View {
  @Bindable var model: AppModel
  @State private var renaming: ActivityThread?
  @State private var newName = ""

  var visibleTiles: [ThreadTile] {
    model.tiles.filter { model.categoryFilter == nil || $0.thread.category == model.categoryFilter }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        Text("Threads").font(.system(size: 24, weight: .medium)).tracking(-0.5).foregroundStyle(Theme.ink)
        Text("\(model.tiles.count) threads active in the week to \(model.day.formatted(.dateTime.month(.abbreviated).day())) · ranked by time")
          .font(.ui(13)).foregroundStyle(Theme.ink5).padding(.top, 6)
        FlowLayout {
          Button("All") { model.categoryFilter = nil }.buttonStyle(PillStyle(prominent: model.categoryFilter == nil))
          ForEach(categories, id: \.self) { category in
            Button(category.rawValue) { model.categoryFilter = category }.buttonStyle(PillStyle(prominent: model.categoryFilter == category))
          }
        }
        .padding(.top, 16)
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: 3), spacing: 14) {
          ForEach(visibleTiles) { tile in
            ThreadTileView(model: model, tile: tile)
              .onTapGesture { openThread(tile.thread) }
              .contextMenu { menu(for: tile.thread) }
          }
        }
        .padding(.top, 22)
      }
      .padding(.init(top: 28, leading: 40, bottom: 40, trailing: 40))
    }
    .alert("Rename thread", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
      TextField("Name", text: $newName)
      Button("Rename") {
        if let id = renaming?.id {
          let name = newName
          model.perform { try $0.rename(threadID: id, to: name) }
        }
        renaming = nil
      }
      Button("Cancel", role: .cancel) { renaming = nil }
    }
  }

  var categories: [ActivityCategory] {
    ActivityCategory.allCases.filter { category in model.tiles.contains { $0.thread.category == category } }
  }

  func openThread(_ thread: ActivityThread) {
    model.openThreadID = thread.id
    model.refresh()
  }

  @ViewBuilder func menu(for thread: ActivityThread) -> some View {
    Button("Rename…") {
      newName = thread.name
      renaming = thread
    }
    Menu("Merge into") {
      ForEach(model.tiles.filter { $0.thread.id != thread.id }) { other in
        Button(other.thread.name) {
          let (absorbed, survivor) = (thread.id!, other.thread.id!)
          model.perform { try await $0.merge(absorbed, into: survivor) }
        }
      }
    }
    Menu("Category") {
      ForEach(ActivityCategory.allCases, id: \.self) { category in
        Button(category.rawValue) {
          let id = thread.id!
          model.perform { try $0.setCategory(threadID: id, to: category) }
        }
      }
    }
  }
}

struct ThreadTileView: View {
  let model: AppModel
  let tile: ThreadTile
  @State private var hovering = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Color.clear.aspectRatio(16 / 9, contentMode: .fit)
        .overlay {
          let cover = model.covers[tile.id] ?? tile.cover
          Screenshot(url: cover.flatMap(model.frameURL), maxPixels: 640, cornerRadius: 12, crop: cover?.window)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      HStack(spacing: 9) {
        ThreadMark(model: model, threadID: tile.thread.id, size: 22)
        Text(tile.thread.name).font(.ui(14, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
        Spacer(minLength: 6)
        Text(durationText(tile.weekMinutes)).font(.mono(12.5)).foregroundStyle(Theme.ink3)
      }
      .padding(.top, 12)
      // When in its latest day it happened, on that day's clock; the day is named unless it is the one selected.
      HStack(spacing: 8) {
        if !Calendar.current.isDate(tile.laneDay, inSameDayAs: model.day) {
          Text(tile.laneDay.formatted(.dateTime.weekday(.abbreviated))).font(.mono(11)).foregroundStyle(Theme.ink5)
        }
        Canvas { context, size in
          context.fill(Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: size.height / 2), with: .color(Theme.wash))
          for activity in tile.lane {
            let left = clockX(activity.startAt, tile.laneSpan, size.width)
            let width = max(3, clockX(activity.endAt, tile.laneSpan, size.width) - left)
            context.fill(
              Path(roundedRect: CGRect(x: left, y: 0, width: width, height: size.height), cornerRadius: 2.5),
              with: .color(Theme.mark(tile.thread.id).foreground))
          }
        }
        .frame(height: 7)
      }
      .frame(height: 14)
      .padding(.top, 10).padding(.bottom, 2)
    }
    .padding(10)
    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(hovering ? Theme.washHover : Theme.wash))
    .onHover { hovering = $0 }
    .animation(Theme.hover, value: hovering)
    .contentShape(Rectangle())
  }
}

/// One thread's activities across days, newest first.
struct ThreadDetailView: View {
  @Bindable var model: AppModel

  var body: some View {
    let thread = model.thread(model.openThreadID)
    let byDay = Dictionary(grouping: model.threadActivities) { Calendar.current.startOfDay(for: Date(timeIntervalSince1970: $0.startAt)) }
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 14) {
          ThreadMark(model: model, threadID: thread?.id, size: 44)
          VStack(alignment: .leading, spacing: 4) {
            Text(thread?.name ?? "").font(.system(size: 24, weight: .medium)).tracking(-0.5).foregroundStyle(Theme.ink)
            Text(durationText(model.threadActivities.map(\.minutes).reduce(0, +))).font(.mono(13)).foregroundStyle(Theme.ink4)
          }
        }
        ForEach(byDay.keys.sorted(by: >), id: \.self) { day in
          VStack(alignment: .leading, spacing: 10) {
            SectionLabel(day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 3), alignment: .leading, spacing: 14) {
              ForEach(byDay[day]!.sorted { $0.startAt > $1.startAt }, id: \.id) { activity in
                MomentView(model: model, moment: Moment(activity: activity, capture: model.representative(of: activity)))
              }
            }
          }
          .padding(.top, 24)
        }
      }
      .padding(.init(top: 28, leading: 40, bottom: 40, trailing: 40))
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    // Past the large title, the title bar shows the thread's name (the way back is always there).
    .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 80 } action: { model.titleScrolledAway = $1 }
    .onChange(of: model.openThreadID) { model.titleScrolledAway = false }
  }
}

/// Search results as an image grid: one screenshot tile per matching activity, newest first.
struct SearchView: View {
  @Bindable var model: AppModel

  var body: some View {
    ScrollView {
      VStack(spacing: 0) {
        Text(model.searchCount == 0 ? "Nothing on screen matched “\(model.query)”." : "\(model.searchCount) moments · newest first")
          .font(.ui(12.5)).foregroundStyle(Theme.ink6).padding(.bottom, 22)
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 22) {
          ForEach(model.searchResults) { result in
            VStack(alignment: .leading, spacing: 0) {
              Screenshot(url: model.thumbURL(result.capture), maxPixels: 640, cornerRadius: 16).aspectRatio(16.0 / 10.0, contentMode: .fit)
              Text(result.activity?.label ?? result.capture.context.windowTitle ?? "").font(.ui(13, .medium)).foregroundStyle(Theme.ink2)
                .lineLimit(2).padding(.top, 8)
              Text("\(result.capture.date.formatted(.dateTime.month(.twoDigits).day(.twoDigits))) · \(clockText(result.capture.at)) · \(result.capture.context.appName ?? "")")
                .font(.ui(12)).foregroundStyle(Theme.ink6).padding(.top, 2)
            }
            .contentShape(Rectangle())
            .onTapGesture { model.open(result: result) }
          }
        }
      }
      .padding(.init(top: 22, leading: 40, bottom: 40, trailing: 40))
    }
  }
}
