import CryptoKit
import Foundation

enum PairingCrypto {
	private static let ed25519Pkcs8Prefix = Data([
		0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
		0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
	])

	private static let ed25519SpkiPrefix = Data([
		0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
		0x70, 0x03, 0x21, 0x00,
	])

	private static let x25519Pkcs8Prefix = Data([
		0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
		0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
	])

	private static let x25519SpkiPrefix = Data([
		0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
		0x6e, 0x03, 0x21, 0x00,
	])

	struct GeneratedKeys {
		let signPublicKeySpkiDerB64: String
		let dhPublicKeySpkiDerB64: String
		let keyMaterial: StoredKeyMaterial
	}

	static func generateKeys() -> GeneratedKeys {
		let signPrivateKey = Curve25519.Signing.PrivateKey()
		let dhPrivateKey = Curve25519.KeyAgreement.PrivateKey()

		let signPrivateRaw = signPrivateKey.rawRepresentation
		let dhPrivateRaw = dhPrivateKey.rawRepresentation
		let signPublicRaw = signPrivateKey.publicKey.rawRepresentation
		let dhPublicRaw = dhPrivateKey.publicKey.rawRepresentation

		return GeneratedKeys(
			signPublicKeySpkiDerB64: (ed25519SpkiPrefix + signPublicRaw).base64EncodedString(),
			dhPublicKeySpkiDerB64: (x25519SpkiPrefix + dhPublicRaw).base64EncodedString(),
			keyMaterial: StoredKeyMaterial(
				signPrivateKeyRawB64: signPrivateRaw.base64EncodedString(),
				dhPrivateKeyRawB64: dhPrivateRaw.base64EncodedString()
			)
		)
	}

	static func signCanonicalString(
		_ canonical: String,
		signPrivateKeyRawB64: String
	) throws -> String {
		let privateKey = try Curve25519.Signing.PrivateKey(
			rawRepresentation: try data(fromBase64: signPrivateKeyRawB64)
		)
		let signature = try privateKey.signature(for: Data(canonical.utf8))
		return signature.base64EncodedString()
	}

	static func sha256Hex(_ data: Data) -> String {
		SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
	}

	static func data(fromBase64 value: String) throws -> Data {
		guard let data = Data(base64Encoded: value) else {
			throw NSError(domain: "PairingCrypto", code: 1, userInfo: [
				NSLocalizedDescriptionKey: "Invalid base64 key payload",
			])
		}
		return data
	}

	static func ed25519PrivateKeyPkcs8DerB64(fromRawB64 value: String) throws -> String {
		let raw = try data(fromBase64: value)
		return (ed25519Pkcs8Prefix + raw).base64EncodedString()
	}

	static func x25519PrivateKeyPkcs8DerB64(fromRawB64 value: String) throws -> String {
		let raw = try data(fromBase64: value)
		return (x25519Pkcs8Prefix + raw).base64EncodedString()
	}
}
