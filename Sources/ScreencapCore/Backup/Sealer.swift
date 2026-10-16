import CryptoKit
import Foundation

public enum SealError: Error, Equatable {
  case tooShort
  case unknownVersion(UInt8)
  case wrongKey(expected: UInt32, found: UInt32)
}

/// AES-256-GCM per object, with the object's key name as authenticated data so a ciphertext cannot be moved to
/// another name. Layout: version (1 byte), key id (4 bytes), nonce (12), ciphertext, tag (16): 33 bytes of overhead.
public enum Sealer {
  static let version: UInt8 = 1

  public static func seal(_ plaintext: Data, objectKey: String, with key: BackupKey) throws -> Data {
    let box = try AES.GCM.seal(plaintext, using: key.key, authenticating: Data(objectKey.utf8))
    var out = Data([version])
    withUnsafeBytes(of: key.id.bigEndian) { out.append(contentsOf: $0) }
    out.append(contentsOf: box.nonce)
    out.append(box.ciphertext)
    out.append(box.tag)
    return out
  }

  public static func open(_ sealed: Data, objectKey: String, with key: BackupKey) throws -> Data {
    guard sealed.count >= 1 + 4 + 12 + 16 else { throw SealError.tooShort }
    let bytes = [UInt8](sealed)
    guard bytes[0] == version else { throw SealError.unknownVersion(bytes[0]) }
    let keyID = bytes[1..<5].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    guard keyID == key.id else { throw SealError.wrongKey(expected: key.id, found: keyID) }
    let box = try AES.GCM.SealedBox(
      nonce: AES.GCM.Nonce(data: bytes[5..<17]), ciphertext: Data(bytes[17..<(bytes.count - 16)]),
      tag: Data(bytes[(bytes.count - 16)...]))
    return try AES.GCM.open(box, using: key.key, authenticating: Data(objectKey.utf8))
  }
}
