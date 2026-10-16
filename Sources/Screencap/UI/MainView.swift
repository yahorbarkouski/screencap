import ScreencapCore
import SwiftUI

struct MainView: View {
  @Bindable var model: AppModel
  @FocusState private var searchFocused: Bool
  @State private var pickingDay = false
  @Namespace private var segment
  /// The section the toggle's ink capsule sits on. It slides after a click and jumps with ⌘1, ⌘2 and ⌘3, while the page
  /// itself always changes at once.
  @State private var segmentSection: MainSection = .day
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    GeometryReader { geo in
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay {
          if model.expandedCaptureID != nil, let activity = model.selectedActivity {
            Lightbox(model: model, activity: activity)
              .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.97)))
          }
        }
        .onChange(of: model.query) { model.expandedCaptureID = nil }
        // The title bar's band stays opaque, so the toolbar and the pinned day strip read clearly over scrolled pages.
        .overlay(alignment: .top) {
          Theme.page.frame(height: geo.safeAreaInsets.top).offset(y: -geo.safeAreaInsets.top).allowsHitTesting(false)
        }
    }
    .background(Theme.page.ignoresSafeArea())
    .background { shortcuts }
      .toolbar {
        ToolbarItem(placement: .navigation) { navigation }.sharedBackgroundVisibility(.hidden)
        ToolbarItem(placement: .principal) { searchBox.frame(width: 520) }.sharedBackgroundVisibility(.hidden)
        ToolbarItem(placement: .primaryAction) { sectionToggle }.sharedBackgroundVisibility(.hidden)
      }
      .onReceive(NotificationCenter.default.publisher(for: .focusSearch)) { _ in searchFocused = true }
  }

  /// The title bar's leading item: the day and its neighbours on the Day page; on a thread's page the way back, and
  /// the thread's name once its large title has scrolled away.
  @ViewBuilder var navigation: some View {
    if !model.query.isEmpty {
      EmptyView()
    } else if model.section == .day || model.section == .timeline {
      dayNav
    } else if let id = model.openThreadID {
      HStack(spacing: 8) {
        RoundIconButton(systemName: "chevron.left", size: 24) { closeThread() }.help("All threads")
        if model.titleScrolledAway {
          ThreadMark(model: model, threadID: id, size: 18)
          Text(model.threadName(id)).font(.ui(13, .medium)).foregroundStyle(Theme.ink2).lineLimit(1)
            .frame(maxWidth: 240, alignment: .leading)
        }
      }
      .animation(Theme.easeOut, value: model.titleScrolledAway)
    }
  }

  func closeThread() {
    model.openThreadID = nil
    model.selectedActivityID = nil
    model.titleScrolledAway = false
  }

  /// Keys: ⌘1, ⌘2 and ⌘3 switch pages, ⌘[ and ⌘] step through days, Esc clears the search, closes the inspector or
  /// leaves a thread's page.
  var shortcuts: some View {
    Group {
      Button("Day") { show(.day) }.keyboardShortcut("1", modifiers: .command)
      Button("Timeline") { show(.timeline) }.keyboardShortcut("2", modifiers: .command)
      Button("Threads") { show(.threads) }.keyboardShortcut("3", modifiers: .command)
      Button("Previous day") { model.shiftDay(-1) }.keyboardShortcut("[", modifiers: .command)
        .disabled(model.section == .threads || !model.query.isEmpty)
      Button("Next day") { model.shiftDay(1) }.keyboardShortcut("]", modifiers: .command)
        .disabled(model.section == .threads || !model.query.isEmpty || model.isToday)
      Button("Back") {
        if !model.query.isEmpty {
          model.query = ""
        } else if model.selectedActivityID != nil {
          model.selectedActivityID = nil
        } else if model.openThreadID != nil {
          closeThread()
        }
      }
      .keyboardShortcut(.cancelAction)
    }
    .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true)
  }

  func show(_ section: MainSection) {
    model.expandedCaptureID = nil
    model.section = section
    model.openThreadID = nil
    model.query = ""
    model.titleScrolledAway = false
  }

  /// The day shown, with its neighbours a click away and a month to pick from under the date; it sits in the title
  /// bar beside the window buttons.
  var dayNav: some View {
    HStack(spacing: 4) {
      RoundIconButton(systemName: "chevron.left", size: 24) { model.shiftDay(-1) }.help("Previous day  ⌘[")
      Button {
        pickingDay.toggle()
      } label: {
        HStack(spacing: 5) {
          Text(model.day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
            .font(.ui(13, .medium)).foregroundStyle(Theme.ink2)
          Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.ink5)
        }
        .padding(.horizontal, 9).frame(height: 26)
        .background(Capsule().fill(pickingDay ? Theme.washHover : .clear))
        .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .help("Pick a day  ⌘D")
      .keyboardShortcut("d", modifiers: .command)
      .popover(isPresented: $pickingDay, arrowEdge: .bottom) {
        DayPicker(model: model) { day in
          model.go(toDay: day)
          pickingDay = false
        }
      }
      RoundIconButton(systemName: "chevron.right", size: 24) { model.shiftDay(1) }.help("Next day  ⌘]")
        .disabled(model.isToday)
    }
  }

  var searchBox: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.ink4)
      TextField("Search everything you have seen", text: $model.query)
        .textFieldStyle(.plain).font(.ui(13.5)).foregroundStyle(Theme.ink)
        .focused($searchFocused)
        .onSubmit { try? model.runSearch() }
        .onChange(of: model.query) { _, value in
          if value.isEmpty { return }
          try? model.runSearch()
        }
      if model.query.isEmpty {
        Text("⌘F").font(.mono(10.5, .semibold)).foregroundStyle(Theme.ink6)
      } else {
        Button {
          model.query = ""
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.ink6)
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.leading, 14).padding(.trailing, 10)
    .frame(height: 34)
    .background(Capsule().fill(searchFocused ? Theme.washHover : Theme.wash))
  }

  var sectionToggle: some View {
    HStack(spacing: 0) {
      ForEach(MainSection.allCases, id: \.self) { section in
        Text(section.rawValue)
          .font(.ui(12.5, .medium))
          .foregroundStyle(segmentSection == section ? Theme.onInk : Theme.ink3)
          .padding(.horizontal, 13).frame(height: 26)
          .background {
            if segmentSection == section { Capsule().fill(Theme.ink).matchedGeometryEffect(id: "segment", in: segment) }
          }
          .contentShape(Capsule())
          .onTapGesture {
            withAnimation(reduceMotion ? nil : Theme.easeOut) { segmentSection = section }
            show(section)
          }
      }
    }
    .padding(3)
    .background(Capsule().fill(Theme.wash))
    .onAppear { segmentSection = model.section }
    .onChange(of: model.section) { _, section in segmentSection = section }
  }

  @ViewBuilder var content: some View {
    if !model.query.isEmpty {
      SearchView(model: model)
    } else {
      switch model.section {
      case .day:
        HStack(spacing: 0) {
          DayView(model: model).frame(maxWidth: .infinity)
          if let activity = model.selectedActivity {
            Rectangle().fill(Theme.hairline).frame(width: 1)
            InspectorView(model: model, activity: activity).frame(width: 400)
          }
        }
      case .timeline:
        HStack(spacing: 0) {
          TimelinePage(model: model).frame(maxWidth: .infinity)
          if let activity = model.selectedActivity {
            Rectangle().fill(Theme.hairline).frame(width: 1)
            InspectorView(model: model, activity: activity).frame(width: 400)
          }
        }
      case .threads:
        if model.openThreadID != nil {
          HStack(spacing: 0) {
            ThreadDetailView(model: model).frame(maxWidth: .infinity)
            if let activity = model.selectedActivity {
              Rectangle().fill(Theme.hairline).frame(width: 1)
              InspectorView(model: model, activity: activity).frame(width: 400)
            }
          }
        } else {
          ThreadsView(model: model)
        }
      }
    }
  }
}

extension Notification.Name {
  static let focusSearch = Notification.Name("ScreencapFocusSearch")
}
