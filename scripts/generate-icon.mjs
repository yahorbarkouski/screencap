import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, "..", "build");

const S_PATTERN = [
	"    ######    ",
	"  ##@@@@@@##  ",
	" ##@@    @@## ",
	" #@@      ##  ",
	" #@@          ",
	"  @@@@##      ",
	"   ##@@@@##   ",
	"      ##@@@@  ",
	"          @@# ",
	"  ##      @@# ",
	" ##@@    @@## ",
	"  ##@@@@@@##  ",
	"    ######    ",
];

function drawSquircle(ctx, x, y, width, height, radius) {
	const r = Math.min(radius, width / 2, height / 2);
	const k = 0.5522847498;
	
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + width - r, y);
	ctx.bezierCurveTo(x + width - r * (1 - k), y, x + width, y + r * (1 - k), x + width, y + r);
	ctx.lineTo(x + width, y + height - r);
	ctx.bezierCurveTo(x + width, y + height - r * (1 - k), x + width - r * (1 - k), y + height, x + width - r, y + height);
	ctx.lineTo(x + r, y + height);
	ctx.bezierCurveTo(x + r * (1 - k), y + height, x, y + height - r * (1 - k), x, y + height - r);
	ctx.lineTo(x, y + r);
	ctx.bezierCurveTo(x, y + r * (1 - k), x + r * (1 - k), y, x + r, y);
	ctx.closePath();
}

function fillRoundedBackground(ctx, size) {
	const radius = size * 0.225;
	ctx.fillStyle = "#0a0a0a";
	drawSquircle(ctx, 0, 0, size, size, radius);
	ctx.fill();
}

function generateSmallIcon(size) {
	const canvas = createCanvas(size, size);
	const ctx = canvas.getContext("2d");

	fillRoundedBackground(ctx, size);

	const pixelGrid = [
		"████████",
		" █    █ ",
		"  █  █  ",
		"   ██   ",
		"   ██   ",
		"  █▓▓█  ",
		" █▓▓▓▓█ ",
		"████████",
	];

	const rows = pixelGrid.length;
	const cols = pixelGrid[0].length;

	const padding = size * 0.18;
	const cellSize = (size - padding * 2) / Math.max(rows, cols);
	const offsetX = padding + (size - padding * 2 - cols * cellSize) / 2;
	const offsetY = padding + (size - padding * 2 - rows * cellSize) / 2;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const char = pixelGrid[row][col];
			if (char === "█") {
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(
					offsetX + col * cellSize,
					offsetY + row * cellSize,
					cellSize + 0.5,
					cellSize + 0.5,
				);
			} else if (char === "▓") {
				ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
				ctx.fillRect(
					offsetX + col * cellSize,
					offsetY + row * cellSize,
					cellSize + 0.5,
					cellSize + 0.5,
				);
			}
		}
	}

	return canvas;
}

function generateMediumIcon(size) {
	const canvas = createCanvas(size, size);
	const ctx = canvas.getContext("2d");

	fillRoundedBackground(ctx, size);

	const pattern = [
		" @@@ ",
		"@   @",
		"@    ",
		" @@@ ",
		"    @",
		"@   @",
		" @@@ ",
	];

	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));

	const padding = size * 0.18;
	const availableSize = size - padding * 2;

	const charWidth = availableSize / cols;
	const charHeight = availableSize / rows;
	const fontSize = Math.min(charWidth, charHeight) * 1.4;

	ctx.font = `bold ${fontSize}px "SF Mono", "Monaco", monospace`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "rgba(255, 255, 255, 0.95)";

	const offsetX = padding + charWidth / 2;
	const offsetY = padding + charHeight / 2;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < pattern[row].length; col++) {
			if (pattern[row][col] === "@") {
				ctx.fillText(
					"@",
					offsetX + col * charWidth,
					offsetY + row * charHeight,
				);
			}
		}
	}

	return canvas;
}

function generateLargeIcon(size) {
	const canvas = createCanvas(size, size);
	const ctx = canvas.getContext("2d");

	fillRoundedBackground(ctx, size);

	const pattern = S_PATTERN;
	const rows = pattern.length;
	const cols = Math.max(...pattern.map((r) => r.length));

	const padding = size * 0.17;
	const availableSize = size - padding * 2;

	const charWidth = availableSize / cols;
	const charHeight = availableSize / rows;
	const fontSize = Math.min(charWidth, charHeight) * 1.2;

	ctx.font = `bold ${fontSize}px "SF Mono", "Monaco", "Menlo", monospace`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	const offsetX = padding + charWidth / 2;
	const offsetY = padding + charHeight / 2;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < pattern[row].length; col++) {
			const char = pattern[row][col];
			if (char === " ") continue;

			const x = offsetX + col * charWidth;
			const y = offsetY + row * charHeight;

			const brightness = char === "@" ? 1 : 0.7;
			ctx.fillStyle =
				char === "@"
					? `rgba(255, 255, 255, ${brightness})`
					: `rgba(200, 200, 200, ${brightness})`;

			ctx.fillText(char === "@" ? "@" : "#", x, y);
		}
	}

	return canvas;
}

