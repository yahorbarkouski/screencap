import { getDatabase, isDbOpen } from "../connection";

export type StoredMobilePairedDevice = {
	deviceId: string;
	deviceName: string | null;
	platform: "ios";
	signPubKeySpkiDerB64: string;
	dhPubKeySpkiDerB64: string;
	addedAt: number;
	lastSeenAt: number | null;
};

type MobilePairedDeviceRow = {
	device_id: string;
	device_name: string | null;
	platform: "ios";
	sign_pub_key_spki_der_b64: string;
	dh_pub_key_spki_der_b64: string;
	added_at: number;
	last_seen_at: number | null;
};

function rowToDevice(
	row: MobilePairedDeviceRow | undefined,
): StoredMobilePairedDevice | null {
	if (!row) return null;
	return {
		deviceId: row.device_id,
		deviceName: row.device_name,
		platform: row.platform,
		signPubKeySpkiDerB64: row.sign_pub_key_spki_der_b64,
		dhPubKeySpkiDerB64: row.dh_pub_key_spki_der_b64,
		addedAt: row.added_at,
		lastSeenAt: row.last_seen_at,
	};
}

export function listMobilePairedDevices(): StoredMobilePairedDevice[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const rows = db
		.prepare(
			`SELECT device_id, device_name, platform, sign_pub_key_spki_der_b64,
			        dh_pub_key_spki_der_b64, added_at, last_seen_at
			 FROM mobile_paired_devices
			 ORDER BY added_at DESC, device_id ASC`,
		)
		.all() as MobilePairedDeviceRow[];
	return rows
		.map(rowToDevice)
		.filter((device): device is StoredMobilePairedDevice => device !== null);
}

export function getMobilePairedDevice(
	deviceId: string,
): StoredMobilePairedDevice | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			`SELECT device_id, device_name, platform, sign_pub_key_spki_der_b64,
			        dh_pub_key_spki_der_b64, added_at, last_seen_at
			 FROM mobile_paired_devices
			 WHERE device_id = ?`,
		)
		.get(deviceId) as MobilePairedDeviceRow | undefined;
	return rowToDevice(row);
}

export function upsertMobilePairedDevice(
	device: StoredMobilePairedDevice,
): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`INSERT INTO mobile_paired_devices (
			device_id,
			device_name,
			platform,
			sign_pub_key_spki_der_b64,
			dh_pub_key_spki_der_b64,
			added_at,
			last_seen_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (device_id) DO UPDATE SET
			device_name = excluded.device_name,
			platform = excluded.platform,
			sign_pub_key_spki_der_b64 = excluded.sign_pub_key_spki_der_b64,
			dh_pub_key_spki_der_b64 = excluded.dh_pub_key_spki_der_b64,
			last_seen_at = excluded.last_seen_at`,
	).run(
		device.deviceId,
		device.deviceName,
		device.platform,
		device.signPubKeySpkiDerB64,
		device.dhPubKeySpkiDerB64,
		device.addedAt,
		device.lastSeenAt,
	);
}

export function touchMobilePairedDevice(
	deviceId: string,
	lastSeenAt: number,
): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		"UPDATE mobile_paired_devices SET last_seen_at = ? WHERE device_id = ?",
	).run(lastSeenAt, deviceId);
}

export function deleteMobilePairedDevice(deviceId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM mobile_paired_devices WHERE device_id = ?").run(
		deviceId,
	);
}
