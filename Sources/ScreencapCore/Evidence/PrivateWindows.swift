import Foundation

/// Which browser windows are private (incognito), from what each browser writes into its windows' accessibility
/// attributes (research/private-windows.md). Chromium browsers and Safari add a suffix to the accessibility title only,
/// Firefox adds one to both titles, and Arc and Dia mark the window's accessibility identifier. Markers are matched at
/// the end of the title, so a normal window showing a page titled "Incognito mode explained" is still captured.
public enum PrivateWindows {
  public enum Family: Sendable {
    case chromium, arc, safari, firefox
  }

  public static let browsers: [String: Family] = [
    "com.google.Chrome": .chromium, "com.google.Chrome.beta": .chromium, "com.google.Chrome.dev": .chromium,
    "com.google.Chrome.canary": .chromium, "org.chromium.Chromium": .chromium, "com.brave.Browser": .chromium,
    "com.brave.Browser.beta": .chromium, "com.brave.Browser.nightly": .chromium, "com.microsoft.edgemac": .chromium,
    "com.microsoft.edgemac.Beta": .chromium, "com.microsoft.edgemac.Dev": .chromium, "com.vivaldi.Vivaldi": .chromium,
    "com.operasoftware.Opera": .chromium, "com.operasoftware.OperaGX": .chromium,
    "company.thebrowser.Browser": .arc, "company.thebrowser.dia": .arc,
    "com.apple.Safari": .safari, "com.apple.SafariTechnologyPreview": .safari,
    "org.mozilla.firefox": .firefox, "org.mozilla.firefoxdeveloperedition": .firefox, "org.mozilla.nightly": .firefox,
    "org.mozilla.librewolf": .firefox, "app.zen-browser.zen": .firefox,
  ]

  /// Chromium's accessible-title suffixes for incognito and guest windows (Chrome's translations from its `.xtb`
  /// files, Brave's "Private", Edge's "InPrivate"), English first.
  static let chromiumSuffixes = [
    " (Incognito)", " (Guest)", " (Private)", " (InPrivate)",
    " (anonym)", " (Navigation privée)", " (incógnito)", " (Modo anônimo)", " (инкогнито)", " (시크릿 모드)",
    "（シークレット モード）", "（无痕）", " (Privat)", " (プライベート)",
  ]
  /// Safari's accessible-title suffixes.
  static let safariSuffixes = [", Private Browsing", ", privat surfning"]
  /// Firefox's title suffixes, after " — " (Firefox's `browser-main-private-suffix-for-content` translations).
  static let firefoxSuffixes = [
    "Private Browsing", "Privater Modus", "Navigation privée", "Navigazione anonima", "Tryb prywatny", "Privat surfning",
    "Privénavigatie", "Приватный просмотр", "プライベートブラウジング",
  ]

  /// Whether a window of the app `bundleID` is private, from its accessibility title and identifier and its window
  /// server name. Apps outside `browsers` never are.
  public static func isPrivate(bundleID: String?, title: String?, identifier: String? = nil, windowName: String? = nil) -> Bool {
    guard let bundleID, let family = browsers[bundleID] else { return false }
    let titles = [title, windowName].compactMap { $0?.trimmingCharacters(in: .whitespaces) }
    switch family {
    case .chromium:
      return titles.contains { title in chromiumSuffixes.contains { title.hasSuffix($0) } }
    case .arc:
      return identifier?.localizedCaseInsensitiveContains("incognito") ?? false
    case .safari:
      return titles.contains { title in safariSuffixes.contains { title.lowercased().hasSuffix($0.lowercased()) } }
    case .firefox:
      return titles.contains { title in firefoxSuffixes.contains { title.hasSuffix(" — \($0)") || title == $0 } }
    }
  }
}