function generateIcon(size) {
	if (size <= 32) return generateSmallIcon(size);
	if (size <= 64) return generateMediumIcon(size);
	return generateLargeIcon(size);
}

async function createIcns() {
	const iconsetDir = path.join(buildDir, "icon.iconset");
	fs.mkdirSync(iconsetDir, { recursive: true });

	const mapping = [
		["icon-16.png", "icon_16x16.png"],
		["icon-32.png", "icon_16x16@2x.png"],
		["icon-32.png", "icon_32x32.png"],
		["icon-64.png", "icon_32x32@2x.png"],
		["icon-128.png", "icon_128x128.png"],
		["icon-256.png", "icon_128x128@2x.png"],
		["icon-256.png", "icon_256x256.png"],
		["icon-512.png", "icon_256x256@2x.png"],
		["icon-512.png", "icon_512x512.png"],
		["icon-1024.png", "icon_512x512@2x.png"],
	];

	for (const [src, dest] of mapping) {
		fs.copyFileSync(path.join(buildDir, src), path.join(iconsetDir, dest));
	}

	execSync(
		`iconutil -c icns "${iconsetDir}" -o "${path.join(buildDir, "icon.icns")}"`,
	);
	fs.rmSync(iconsetDir, { recursive: true });
	console.log("Generated icon.icns");
}

async function createIco() {
	const pngToIco = await import("png-to-ico");
	const pngBuffer = fs.readFileSync(path.join(buildDir, "icon-256.png"));
	const icoBuffer = await pngToIco.default([pngBuffer]);
	fs.writeFileSync(path.join(buildDir, "icon.ico"), icoBuffer);
	console.log("Generated icon.ico");
}

function generateTrayIcon(size) {
	const canvas = createCanvas(size, size);
	const ctx = canvas.getContext("2d");

	const pixelGrid = [
		"  ████  ",
		" █    █ ",
		" █      ",
		"  ████  ",
		"      █ ",
		" █    █ ",
		"  ████  ",
		"        ",
	];

	const rows = pixelGrid.length;
	const cols = pixelGrid[0].length;

	const padding = size * 0.12;
	const cellSize = (size - padding * 2) / Math.max(rows, cols);
	const offsetX = padding + (size - padding * 2 - cols * cellSize) / 2;
	const offsetY = padding + (size - padding * 2 - rows * cellSize) / 2;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const char = pixelGrid[row][col];
			if (char === "█") {
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(
					offsetX + col * cellSize,
					offsetY + row * cellSize,
					cellSize + 0.5,
					cellSize + 0.5,
				);
			} else if (char === "▓") {
				ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
				ctx.fillRect(
					offsetX + col * cellSize,
					offsetY + row * cellSize,
					cellSize + 0.5,
					cellSize + 0.5,
				);
			}
		}
	}

	return canvas;
}

async function main() {
	fs.mkdirSync(buildDir, { recursive: true });

	const sizes = [16, 32, 64, 128, 256, 512, 1024];

	for (const size of sizes) {
		const canvas = generateIcon(size);
		const buffer = canvas.toBuffer("image/png");
		fs.writeFileSync(path.join(buildDir, `icon-${size}.png`), buffer);
		console.log(`Generated icon-${size}.png`);
	}

	fs.writeFileSync(
		path.join(buildDir, "icon.png"),
		generateIcon(1024).toBuffer("image/png"),
	);
	console.log("Generated icon.png");

	const tray16 = generateTrayIcon(16).toBuffer("image/png");
	const tray32 = generateTrayIcon(32).toBuffer("image/png");
	fs.writeFileSync(path.join(buildDir, "tray-16.png"), tray16);
	fs.writeFileSync(path.join(buildDir, "tray-32.png"), tray32);
	console.log("Generated tray-16.png, tray-32.png");
	console.log("\nTray icon base64 (16px):");
	console.log(tray16.toString("base64"));
	console.log("\nTray icon base64 (32px):");
	console.log(tray32.toString("base64"));

	if (process.platform === "darwin") {
		await createIcns();
	}

	await createIco();

	console.log("\n✓ All icons generated successfully");
}

main().catch(console.error);
