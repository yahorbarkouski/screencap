import Foundation
import Security

/// Generic-password items in the login keychain.
public enum Keychain {
  public static let service = "com.screencaping.app"

  public enum Account: String, Sendable {
    case openRouterKey = "openrouter-api-key"
    case backupSecretKey = "backup-secret-access-key"
    /// The backup encryption key. It stays on this Mac: an iCloud Keychain item needs a keychain entitlement from a
    /// provisioning profile, which the Developer ID build lacks (`errSecMissingEntitlement`). The recovery key moves it.
    case backupEncryptionKey = "backup-encryption-key"
  }

  /// The item's data, or nil when there is no item; any other Keychain failure throws.
  public static func lookup(_ account: Account) throws -> Data? {
    var query = base(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw KeychainError(status: status) }
    return result as? Data
  }

  public static func read(_ account: Account) -> Data? {
    (try? lookup(account)) ?? nil
  }

  public static func readString(_ account: Account) -> String? {
    read(account).flatMap { String(data: $0, encoding: .utf8) }
  }

  public static func store(_ data: Data, for account: Account) throws {
    let query = base(account)
    var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var insert = query
      insert[kSecValueData as String] = data
      insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
      status = SecItemAdd(insert as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw KeychainError(status: status) }
  }

  @discardableResult
  public static func write(_ data: Data, for account: Account) -> Bool {
    (try? store(data, for: account)) != nil
  }

  @discardableResult
  public static func delete(_ account: Account) -> Bool {
    let status = SecItemDelete(base(account) as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
  }

  static func base(_ account: Account) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account.rawValue,
      kSecAttrSynchronizable as String: kCFBooleanFalse!,
    ]
  }
}

public struct KeychainError: Error, CustomStringConvertible {
  public let status: OSStatus

  public var description: String {
    "Keychain error \(status): \(SecCopyErrorMessageString(status, nil) as String? ?? "unknown")"
  }
}
