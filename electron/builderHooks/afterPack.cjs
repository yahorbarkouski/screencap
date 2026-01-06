const { execSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

module.exports = async (context) => {
	if (process.platform !== "darwin") return;

	const appPath = join(
		context.appOutDir,
		`${context.packager.appInfo.productFilename}.app`,
	);
	const ocrBinary = join(
		appPath,
		"Contents",
		"Resources",
		"ocr",
		"screencap-ocr",
	);

	if (!existsSync(ocrBinary)) {
		console.log("OCR binary not found, skipping");
		return;
	}

	const identity = process.env.CSC_NAME || findDeveloperIdIdentity();
	if (!identity) {
		console.log("No Developer ID found, OCR binary will remain unsigned");
		return;
	}

	const entitlements = join(
		context.packager.projectDir,
		"build",
		"entitlements.mac.plist",
	);

	console.log(`Signing OCR binary with: ${identity}`);
	execSync(
		`codesign --force --options runtime --sign "${identity}" --entitlements "${entitlements}" "${ocrBinary}"`,
		{ stdio: "inherit" },
	);
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
