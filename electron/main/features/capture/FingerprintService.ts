import { performance } from "node:perf_hooks";
import sharp from "sharp";
import type { Fingerprint, FingerprintComparison } from "../../../shared/types";
import { createPerfTracker } from "../../infra/log/perf";

const perf = createPerfTracker("Perf.Fingerprint");

type DHashSpec = {
	hashWidth: number;
	hashHeight: number;
	blurSigma: number;
	mask: (x: number, y: number, width: number, height: number) => boolean;
};

function hexPad(hex: string, length: number): string {
	return hex.padStart(length, "0");
}

function popCountBigInt(x: bigint): number {
	let count = 0;
	let v = x;
	while (v !== 0n) {
		v &= v - 1n;
		count++;
	}
	return count;
}

function hammingDistanceHex(a: string, b: string): number | null {
	if (!a || !b) return null;
	if (a.length !== b.length) return null;
	const x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
	return popCountBigInt(x);
}

function dHashMaskTopRight(
	x: number,
	y: number,
	width: number,
	height: number,
): boolean {
	const topRows = Math.max(1, Math.floor(height * 0.2));
	const rightCols = Math.max(1, Math.floor(width * 0.25));
	return y < topRows && x >= width - rightCols;
}

async function computeDHashHex(
	input: Buffer,
	spec: DHashSpec,
): Promise<string> {
	const startedAt = perf.enabled ? performance.now() : 0;
	const sampleWidth = spec.hashWidth + 1;
	const sampleHeight = spec.hashHeight;

	const { data } = await sharp(input)
		.resize(sampleWidth, sampleHeight, { fit: "fill" })
		.grayscale()
		.blur(spec.blurSigma)
		.raw()
		.toBuffer({ resolveWithObject: true });

	let acc = 0n;
	const bits = spec.hashWidth * spec.hashHeight;

	for (let y = 0; y < spec.hashHeight; y++) {
		for (let x = 0; x < spec.hashWidth; x++) {
			const idxA = y * sampleWidth + x;
			const idxB = y * sampleWidth + x + 1;
			const a = spec.mask(x, y, sampleWidth, sampleHeight) ? 0 : data[idxA];
			const b = spec.mask(x + 1, y, sampleWidth, sampleHeight) ? 0 : data[idxB];
			const bit = a > b ? 1n : 0n;
			acc = (acc << 1n) | bit;
		}
	}

	const hexLen = Math.ceil(bits / 4);
	const result = hexPad(acc.toString(16), hexLen);
	if (perf.enabled) {
		perf.track(
			`fingerprint.dhash.${spec.hashWidth}x${spec.hashHeight}`,
			performance.now() - startedAt,
		);
	}
	return result;
}

export async function computeFingerprint(input: Buffer): Promise<Fingerprint> {
	const startedAt = perf.enabled ? performance.now() : 0;
	const [stableHash, detailHash] = await Promise.all([
		computeDHashHex(input, {
			hashWidth: 8,
			hashHeight: 8,
			blurSigma: 1.2,
			mask: dHashMaskTopRight,
		}),
		computeDHashHex(input, {
			hashWidth: 16,
			hashHeight: 16,
			blurSigma: 0.3,
			mask: dHashMaskTopRight,
		}),
	]);

	if (perf.enabled)
		perf.track("fingerprint.total", performance.now() - startedAt);
	return { stableHash, detailHash };
}

export function isSimilarFingerprint(
	previous: { stableHash: string | null; detailHash: string | null },
	next: { stableHash: string; detailHash: string },
): FingerprintComparison {
	const stableDistance = previous.stableHash
		? hammingDistanceHex(previous.stableHash, next.stableHash)
		: null;
	const detailDistance = previous.detailHash
		? hammingDistanceHex(previous.detailHash, next.detailHash)
		: null;

	if (stableDistance === null || detailDistance === null) {
		return { isSimilar: false, stableDistance, detailDistance };
	}

	const isSimilar = stableDistance <= 4 && detailDistance <= 24;
	return { isSimilar, stableDistance, detailDistance };
}
