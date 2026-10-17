import Foundation

/// User settings, stored in the app's defaults domain. Secrets live in the Keychain.
public struct Settings: Sendable, Equatable, Codable {
  /// Seconds between timer captures.
  public var captureInterval: Double = 60
  /// Remove screenshots from every model call; titles, URLs and OCR text still go.
  public var textOnlyMode = false
  /// Apps whose windows are removed from every frame and whose moments are never captured.
  public var excludedBundleIDs: [String] = []
  public var backup = BackupSettings()
  /// The app's look: the system's light or dark unless the person picks one.
  public var appearance = Appearance.system
  /// Site icons are fetched from each site (`https://host/favicon.ico`) when a thread first shows; off shows the
  /// browser's icon and sends nothing.
  public var fetchesSiteIcons = true
  /// What AI agents may read through `Screencap mcp`.
  public var agents = AgentSettings()
  public var resume = ResumeSettings()

  public init() {}

  /// Missing keys keep their defaults, so settings saved by an older build still load.
  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let defaults = Settings()
    captureInterval = try c.decodeIfPresent(Double.self, forKey: .captureInterval) ?? defaults.captureInterval
    textOnlyMode = try c.decodeIfPresent(Bool.self, forKey: .textOnlyMode) ?? defaults.textOnlyMode
    excludedBundleIDs = try c.decodeIfPresent([String].self, forKey: .excludedBundleIDs) ?? defaults.excludedBundleIDs
    backup = try c.decodeIfPresent(BackupSettings.self, forKey: .backup) ?? defaults.backup
    appearance = try c.decodeIfPresent(Appearance.self, forKey: .appearance) ?? defaults.appearance
    fetchesSiteIcons = try c.decodeIfPresent(Bool.self, forKey: .fetchesSiteIcons) ?? defaults.fetchesSiteIcons
    agents = try c.decodeIfPresent(AgentSettings.self, forKey: .agents) ?? defaults.agents
    resume = try c.decodeIfPresent(ResumeSettings.self, forKey: .resume) ?? defaults.resume
  }

  /// Password managers are always excluded. Settings asks people to add theirs when it is missing here.
  public static let alwaysExcludedBundleIDs: Set<String> = [
    "com.1password.1password", "com.agilebits.onepassword7", "com.bitwarden.desktop", "com.apple.keychainaccess",
    "com.apple.Passwords", "com.lastpass.LastPass", "com.dashlane.Dashlane", "com.dashlane.dashlanephonefinal",
    "org.keepassxc.keepassxc", "com.keepassium.ios", "in.sinew.Enpass-Desktop", "me.proton.pass.electron",
    "com.markmcguill.strongbox.mac", "com.markmcguill.strongbox", "com.hicknhacksoftware.MacPass", "com.nordsec.nordpass",
    "com.keepersecurity.passwordmanager", "com.outercorner.Secrets", "com.siber.RoboForm",
  ]

  public var allExcludedBundleIDs: Set<String> {
    Self.alwaysExcludedBundleIDs.union(excludedBundleIDs)
  }
}

/// Resume, the thread switcher.
public struct ResumeSettings: Sendable, Equatable, Codable {
  /// Off, the shortcut opens nothing and the places each thread was worked in stop being worked out.
  public var isEnabled = true
  /// What opens the palette; nil is ⌥Space.
  public var shortcut: Shortcut?

  public init() {}

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let defaults = ResumeSettings()
    isEnabled = try c.decodeIfPresent(Bool.self, forKey: .isEnabled) ?? defaults.isEnabled
    shortcut = try c.decodeIfPresent(Shortcut.self, forKey: .shortcut)
  }
}

/// A key held with modifiers, in the form the system's hot keys take.
public struct Shortcut: Sendable, Equatable, Codable {
  /// The virtual key code, as Carbon's `kVK_*` constants name it.
  public var keyCode: UInt32
  /// Carbon's modifier flags, `cmdKey` and the rest, which are the values below.
  public var modifiers: UInt32
  /// The key as its keycap shows it: "Space", "R", "F5", "←".
  public var key: String

  public static let command: UInt32 = 0x100
  public static let shift: UInt32 = 0x200
  public static let option: UInt32 = 0x800
  public static let control: UInt32 = 0x1000

  public init(keyCode: UInt32, modifiers: UInt32, key: String) {
    self.keyCode = keyCode
    self.modifiers = modifiers
    self.key = key
  }

  /// The modifiers in the order macOS writes them, then the key: "⌃⌥R", "⌥Space".
  public var name: String {
    let symbols: [(UInt32, String)] = [(Self.control, "⌃"), (Self.option, "⌥"), (Self.shift, "⇧"), (Self.command, "⌘")]
    return symbols.filter { modifiers & $0.0 != 0 }.map(\.1).joined() + key
  }

  /// The same, with a key that is a word in lower case, as the palette's keycaps write it: "⌥space".
  public var keycap: String {
    let word = key.count > 1 && key.allSatisfy(\.isLetter)
    return String(name.dropLast(key.count)) + (word ? key.lowercased() : key)
  }
}

