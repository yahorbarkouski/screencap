export interface TimedLease {
	readonly id: number;
	readonly label: string;
	readonly startedAt: number;
	readonly timeoutMs: number;
	readonly done: Promise<void>;
	hasTimedOut(now?: number): boolean;
	heldForMs(now?: number): number;
	isReleased(): boolean;
	release(): boolean;
}

type CreateTimedLeaseOptions = {
	label: string;
	timeoutMs: number;
	onTimeout?: (lease: TimedLease, heldForMs: number) => void;
};

let nextLeaseId = 1;

export function createTimedLease(options: CreateTimedLeaseOptions): TimedLease {
	const { label, timeoutMs, onTimeout } = options;
	const startedAt = Date.now();

	let resolveDone!: () => void;
	let released = false;
	let timeout: NodeJS.Timeout | null = null;
	let lease!: TimedLease;

	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	const release = (): boolean => {
		if (released) return false;
		released = true;
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
		resolveDone();
		return true;
	};

	lease = {
		id: nextLeaseId++,
		label,
		startedAt,
		timeoutMs,
		done,
		hasTimedOut(now = Date.now()) {
			return now - startedAt >= timeoutMs;
		},
		heldForMs(now = Date.now()) {
			return Math.max(0, now - startedAt);
		},
		isReleased() {
			return released;
		},
		release,
	};

	timeout = setTimeout(() => {
		if (released) return;
		onTimeout?.(lease, lease.heldForMs());
		release();
	}, timeoutMs);
	timeout.unref?.();

	return lease;
}
