import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
	Friend,
	FriendRequest,
	RoomInvite,
	SocialIdentity,
} from "@/types";

export function FriendsTab() {
	const [identity, setIdentity] = useState<SocialIdentity | null>(null);
	const [friends, setFriends] = useState<Friend[]>([]);
	const [requests, setRequests] = useState<FriendRequest[]>([]);
	const [roomInvites, setRoomInvites] = useState<RoomInvite[]>([]);
	const [registerUsername, setRegisterUsername] = useState("");
	const [toUsername, setToUsername] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		if (!window.api?.social) return;
		setError(null);
		try {
			const id = await window.api.social.getIdentity();
			setIdentity(id);
			if (!id) return;
			const [f, r, invites] = await Promise.all([
				window.api.social.listFriends(),
				window.api.social.listFriendRequests(),
				window.api.rooms?.listInvites?.() ?? Promise.resolve([]),
			]);
			setFriends(f);
			setRequests(r);
			setRoomInvites(invites);
		} catch (e) {
			setError(String(e));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const pendingIncoming = useMemo(() => {
		if (!identity) return [];
		return requests.filter(
			(r) => r.status === "pending" && r.toUserId === identity.userId,
		);
	}, [identity, requests]);

	const acceptRoomInvite = useCallback(
		async (invite: RoomInvite) => {
			if (!window.api?.rooms) return;
			setBusy(true);
			setError(null);
			try {
				await window.api.rooms.acceptProjectInvite({
					roomId: invite.roomId,
					roomName: invite.roomName,
					ownerUserId: invite.fromUserId,
					ownerUsername: invite.fromUsername,
				});
				await refresh();
			} catch (e) {
				setError(String(e));
			} finally {
				setBusy(false);
			}
		},
		[refresh],
	);

	const register = useCallback(async () => {
		if (!window.api?.social) return;
		setBusy(true);
		setError(null);
		try {
			await window.api.social.registerUsername(registerUsername);
			setRegisterUsername("");
			await refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [registerUsername, refresh]);

	const sendRequest = useCallback(async () => {
		if (!window.api?.social) return;
		setBusy(true);
		setError(null);
		try {
			await window.api.social.sendFriendRequest(toUsername);
			setToUsername("");
			await refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [refresh, toUsername]);

	const accept = useCallback(
		async (requestId: string) => {
			if (!window.api?.social) return;
			setBusy(true);
			setError(null);
			try {
				await window.api.social.acceptFriendRequest(requestId);
				await refresh();
			} catch (e) {
				setError(String(e));
			} finally {
				setBusy(false);
			}
		},
		[refresh],
	);

	const reject = useCallback(
		async (requestId: string) => {
			if (!window.api?.social) return;
			setBusy(true);
			setError(null);
			try {
				await window.api.social.rejectFriendRequest(requestId);
				await refresh();
			} catch (e) {
				setError(String(e));
			} finally {
				setBusy(false);
			}
		},
		[refresh],
	);

	if (!window.api?.social) {
		return (
			<div className="text-sm text-muted-foreground">
				Social features unavailable
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{identity ? (
				<div className="flex items-center justify-between">
					<div className="text-sm font-medium text-foreground">
						@{identity.username}
					</div>
					<Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
						Refresh
					</Button>
				</div>
			) : (
				<div className="space-y-2">
					<div className="text-sm font-medium text-foreground">
						Choose a username
					</div>
					<div className="flex gap-2">
						<Input
							value={registerUsername}
							onChange={(e) => setRegisterUsername(e.target.value)}
							placeholder="username"
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
						/>
						<Button
							size="sm"
							onClick={register}
							disabled={busy || !registerUsername}
						>
							Register
						</Button>
					</div>
				</div>
			)}

			{identity && (
				<div className="space-y-2">
					<div className="text-xs font-mono tracking-[0.18em] text-muted-foreground">
						ADD FRIEND
					</div>
					<div className="flex gap-2">
						<Input
							value={toUsername}
							onChange={(e) => setToUsername(e.target.value)}
							placeholder="friend username"
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
						/>
						<Button
							size="sm"
							onClick={sendRequest}
							disabled={busy || !toUsername}
						>
							Send
						</Button>
					</div>
				</div>
			)}

			{error && (
				<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{error}
				</div>
			)}

			{identity && pendingIncoming.length > 0 && (
				<div className="space-y-2">
					<div className="text-xs font-mono tracking-[0.18em] text-muted-foreground">
						PENDING REQUESTS
					</div>
					<div className="space-y-2">
						{pendingIncoming.map((r) => (
							<div
								key={r.id}
								className="flex items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2"
							>
								<div className="text-sm text-foreground">@{r.fromUsername}</div>
								<div className="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() => accept(r.id)}
										disabled={busy}
									>
										Accept
									</Button>
									<Button
										size="sm"
										variant="destructive"
										onClick={() => reject(r.id)}
										disabled={busy}
									>
										Reject
									</Button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{identity && roomInvites.length > 0 && (
				<div className="space-y-2">
					<div className="text-xs font-mono tracking-[0.18em] text-muted-foreground">
						PROJECT INVITES
					</div>
					<div className="space-y-2">
						{roomInvites.map((inv) => (
							<div
								key={inv.id}
								className="flex items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2"
							>
								<div className="min-w-0">
									<div className="text-sm text-foreground">
										<span className="text-muted-foreground">
											@{inv.fromUsername}
										</span>{" "}
										invited you to
									</div>
									<div className="truncate text-sm font-medium text-foreground">
										{inv.roomName}
									</div>
								</div>
								<Button
									size="sm"
									variant="outline"
									onClick={() => acceptRoomInvite(inv)}
									disabled={busy || !window.api?.rooms}
								>
									Accept
								</Button>
							</div>
						))}
					</div>
				</div>
			)}

			{identity && (
				<div className="space-y-2">
					<div className="text-xs font-mono tracking-[0.18em] text-muted-foreground">
						FRIENDS
					</div>
					{friends.length === 0 ? (
						<div className="text-sm text-muted-foreground">No friends yet</div>
					) : (
						<div className="max-h-56 overflow-auto space-y-1">
							{friends.map((f) => (
								<div
									key={f.userId}
									className="rounded-md border border-border bg-muted/10 px-3 py-2 text-sm text-foreground"
								>
									@{f.username}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
