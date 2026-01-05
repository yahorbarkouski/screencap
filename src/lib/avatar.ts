import type { AvatarPattern, AvatarSettings } from "@/types";

const LETTER_PATTERNS: Record<string, string[]> = {
	A: ["  █  ", " █ █ ", "█████", "█   █", "█   █"],
	B: ["████ ", "█   █", "████ ", "█   █", "████ "],
	C: [" ████", "█    ", "█    ", "█    ", " ████"],
	D: ["████ ", "█   █", "█   █", "█   █", "████ "],
	E: ["█████", "█    ", "███  ", "█    ", "█████"],
	F: ["█████", "█    ", "███  ", "█    ", "█    "],
	G: [" ████", "█    ", "█  ██", "█   █", " ████"],
	H: ["█   █", "█   █", "█████", "█   █", "█   █"],
	I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
	J: ["█████", "   █ ", "   █ ", "█  █ ", " ██  "],
	K: ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
	L: ["█    ", "█    ", "█    ", "█    ", "█████"],
	M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
	N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
	O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
	P: ["████ ", "█   █", "████ ", "█    ", "█    "],
	Q: [" ███ ", "█   █", "█   █", "█  █ ", " ██ █"],
	R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
	S: [" ████", "█    ", " ███ ", "    █", "████ "],
	T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
	U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
	V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
	W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
	X: ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
	Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
	Z: ["█████", "   █ ", "  █  ", " █   ", "█████"],
};

const ASCII_S_PATTERN = [
	"  ████  ",
	" █    █ ",
	" █      ",
	"  ████  ",
	"      █ ",
	" █    █ ",
	"  ████  ",
];

export const DEFAULT_AVATAR_COLORS = [
	"#0a0a0a",
	"#1a1a2e",
	"#16213e",
	"#0f3460",
	"#1b1b2f",
	"#162447",
	"#1f4068",
	"#2d132c",
	"#391d2a",
	"#4a1942",
	"#1e3a5f",
	"#2b5876",
	"#4e4376",
	"#1b4332",
	"#2d6a4f",
	"#40916c",
	"#5c4033",
	"#6b4423",
	"#7c3626",
];

export const DEFAULT_FOREGROUND_COLORS = [
	"#ffffff",
	"#e0e0e0",
	"#c0c0c0",
	"#f5f5f5",
	"#ffd700",
	"#00ff88",
	"#00d4ff",
	"#ff6b6b",
	"#a78bfa",
	"#f472b6",
];

export function getDefaultAvatarSettings(): AvatarSettings {
	return {
		pattern: "pixelLetter",
		backgroundColor: "#0a0a0a",
		foregroundColor: "#ffffff",
	};
}

function drawRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
) {
	const r = Math.min(radius, width / 2, height / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + width - r, y);
	ctx.quadraticCurveTo(x + width, y, x + width, y + r);
	ctx.lineTo(x + width, y + height - r);
	ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
	ctx.lineTo(x + r, y + height);
	ctx.quadraticCurveTo(x, y + height, x, y + height - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

function generateLetterAvatar(
	ctx: CanvasRenderingContext2D,
	letter: string,
	size: number,
	settings: AvatarSettings,
) {
	const fontSize = size * 0.5;
	ctx.font = `600 ${fontSize}px "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = settings.foregroundColor;
	ctx.fillText(letter.toUpperCase(), size / 2, size / 2 + fontSize * 0.05);
}

function generateLetterBoldAvatar(
	ctx: CanvasRenderingContext2D,
	letter: string,
	size: number,
	settings: AvatarSettings,
) {
	const fontSize = size * 0.55;
	ctx.font = `800 ${fontSize}px "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = settings.foregroundColor;
	ctx.fillText(letter.toUpperCase(), size / 2, size / 2 + fontSize * 0.05);
}

function generateMonospaceAvatar(
	ctx: CanvasRenderingContext2D,
	letter: string,
	size: number,
	settings: AvatarSettings,
) {
	const fontSize = size * 0.5;
	ctx.font = `600 ${fontSize}px "SF Mono", "Monaco", "Menlo", monospace`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = settings.foregroundColor;
	ctx.fillText(letter.toUpperCase(), size / 2, size / 2 + fontSize * 0.05);
}

function generatePixelLetterAvatar(
	ctx: CanvasRenderingContext2D,
	letter: string,
	size: number,
	settings: AvatarSettings,
) {
	const pattern = LETTER_PATTERNS[letter.toUpperCase()] ?? LETTER_PATTERNS.A;
	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));

	const padding = size * 0.2;
	const availableSize = size - padding * 2;
	const cellSize = Math.floor(availableSize / Math.max(rows, cols));

	const totalWidth = cols * cellSize;
	const totalHeight = rows * cellSize;
	const offsetX = (size - totalWidth) / 2;
	const offsetY = (size - totalHeight) / 2;

	ctx.fillStyle = settings.foregroundColor;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < pattern[row].length; col++) {
			if (pattern[row][col] === "█") {
				ctx.fillRect(
					offsetX + col * cellSize,
					offsetY + row * cellSize,
					cellSize,
					cellSize,
				);
			}
		}
	}
}

function generateAsciiAvatar(
	ctx: CanvasRenderingContext2D,
	_letter: string,
	size: number,
	settings: AvatarSettings,
) {
	const pattern = ASCII_S_PATTERN;
	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));

	const padding = size * 0.18;
	const availableSize = size - padding * 2;

	const charWidth = availableSize / cols;
	const charHeight = availableSize / rows;
	const fontSize = Math.min(charWidth, charHeight) * 1.3;

	ctx.font = `bold ${fontSize}px "SF Mono", "Monaco", "Menlo", monospace`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = settings.foregroundColor;

	const offsetX = padding + charWidth / 2;
	const offsetY = padding + charHeight / 2;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < pattern[row].length; col++) {
			const char = pattern[row][col];
			if (char === "█") {
				ctx.fillText(
					"@",
					offsetX + col * charWidth,
					offsetY + row * charHeight,
				);
			}
		}
	}
}

export function generateAvatarCanvas(
	letter: string,
	size: number,
	settings: AvatarSettings,
): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) return canvas;

	const radius = size * 0.2;
	drawRoundedRect(ctx, 0, 0, size, size, radius);
	ctx.fillStyle = settings.backgroundColor;
	ctx.fill();

	const generators: Record<AvatarPattern, typeof generateLetterAvatar> = {
		letter: generateLetterAvatar,
		letterBold: generateLetterBoldAvatar,
		letterMonospace: generateMonospaceAvatar,
		pixelLetter: generatePixelLetterAvatar,
		ascii: generateAsciiAvatar,
	};

	const generator = generators[settings.pattern];
	generator(ctx, letter, size, settings);

	return canvas;
}

export function generateAvatarDataUrl(
	letter: string,
	size: number,
	settings: AvatarSettings,
): string {
	const canvas = generateAvatarCanvas(letter, size, settings);
	return canvas.toDataURL("image/png");
}
