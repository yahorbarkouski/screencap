const { execSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const helperBinaries = [
	["ocr", "screencap-ocr"],
	["foreground", "screencap-foreground"],
];

module.exports = async (context) => {
	if (process.platform !== "darwin") return;

	const appPath = join(
		context.appOutDir,
		`${context.packager.appInfo.productFilename}.app`,
	);
	const binaries = helperBinaries
		.map(([resourceDir, binaryName]) => ({
			name: binaryName,
			path: join(appPath, "Contents", "Resources", resourceDir, binaryName),
		}))
		.filter((binary) => {
			if (existsSync(binary.path)) return true;
			console.log(`${binary.name} binary not found, skipping`);
			return false;
		});

	if (binaries.length === 0) return;

	const identity = process.env.CSC_NAME || findDeveloperIdIdentity();
	if (!identity) {
		console.log("No Developer ID found, helper binaries will remain unsigned");
		return;
	}

	const entitlements = join(
		context.packager.projectDir,
		"build",
		"entitlements.mac.plist",
	);

	for (const binary of binaries) {
		console.log(`Signing ${binary.name} with: ${identity}`);
		execSync(
			`codesign --force --options runtime --sign "${identity}" --entitlements "${entitlements}" "${binary.path}"`,
			{ stdio: "inherit" },
		);
	}
};

function findDeveloperIdIdentity() {
	if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false") return null;
	try {
		const output = execSync(
			'security find-identity -v -p codesigning | grep "Developer ID Application" | head -1',
			{ encoding: "utf8" },
		);
		const match = output.match(/"([^"]+)"/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}
