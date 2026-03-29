import Foundation
import Security

enum AuthStore {
	private static let service = "app.screencap.mobile.identity"
	private static let identityDefaultsKey = "device.identity"
	private static let signKeyAccount = "sign-private-raw"
	private static let dhKeyAccount = "dh-private-raw"
	private static let sharedAccessGroupSuffix = ".app.screencap.mobile.shared"
	private static let keychainAccessGroupsEntitlement = "keychain-access-groups"
	private static var cachedSharedAccessGroup: String?

	enum SignedRequestCredentials {
		case available(DeviceIdentity, StoredKeyMaterial)
		case missingIdentity
		case missingKeyMaterial
	}

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
		if
			let accessGroup = sharedAccessGroup(),
			let sharedKeys = readKeyMaterial(accessGroup: accessGroup)
		{
			return sharedKeys
		}

		guard let legacyKeys = readKeyMaterial(accessGroup: nil) else {
			return nil
		}

		migrateLegacyKeyMaterialIfNeeded(using: legacyKeys)
		return legacyKeys
	}

	static func loadSignedRequestCredentials() -> SignedRequestCredentials {
		guard let identity = loadIdentity() else {
			return .missingIdentity
		}
		guard let keys = loadKeyMaterial() else {
			return .missingKeyMaterial
		}
		return .available(identity, keys)
	}

	static func signedRequestCredentialsDescription() -> String {
		switch loadSignedRequestCredentials() {
		case .available:
			return "available"
		case .missingIdentity:
			return "missingIdentity"
		case .missingKeyMaterial:
			return "missingKeyMaterial"
		}
	}

	static func save(identity: DeviceIdentity, keys: StoredKeyMaterial) throws {
		let data = try JSONEncoder().encode(identity)
		defaults.set(data, forKey: identityDefaultsKey)
		try storeKeyMaterial(keys)
	}

	static func migrateLegacyKeyMaterialIfNeeded() {
		guard let legacyKeys = readKeyMaterial(accessGroup: nil) else {
			return
		}
		migrateLegacyKeyMaterialIfNeeded(using: legacyKeys)
	}

	static func clear() {
		defaults.removeObject(forKey: identityDefaultsKey)
		keychainDelete(account: signKeyAccount, accessGroup: sharedAccessGroup())
		keychainDelete(account: dhKeyAccount, accessGroup: sharedAccessGroup())
		keychainDelete(account: signKeyAccount, accessGroup: nil)
		keychainDelete(account: dhKeyAccount, accessGroup: nil)
	}

	private static func storeKeyMaterial(_ keys: StoredKeyMaterial) throws {
		if let accessGroup = sharedAccessGroup() {
			try keychainWrite(
				account: signKeyAccount,
				value: keys.signPrivateKeyRawB64,
				accessGroup: accessGroup
			)
			try keychainWrite(
				account: dhKeyAccount,
				value: keys.dhPrivateKeyRawB64,
				accessGroup: accessGroup
			)
			return
		}

		try keychainWrite(account: signKeyAccount, value: keys.signPrivateKeyRawB64, accessGroup: nil)
		try keychainWrite(account: dhKeyAccount, value: keys.dhPrivateKeyRawB64, accessGroup: nil)
	}

	private static func migrateLegacyKeyMaterialIfNeeded(using keys: StoredKeyMaterial) {
		guard let accessGroup = sharedAccessGroup() else {
			return
		}
		guard readKeyMaterial(accessGroup: accessGroup) == nil else {
			return
		}
		try? keychainWrite(
			account: signKeyAccount,
			value: keys.signPrivateKeyRawB64,
			accessGroup: accessGroup
		)
		try? keychainWrite(
			account: dhKeyAccount,
			value: keys.dhPrivateKeyRawB64,
			accessGroup: accessGroup
		)
	}

	private static func readKeyMaterial(accessGroup: String?) -> StoredKeyMaterial? {
		guard
			let signData = keychainRead(account: signKeyAccount, accessGroup: accessGroup),
			let dhData = keychainRead(account: dhKeyAccount, accessGroup: accessGroup),
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

	private static func sharedAccessGroup() -> String? {
		if let cachedSharedAccessGroup {
			return cachedSharedAccessGroup
		}
		guard let task = SecTaskCreateFromSelf(nil) else {
			return nil
		}
		guard
			let value = SecTaskCopyValueForEntitlement(
				task,
				keychainAccessGroupsEntitlement as CFString,
				nil
			) as? [String]
		else {
			return nil
		}
		let accessGroup =
			value.first(where: { $0.hasSuffix(sharedAccessGroupSuffix) })
			?? value.first
		cachedSharedAccessGroup = accessGroup
		return accessGroup
	}

	private static func keychainWrite(
		account: String,
		value: String,
		accessGroup: String?
	) throws {
		keychainDelete(account: account, accessGroup: accessGroup)
		var query = baseKeychainQuery(account: account, accessGroup: accessGroup)
		query[kSecValueData] = Data(value.utf8)
		let status = SecItemAdd(query as CFDictionary, nil)

		guard status == errSecSuccess else {
			throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [
				NSLocalizedDescriptionKey: "Keychain write failed for \(account)",
			])
		}
	}

	private static func keychainRead(account: String, accessGroup: String?) -> Data? {
		var item: CFTypeRef?
		var query = baseKeychainQuery(account: account, accessGroup: accessGroup)
		query[kSecReturnData] = true
		query[kSecMatchLimit] = kSecMatchLimitOne
		let status = SecItemCopyMatching(query as CFDictionary, &item)

		guard status == errSecSuccess else {
			return nil
		}
		return item as? Data
	}

	private static func keychainDelete(account: String, accessGroup: String?) {
		SecItemDelete(baseKeychainQuery(account: account, accessGroup: accessGroup) as CFDictionary)
	}

	private static func baseKeychainQuery(
		account: String,
		accessGroup: String?
	) -> [CFString: Any] {
		var query: [CFString: Any] = [
			kSecClass: kSecClassGenericPassword,
			kSecAttrService: service,
			kSecAttrAccount: account,
		]
		if let accessGroup {
			query[kSecAttrAccessGroup] = accessGroup
		}
		return query
	}
}
