import Foundation
import Testing

@testable import ScreencapCore

@Suite struct AppearanceTests {
  @Test func newSettingsFollowTheSystemAndSavedChoicesStay() throws {
    #expect(Settings().appearance == .system)
    let saved = try JSONDecoder().decode(Settings.self, from: Data(#"{"appearance":"Dark"}"#.utf8))
    #expect(saved.appearance == .dark)
  }
}

@Suite struct ResumeSettingsTests {
  /// Settings saved before Resume had a switch open with it on.
  @Test func resumeIsOnUntilTurnedOff() throws {
    let older = try JSONDecoder().decode(Settings.self, from: Data(#"{"appearance":"Dark"}"#.utf8))
    #expect(older.resume.isEnabled)
    var settings = Settings()
    settings.resume.isEnabled = false
    let saved = try JSONDecoder().decode(Settings.self, from: JSONEncoder().encode(settings))
    #expect(!saved.resume.isEnabled)
    #expect(saved.resume.shortcut == nil)
  }

  @Test func aShortcutIsWrittenTheWayMacOSWritesIt() throws {
    let shortcut = Shortcut(keyCode: 15, modifiers: Shortcut.command | Shortcut.option | Shortcut.control, key: "R")
    #expect(shortcut.name == "⌃⌥⌘R")
    #expect(shortcut.keycap == "⌃⌥⌘R")
    let space = Shortcut(keyCode: 49, modifiers: Shortcut.option, key: "Space")
    #expect(space.name == "⌥Space")
    #expect(space.keycap == "⌥space")
    #expect(Shortcut(keyCode: 96, modifiers: Shortcut.shift, key: "F5").keycap == "⇧F5")

    var settings = Settings()
    settings.resume.shortcut = shortcut
    let saved = try JSONDecoder().decode(Settings.self, from: JSONEncoder().encode(settings))
    #expect(saved.resume.shortcut == shortcut)
  }
}
