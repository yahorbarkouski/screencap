import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { arch } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const helpers = [
	{
		name: "OCR",
		src: join(projectDir, "electron", "ocr", "ScreencapOCR.swift"),
		outDir: join(projectDir, "build", "ocr"),
		binaryName: "screencap-ocr",
		frameworks: ["Vision", "ImageIO", "CoreGraphics"],
	},
	{
		name: "foreground",
		src: join(
			projectDir,
			"electron",
			"foreground",
			"ScreencapForeground.swift",
		),
		outDir: join(projectDir, "build", "foreground"),
		binaryName: "screencap-foreground",
		frameworks: ["AppKit", "CoreGraphics"],
	},
];

function targetForArch(value) {
	if (value === "arm64") return "arm64-apple-macos12.0";
	if (value === "x64") return "x86_64-apple-macos12.0";
	throw new Error(`Unsupported arch: ${value}`);
}

function compileHelper(helper, target) {
	mkdirSync(helper.outDir, { recursive: true });
	const out = join(helper.outDir, helper.binaryName);
	const srcStat = statSync(helper.src);

	if (existsSync(out) && statSync(out).mtime > srcStat.mtime) {
		console.log(`${helper.name} binary is up to date, skipping compile`);
		return;
	}

	console.log(`Compiling ${helper.name} binary...`);
	execFileSync(
		"xcrun",
		[
			"--sdk",
			"macosx",
			"swiftc",
			helper.src,
			"-O",
			"-target",
			target,
			"-o",
			out,
			...helper.frameworks.flatMap((framework) => ["-framework", framework]),
		],
		{ stdio: "inherit" },
	);
}

if (process.platform !== "darwin") {
	console.log("Skipping Swift helper build on non-darwin platform");
	process.exit(0);
}

const target = targetForArch(arch());
for (const helper of helpers) {
	compileHelper(helper, target);
}
