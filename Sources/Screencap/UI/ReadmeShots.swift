import AppKit
import ScreencapCore
import SwiftUI

/// The README's screenshots: the app on the made-up day (`Screencap demo-store`), dark, each window drawn with its
/// title bar (an offscreen window has none, so `TitleBar` draws the same controls), and the frames of the window's and
/// the popup's GIFs (`ReadmeFrames`). `scripts/readme-shots.py` then frames them and makes the GIFs. Run with
/// `SCREENCAP_README=1 Screencap --store <demo> --view-only --snapshot <dir>`.
@MainActor
enum ReadmeShots {
  /// The Timeline's settings for README renders, in a defaults suite of their own: inside the app bundle the standard
  /// domain is the person's own app, whose Timeline a render must leave as it was.
  static let defaults: UserDefaults = {
    let store = UserDefaults(suiteName: "com.screencaping.readme")!
    store.set(6, forKey: "timeline.columns")
    return store
  }()

  static func run(model: AppModel, to directory: URL) async {
    // Screenshots meant for publishing come only from the made-up day, never from someone's real store.
    guard (try? model.database.meta(DemoStore.mark)) == "1" else {
      FileHandle.standardError.write(Data("README shots render only from a store made by `Screencap demo-store`\n".utf8))
      return
    }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let size = CGSize(width: 1440, height: 900)
    // The whole working day fits the timeline's height.
    defaults.set(1.25, forKey: "timeline.zoom")

    model.section = .day
    model.refresh()
    model.section = .timeline
    await SnapshotRunner.render(ShotWindow(model: model), size: size, to: directory.appendingPathComponent("timeline.png"), dark: true)

    model.section = .day
    if let atlas = model.dayThreads.first, let longest = atlas.activities.max(by: { $0.minutes < $1.minutes }) {
      model.select(longest)
      await SnapshotRunner.render(ShotWindow(model: model), size: size, to: directory.appendingPathComponent("inspector.png"), dark: true)
      model.selectedActivityID = nil
    }

    model.section = .threads
    model.refresh()
    for _ in 0..<60 where model.isLoadingCovers { try? await Task.sleep(for: .milliseconds(250)) }
    await SnapshotRunner.render(ShotWindow(model: model), size: size, to: directory.appendingPathComponent("threads.png"), dark: true)

    // A thread's page: the day's biggest thread.
    if let thread = model.dayThreads.first?.id {
      model.openThreadID = thread
      model.refresh()
      await SnapshotRunner.render(ShotWindow(model: model), size: size, to: directory.appendingPathComponent("thread.png"), dark: true)
      model.openThreadID = nil
    }

    await SnapshotRunner.render(
      OnboardingView(step: .screen, saveKey: { _ in }, finish: {}), size: CGSize(width: 560, height: 520),
      to: directory.appendingPathComponent("onboarding.png"), dark: true)
    await ReadmeFrames.window(model: model, to: directory.appendingPathComponent("window-frames"))
    await ReadmeFrames.popup(model: model, to: directory.appendingPathComponent("popup-frames"))
  }
}

/// The main window as it looks on screen: the title bar's controls above the page.
struct ShotWindow: View {
  let model: AppModel

  var body: some View {
    VStack(spacing: 0) {
      TitleBar(model: model)
      MainView(model: model)
    }
    .background(Theme.page)
    .defaultAppStorage(ReadmeShots.defaults)
  }
}

/// The window buttons, the day (or the way back from a thread), the search box and the sections, as the real title bar
/// draws them.
private struct TitleBar: View {
  let model: AppModel

  var body: some View {
    ZStack {
      HStack(spacing: 4) {
        HStack(spacing: 8) {
          ForEach([0xFF5F57, 0xFEBC2E, 0x28C840], id: \.self) { hex in Circle().fill(Color(hex: UInt32(hex))).frame(width: 12, height: 12) }
        }
        .padding(.trailing, 22)
        if model.openThreadID != nil {
          RoundIconButton(systemName: "chevron.left", size: 24) {}
        } else if model.section != .threads {
          RoundIconButton(systemName: "chevron.left", size: 24) {}
          HStack(spacing: 5) {
            Text(model.day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())).font(.ui(13, .medium)).foregroundStyle(Theme.ink2)
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.ink5)
          }
          .padding(.horizontal, 9)
          RoundIconButton(systemName: "chevron.right", size: 24) {}
        }
        Spacer()
        HStack(spacing: 0) {
          ForEach(MainSection.allCases, id: \.self) { section in
            Text(section.rawValue).font(.ui(12.5, .medium))
              .foregroundStyle(model.section == section ? Theme.onInk : Theme.ink3)
              .padding(.horizontal, 13).frame(height: 26)
              .background { if model.section == section { Capsule().fill(Theme.ink) } }
          }
        }
        .padding(3).background(Capsule().fill(Theme.wash))
      }
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.ink4)
        Text("Search everything you have seen").font(.ui(13.5)).foregroundStyle(Theme.ink5)
        Spacer()
        Text("⌘F").font(.mono(10.5, .semibold)).foregroundStyle(Theme.ink6)
      }
      .padding(.leading, 14).padding(.trailing, 10).frame(width: 520, height: 34)
      .background(Capsule().fill(Theme.wash))
    }
    .padding(.horizontal, 18).frame(height: 52)
    .background(Theme.page)
  }
}
