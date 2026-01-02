const { execSync } = require("node:child_process");
const { join } = require("node:path");
const { readdirSync, statSync } = require("node:fs");

function findBinaries(dir, binaries = []) {
	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!entry.name.endsWith(".app")) {
				findBinaries(fullPath, binaries);
			}
		} else if (
			entry.name.endsWith(".node") ||
			entry.name.endsWith(".dylib") ||
			entry.name === "screencap-ocr"
		) {
			binaries.push(fullPath);
		}
	}
	return binaries;
}

module.exports = async (context) => {
	if (process.platform !== "darwin") return;

	const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

	console.log(`Ad-hoc signing ${appPath}...`);

	const binaries = findBinaries(appPath);
	console.log(`Found ${binaries.length} native binaries to sign`);

	for (const binary of binaries) {
		try {
			execSync(`codesign --force --sign - "${binary}"`, { stdio: "pipe" });
		} catch (e) {
			console.log(`Warning: Could not sign ${binary}`);
		}
	}

	execSync(
		`codesign --force --deep --sign - "${appPath}"`,
		{ stdio: "inherit" }
	);

	const result = execSync(
		`codesign --verify --deep --strict "${appPath}" 2>&1 || true`,
		{ encoding: "utf-8" }
	);

	if (result.includes("valid on disk")) {
		console.log("Ad-hoc signing verified successfully");
	} else if (result.trim() === "") {
		console.log("Ad-hoc signing verified successfully");
	} else {
		console.log("Signature verification output:", result);
	}
};