/// In the order Settings shows them, as macOS lists its own appearance choices.
public enum Appearance: String, Sendable, Equatable, Codable, CaseIterable {
  case system = "System"
  case light = "Light"
  case dark = "Dark"
}

/// Where the backup goes. The named providers build their endpoint from one value, the region or the account;
/// `other` takes any S3-compatible endpoint.
public enum BackupProvider: String, Sendable, Equatable, Codable, CaseIterable {
  case amazonS3 = "Amazon S3"
  case cloudflareR2 = "Cloudflare R2"
  case backblazeB2 = "Backblaze B2"
  case other = "Other"

  /// The provider an endpoint belongs to, for settings saved by builds that stored only the endpoint.
  init(endpoint: String) {
    let host = URL(string: endpoint)?.host() ?? ""
    if host.hasSuffix(".amazonaws.com") {
      self = .amazonS3
    } else if host.hasSuffix(".r2.cloudflarestorage.com") {
      self = .cloudflareR2
    } else if host.hasSuffix(".backblazeb2.com") {
      self = .backblazeB2
    } else {
      self = .other
    }
  }
}

public struct BackupSettings: Sendable, Equatable, Codable {
  public var isEnabled = false
  public var provider = BackupProvider.amazonS3
  /// Cloudflare's account ID, for R2.
  public var accountID = ""
  /// Used as it is for `other`, for example a MinIO server.
  public var endpoint = ""
  public var bucket = ""
  /// The bucket's region, such as `eu-central-1` on Amazon S3 or `us-west-004` on Backblaze B2.
  public var region = "us-east-1"
  public var accessKeyID = ""

  public init() {}

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let defaults = BackupSettings()
    isEnabled = try c.decodeIfPresent(Bool.self, forKey: .isEnabled) ?? defaults.isEnabled
    endpoint = try c.decodeIfPresent(String.self, forKey: .endpoint) ?? defaults.endpoint
    bucket = try c.decodeIfPresent(String.self, forKey: .bucket) ?? defaults.bucket
    region = try c.decodeIfPresent(String.self, forKey: .region) ?? defaults.region
    accessKeyID = try c.decodeIfPresent(String.self, forKey: .accessKeyID) ?? defaults.accessKeyID
    accountID = try c.decodeIfPresent(String.self, forKey: .accountID) ?? defaults.accountID
    if let provider = try c.decodeIfPresent(BackupProvider.self, forKey: .provider) {
      self.provider = provider
    } else if endpoint.isEmpty {
      region = defaults.region
    } else {
      provider = BackupProvider(endpoint: endpoint)
      if provider == .cloudflareR2 { accountID = URL(string: endpoint)?.host()?.split(separator: ".").first.map(String.init) ?? "" }
    }
  }

  /// The endpoint requests go to. Accounts and regions keep only letters, digits and hyphens, so they cannot point
  /// the host anywhere else.
  public var resolvedEndpoint: String {
    let account = Self.label(accountID)
    let region = Self.label(region)
    switch provider {
    case .amazonS3: return region.isEmpty ? "" : "https://s3.\(region).amazonaws.com"
    case .cloudflareR2: return account.isEmpty ? "" : "https://\(account).r2.cloudflarestorage.com"
    case .backblazeB2: return region.isEmpty ? "" : "https://s3.\(region).backblazeb2.com"
    case .other: return endpoint.trimmingCharacters(in: .whitespaces)
    }
  }

  /// The region requests are signed for: R2 takes `auto`.
  public var signingRegion: String { provider == .cloudflareR2 ? "auto" : Self.label(region) }

  /// The endpoint as a URL when it is safe to send to: HTTPS, or plain HTTP only to this Mac (a local MinIO).
  public var endpointURL: URL? {
    guard let url = URL(string: resolvedEndpoint), let host = url.host(), !host.isEmpty else { return nil }
    switch url.scheme?.lowercased() {
    case "https": return url
    case "http": return ["localhost", "127.0.0.1", "::1"].contains(host) ? url : nil
    default: return nil
    }
  }

  public var isConfigured: Bool { endpointURL != nil && !bucket.isEmpty && !accessKeyID.isEmpty }

  static func label(_ text: String) -> String {
    text.lowercased().filter { ($0.isASCII && ($0.isLetter || $0.isNumber)) || $0 == "-" }
  }
}

/// Reads and writes `Settings` as one JSON value in user defaults.
public final class SettingsStore: @unchecked Sendable {
  private let defaults: UserDefaults
  private let key = "settings.v1"
  private let lock = NSLock()

  /// Inside the app bundle the standard domain is the bundle identifier, `com.screencaping.app`.
  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public var current: Settings {
    lock.withLock {
      guard let data = defaults.data(forKey: key), let value = try? JSONDecoder().decode(Settings.self, from: data)
      else { return Settings() }
      return value
    }
  }

  public func update(_ change: (inout Settings) -> Void) {
    lock.withLock {
      var value =
        (defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Settings.self, from: $0) }) ?? Settings()
      change(&value)
      if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }
  }
}
