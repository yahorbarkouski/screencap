import CryptoKit
import Foundation

/// The backup's 256-bit encryption key.
public struct BackupKey: Sendable {
  public let key: SymmetricKey

  public init(key: SymmetricKey) {
    self.key = key
  }

  /// A short identifier stored with every object, so a restore can tell which key sealed it.
  public var id: UInt32 {
    let digest = SHA256.hash(data: key.withUnsafeBytes { Data($0) })
    return digest.prefix(4).reduce(0) { ($0 << 8) | UInt32($1) }
  }

  /// The key as eight groups of hex digits, for writing down.
  public var recoveryText: String {
    let hex = key.withUnsafeBytes { Data($0) }.map { String(format: "%02x", $0) }.joined()
    return stride(from: 0, to: hex.count, by: 8).map { i -> String in
      let start = hex.index(hex.startIndex, offsetBy: i)
      return String(hex[start..<hex.index(start, offsetBy: 8)])
    }.joined(separator: "-")
  }

  public init?(recoveryText: String) {
    let hex = recoveryText.filter(\.isHexDigit)
    guard hex.count == 64 else { return nil }
    var bytes = [UInt8]()
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    self.init(key: SymmetricKey(data: bytes))
  }
}

public enum BackupKeyError: Error, CustomStringConvertible {
  case bucketHasBackup

  public var description: String {
    "The bucket already holds a backup sealed with another key. Enter its recovery key in Settings."
  }
}

/// Keeps the backup key in this Mac's Keychain. Another Mac gets it from the recovery text.
public enum BackupKeyStore {
  /// The stored key, or nil when this Mac has none. A Keychain failure throws: sealing with a new key would leave
  /// everything sealed with the old one unreadable.
  public static func load() throws -> BackupKey? {
    guard let data = try Keychain.lookup(.backupEncryptionKey) else { return nil }
    guard data.count == 32 else { throw KeychainError(status: errSecDecode) }
    return BackupKey(key: SymmetricKey(data: data))
  }

  /// Stores a key: a new one before the first backup, or one entered from its recovery text.
  public static func save(_ key: BackupKey) throws {
    try Keychain.store(key.key.withUnsafeBytes { Data($0) }, for: .backupEncryptionKey)
  }

  /// The key for backing up into `store`: the stored one, or a new one while the bucket holds no backup. A bucket
  /// that already holds one needs its key first, entered from the recovery text.
  public static func loadOrCreate(for store: any ObjectStore) async throws -> BackupKey {
    if let key = try load() { return key }
    guard try await !store.contains(prefix: "f1/") else { throw BackupKeyError.bucketHasBackup }
    let key = BackupKey(key: SymmetricKey(size: .bits256))
    try save(key)
    return key
  }
}
