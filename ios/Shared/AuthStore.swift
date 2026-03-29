import Foundation
import Security

enum AuthStore {
	private static let service = "app.screencap.mobile.identity"
	private static let identityDefaultsKey = "device.identity"
	private static let signKeyAccount = "sign-private-raw"
	private static let dhKeyAccount = "dh-private-raw"

	private static var defaults: UserDefaults {
		AppGroupStore.defaults
	}

	static func loadIdentity() -> DeviceIdentity? {
		guard let data = defaults.data(forKey: identityDefaultsKey) else {
			return nil
		}
		return try? JSONDecoder().decode(DeviceIdentity.self, from: data)
	}

	static func loadKeyMaterial() -> StoredKeyMaterial? {
		guard
			let signData = keychainRead(account: signKeyAccount),
			let dhData = keychainRead(account: dhKeyAccount),
			let signValue = String(data: signData, encoding: .utf8),
			let dhValue = String(data: dhData, encoding: .utf8)
		else {
			return nil
		}

		return StoredKeyMaterial(
			signPrivateKeyRawB64: signValue,
			dhPrivateKeyRawB64: dhValue
		)
	}

	static func save(identity: DeviceIdentity, keys: StoredKeyMaterial) throws {
		let data = try JSONEncoder().encode(identity)
		defaults.set(data, forKey: identityDefaultsKey)
		try keychainWrite(account: signKeyAccount, value: keys.signPrivateKeyRawB64)
		try keychainWrite(account: dhKeyAccount, value: keys.dhPrivateKeyRawB64)
	}

	static func clear() {
		defaults.removeObject(forKey: identityDefaultsKey)
		keychainDelete(account: signKeyAccount)
		keychainDelete(account: dhKeyAccount)
	}

	private static func keychainWrite(account: String, value: String) throws {
		keychainDelete(account: account)
		let status = SecItemAdd([
			kSecClass: kSecClassGenericPassword,
			kSecAttrService: service,
			kSecAttrAccount: account,
			kSecValueData: Data(value.utf8),
		] as CFDictionary, nil)

		guard status == errSecSuccess else {
			throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [
				NSLocalizedDescriptionKey: "Keychain write failed for \(account)",
			])
		}
	}

	private static func keychainRead(account: String) -> Data? {
		var item: CFTypeRef?
		let status = SecItemCopyMatching([
			kSecClass: kSecClassGenericPassword,
			kSecAttrService: service,
			kSecAttrAccount: account,
			kSecReturnData: true,
			kSecMatchLimit: kSecMatchLimitOne,
		] as CFDictionary, &item)

		guard status == errSecSuccess else {
			return nil
		}
		return item as? Data
	}

	private static func keychainDelete(account: String) {
		SecItemDelete([
			kSecClass: kSecClassGenericPassword,
			kSecAttrService: service,
			kSecAttrAccount: account,
		] as CFDictionary)
	}
}
