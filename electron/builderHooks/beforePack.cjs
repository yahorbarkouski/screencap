const { execFileSync } = require("node:child_process");
const { mkdirSync, existsSync, statSync } = require("node:fs");
const { join } = require("node:path");

const helperTargets = [
	{
		name: "OCR",
		srcParts: ["electron", "ocr", "ScreencapOCR.swift"],
		outParts: ["build", "ocr"],
		binaryName: "screencap-ocr",
		frameworks: ["Vision", "ImageIO", "CoreGraphics"],
	},
	{
		name: "foreground",
		srcParts: ["electron", "foreground", "ScreencapForeground.swift"],
		outParts: ["build", "foreground"],
		binaryName: "screencap-foreground",
		frameworks: ["AppKit", "CoreGraphics"],
	},
];

function archToTarget(arch) {
	if (arch === 3 || arch === "arm64") return "arm64-apple-macos12.0";
	if (arch === 1 || arch === "x64") return "x86_64-apple-macos12.0";
	throw new Error(`Unsupported arch: ${arch}`);
}

function archToName(arch) {
	if (arch === 3 || arch === "arm64") return "arm64";
	if (arch === 1 || arch === "x64") return "x64";
	throw new Error(`Unsupported arch: ${arch}`);
}

module.exports = async (context) => {
	const projectDir = context.packager.projectDir;
	const archName = archToName(context.arch);
	const target = archToTarget(context.arch);

	for (const helper of helperTargets) {
		compileHelper(projectDir, archName, target, helper);
	}
};

function compileHelper(projectDir, archName, target, helper) {
	const src = join(projectDir, ...helper.srcParts);
	const outDir = join(projectDir, ...helper.outParts, archName);
	mkdirSync(outDir, { recursive: true });
	const out = join(outDir, helper.binaryName);

	const srcStat = statSync(src);
	if (existsSync(out)) {
		const outStat = statSync(out);
		if (outStat.mtime > srcStat.mtime) {
			console.log(
				`${helper.name} binary for ${archName} is up to date, skipping compile`,
			);
			return;
		}
	}

	console.log(`Compiling ${helper.name} binary for ${archName}...`);
	execFileSync(
		"xcrun",
		[
			"--sdk",
			"macosx",
			"swiftc",
			src,
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
