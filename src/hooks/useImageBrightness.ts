import { useEffect, useState } from "react";

type BrightnessRegion = "light" | "dark" | "unknown";

interface BrightnessResult {
	bottomRight: BrightnessRegion;
	topLeft: BrightnessRegion;
	topRight: BrightnessRegion;
}

const BRIGHTNESS_THRESHOLD = 170;
const SAMPLE_SIZE = 40;

function sampleRegionBrightness(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
): number {
	const imageData = ctx.getImageData(x, y, width, height);
	const data = imageData.data;
	let totalBrightness = 0;
	let pixelCount = 0;

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const brightness = (r * 299 + g * 587 + b * 114) / 1000;
		totalBrightness += brightness;
		pixelCount++;
	}

	return totalBrightness / pixelCount;
}

export function useImageBrightness(imagePath: string | null): BrightnessResult {
	const [result, setResult] = useState<BrightnessResult>({
		bottomRight: "unknown",
		topLeft: "unknown",
		topRight: "unknown",
	});

	useEffect(() => {
		if (!imagePath) {
			setResult({
				bottomRight: "unknown",
				topLeft: "unknown",
				topRight: "unknown",
			});
			return;
		}

		const img = new Image();
		img.crossOrigin = "anonymous";

		img.onload = () => {
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");
			if (!ctx) return;

			canvas.width = img.width;
			canvas.height = img.height;
			ctx.drawImage(img, 0, 0);

			const sampleW = Math.min(SAMPLE_SIZE, img.width / 4);
			const sampleH = Math.min(SAMPLE_SIZE, img.height / 4);

			const bottomRightBrightness = sampleRegionBrightness(
				ctx,
				img.width - sampleW,
				img.height - sampleH,
				sampleW,
				sampleH,
			);

			const topLeftBrightness = sampleRegionBrightness(
				ctx,
				0,
				0,
				sampleW,
				sampleH,
			);

			const topRightBrightness = sampleRegionBrightness(
				ctx,
				img.width - sampleW,
				0,
				sampleW,
				sampleH,
			);

			setResult({
				bottomRight:
					bottomRightBrightness > BRIGHTNESS_THRESHOLD ? "light" : "dark",
				topLeft: topLeftBrightness > BRIGHTNESS_THRESHOLD ? "light" : "dark",
				topRight: topRightBrightness > BRIGHTNESS_THRESHOLD ? "light" : "dark",
			});
		};

		img.onerror = () => {
			setResult({
				bottomRight: "unknown",
				topLeft: "unknown",
				topRight: "unknown",
			});
		};

		img.src = `local-file://${imagePath}`;

		return () => {
			img.onload = null;
			img.onerror = null;
		};
	}, [imagePath]);

	return result;
}
