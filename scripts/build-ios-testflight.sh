#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="$ROOT_DIR/ios/ScreencapMobile.xcodeproj"
PROJECT_FILE="$PROJECT_PATH/project.pbxproj"
PROJECT_SPEC_PATH="$ROOT_DIR/ios/project.yml"
SCHEME="${IOS_SCHEME:-ScreencapMobile}"
CONFIGURATION="${IOS_CONFIGURATION:-Release}"
BUILD_ROOT="${IOS_BUILD_ROOT:-$ROOT_DIR/build/ios-testflight}"
DERIVED_DATA_PATH="${IOS_DERIVED_DATA_PATH:-$BUILD_ROOT/DerivedData}"
ARCHIVE_PATH="${IOS_ARCHIVE_PATH:-$BUILD_ROOT/ScreencapMobile.xcarchive}"
EXPORT_PATH="${IOS_EXPORT_PATH:-$BUILD_ROOT/export}"
EXPORT_OPTIONS_PATH="${IOS_EXPORT_OPTIONS_PATH:-$BUILD_ROOT/ExportOptions.plist}"
TESTFLIGHT_INTERNAL_ONLY="${IOS_TESTFLIGHT_INTERNAL_ONLY:-true}"

require_env() {
	local name="$1"
	if [[ -z "${!name:-}" ]]; then
		echo "Missing required environment variable: $name" >&2
		exit 1
	fi
}

bool_to_plist() {
	local value
	value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
	if [[ "$value" == "true" || "$value" == "yes" || "$value" == "1" ]]; then
		echo "<true/>"
		return
	fi
	echo "<false/>"
}

require_env APPLE_TEAM_ID
require_env APPSTORE_API_KEY_ID
require_env APPSTORE_ISSUER_ID
require_env APPSTORE_API_KEY_PATH
require_env IOS_MARKETING_VERSION
require_env IOS_BUILD_NUMBER

if [[ ! -f "$PROJECT_FILE" ]]; then
	echo "Missing Xcode project at $PROJECT_FILE" >&2
	exit 1
fi

if [[ -f "$PROJECT_SPEC_PATH" && "$PROJECT_SPEC_PATH" -nt "$PROJECT_FILE" ]]; then
	echo "ios/project.yml is newer than the checked-in Xcode project. Run xcodegen generate and commit ios/ScreencapMobile.xcodeproj." >&2
	exit 1
fi

if [[ ! -f "$APPSTORE_API_KEY_PATH" ]]; then
	echo "App Store Connect API key file not found at $APPSTORE_API_KEY_PATH" >&2
	exit 1
fi

rm -rf "$BUILD_ROOT"
mkdir -p "$BUILD_ROOT"

cat > "$EXPORT_OPTIONS_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>destination</key>
	<string>export</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>method</key>
	<string>app-store-connect</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>stripSwiftSymbols</key>
	<true/>
	<key>teamID</key>
	<string>${APPLE_TEAM_ID}</string>
	<key>testFlightInternalTestingOnly</key>
	$(bool_to_plist "$TESTFLIGHT_INTERNAL_ONLY")
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
EOF

xcodebuild \
	-project "$PROJECT_PATH" \
	-scheme "$SCHEME" \
	-configuration "$CONFIGURATION" \
	-destination "generic/platform=iOS" \
	-derivedDataPath "$DERIVED_DATA_PATH" \
	-archivePath "$ARCHIVE_PATH" \
	-allowProvisioningUpdates \
	-authenticationKeyPath "$APPSTORE_API_KEY_PATH" \
	-authenticationKeyID "$APPSTORE_API_KEY_ID" \
	-authenticationKeyIssuerID "$APPSTORE_ISSUER_ID" \
	DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
	CODE_SIGN_IDENTITY="Apple Distribution" \
	MARKETING_VERSION="$IOS_MARKETING_VERSION" \
	CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER" \
	clean archive

xcodebuild \
	-exportArchive \
	-archivePath "$ARCHIVE_PATH" \
	-exportPath "$EXPORT_PATH" \
	-exportOptionsPlist "$EXPORT_OPTIONS_PATH" \
	-allowProvisioningUpdates \
	-authenticationKeyPath "$APPSTORE_API_KEY_PATH" \
	-authenticationKeyID "$APPSTORE_API_KEY_ID" \
	-authenticationKeyIssuerID "$APPSTORE_ISSUER_ID"

IPA_PATH="$(find "$EXPORT_PATH" -maxdepth 1 -name '*.ipa' -print -quit)"
if [[ -z "$IPA_PATH" ]]; then
	echo "Expected an .ipa in $EXPORT_PATH, but none was produced." >&2
	exit 1
fi

echo "Built iOS archive at $ARCHIVE_PATH"
echo "Exported IPA at $IPA_PATH"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	{
		echo "archive_path=$ARCHIVE_PATH"
		echo "export_path=$EXPORT_PATH"
		echo "ipa_path=$IPA_PATH"
		echo "export_options_path=$EXPORT_OPTIONS_PATH"
	} >> "$GITHUB_OUTPUT"
fi
