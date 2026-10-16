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
