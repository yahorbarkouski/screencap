import { toDataURL } from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/wrapped/Panel";
import type {
	DevicePairingSession,
	MobileActivitySyncStatus,
	PairedDevice,
	SocialIdentity,
} from "@/types";

function formatTimestamp(value: number | null): string {
	if (!value) return "Never";
	return new Date(value).toLocaleString();
}

export function IPhoneCompanionPanel({
	identity,
}: {
	identity: SocialIdentity | null;
}) {
	const [devices, setDevices] = useState<PairedDevice[]>([]);
	const [syncStatus, setSyncStatus] = useState<MobileActivitySyncStatus | null>(
		null,
	);
	const [activeSession, setActiveSession] =
		useState<DevicePairingSession | null>(null);
	const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
	const [isPairingBusy, setIsPairingBusy] = useState(false);
	const [isSyncing, setIsSyncing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (
			!identity ||
			!window.api?.devicePairing ||
			!window.api?.mobileActivity
		) {
			setDevices([]);
			setSyncStatus(null);
			return;
		}

		try {
			const [nextDevices, nextSyncStatus] = await Promise.all([
				window.api.devicePairing.listDevices(),
				window.api.mobileActivity.getSyncStatus(),
			]);
			setDevices(nextDevices);
			setSyncStatus(nextSyncStatus);
		} catch (refreshError) {
			setError(String(refreshError));
		}
	}, [identity]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!activeSession) {
			setQrCodeDataUrl(null);
			return;
		}

		let cancelled = false;
		void toDataURL(activeSession.pairingUrl, {
			margin: 1,
			width: 224,
			color: {
				dark: "#f8fafc",
				light: "#0b1020",
			},
		})
			.then((value: string) => {
				if (!cancelled) {
					setQrCodeDataUrl(value);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setQrCodeDataUrl(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [activeSession]);

	useEffect(() => {
		if (!activeSession || !window.api?.devicePairing) return;
		if (
			activeSession.status === "approved" ||
			activeSession.status === "expired"
		) {
			return;
		}

		const interval = setInterval(async () => {
			try {
				const session = await window.api.devicePairing.getSession(
					activeSession.id,
				);
				if (session) {
					setActiveSession(session);
					if (session.status === "approved") {
						void refresh();
					}
				}
			} catch {}
		}, 3000);

		return () => clearInterval(interval);
	}, [activeSession, refresh]);

	const handleCreateSession = useCallback(async () => {
		if (!window.api?.devicePairing) return;
		setError(null);
		setIsPairingBusy(true);
		try {
			const session = await window.api.devicePairing.createSession();
			setActiveSession(session);
			try {
				await navigator.clipboard.writeText(session.pairingUrl);
			} catch {}
		} catch (createError) {
			setError(String(createError));
		} finally {
			setIsPairingBusy(false);
		}
	}, []);

	const handleApproveSession = useCallback(async () => {
		if (!activeSession || !window.api?.devicePairing) return;
		setError(null);
		setIsPairingBusy(true);
		try {
			const session = await window.api.devicePairing.approveSession(
				activeSession.id,
			);
			setActiveSession(session);
			await refresh();
		} catch (approveError) {
			setError(String(approveError));
		} finally {
			setIsPairingBusy(false);
		}
	}, [activeSession, refresh]);

	const handleSyncNow = useCallback(async () => {
		if (!window.api?.mobileActivity) return;
		setError(null);
		setIsSyncing(true);
		try {
			await window.api.mobileActivity.sync();
			await refresh();
		} catch (syncError) {
			setError(String(syncError));
		} finally {
			setIsSyncing(false);
		}
	}, [refresh]);

	const handleRevokeDevice = useCallback(
		async (deviceId: string) => {
			if (!window.api?.devicePairing) return;
			setError(null);
			try {
				await window.api.devicePairing.revokeDevice(deviceId);
				await refresh();
			} catch (revokeError) {
				setError(String(revokeError));
			}
		},
		[refresh],
	);

	return (
		<Panel
			title="iPhone Companion"
			meta={
				identity
					? "Pair an iPhone, import Screen Time days, and keep the shared Day Wrapped cache fresh"
					: "Register a Screencap account first to enable iPhone pairing"
			}
			className="max-w-3xl"
		>
			<div className="space-y-4">
				{identity ? (
					<>
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								onClick={() => void handleCreateSession()}
								disabled={isPairingBusy}
							>
								Start pairing
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => void handleSyncNow()}
								disabled={isSyncing}
							>
								Sync mobile days
							</Button>
						</div>

						{activeSession && (
							<div className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
								<div className="flex flex-wrap items-start justify-between gap-4">
									<div>
										<div className="font-medium text-foreground">
											Pairing code: {activeSession.code}
										</div>
										<div className="text-xs text-muted-foreground">
											Status: {activeSession.status}
										</div>
									</div>
									{activeSession.status === "claimed" && (
										<Button
											size="sm"
											onClick={() => void handleApproveSession()}
											disabled={isPairingBusy}
										>
											Approve iPhone
										</Button>
									)}
									{qrCodeDataUrl && (
										<img
											src={qrCodeDataUrl}
											alt="Pairing QR code"
											className="size-28 rounded-lg border border-border/60 bg-[#0b1020] p-2"
										/>
									)}
								</div>
								<div className="mt-2 break-all text-xs text-muted-foreground">
									{activeSession.pairingUrl}
								</div>
								<div className="mt-2 text-xs text-muted-foreground">
									Expires: {formatTimestamp(activeSession.expiresAt)}
								</div>
								{activeSession.claimedDeviceName && (
									<div className="mt-1 text-xs text-muted-foreground">
										Claimed by: {activeSession.claimedDeviceName}
									</div>
								)}
							</div>
						)}

						<div className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
							<div className="font-medium text-foreground">Mobile sync</div>
							<div className="mt-1 text-xs text-muted-foreground">
								Last attempt:{" "}
								{formatTimestamp(syncStatus?.lastAttemptAt ?? null)}
							</div>
							<div className="text-xs text-muted-foreground">
								Last success:{" "}
								{formatTimestamp(syncStatus?.lastSuccessAt ?? null)}
							</div>
							{syncStatus?.lastError && (
								<div className="mt-2 text-xs text-destructive">
									{syncStatus.lastError}
								</div>
							)}
						</div>

						<div className="space-y-2">
							<div className="text-sm font-medium text-foreground">
								Paired devices
							</div>
							{devices.length === 0 ? (
								<div className="text-xs text-muted-foreground">
									No paired devices yet.
								</div>
							) : (
								devices.map((device) => (
									<div
										key={device.deviceId}
										className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
									>
										<div className="min-w-0">
											<div className="text-sm text-foreground">
												{device.deviceName ?? device.platform}
												{device.isCurrent ? " (This Mac)" : ""}
											</div>
											<div className="text-xs text-muted-foreground">
												{device.platform} · Added{" "}
												{formatTimestamp(device.addedAt)} · Last seen{" "}
												{formatTimestamp(device.lastSeenAt)}
											</div>
										</div>
										<Button
											size="sm"
											variant="outline"
											disabled={device.isCurrent}
											onClick={() => void handleRevokeDevice(device.deviceId)}
										>
											Revoke
										</Button>
									</div>
								))
							)}
						</div>
					</>
				) : null}

				{error && <div className="text-xs text-destructive">{error}</div>}
			</div>
		</Panel>
	);
}
