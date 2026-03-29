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
IOS_APP_BUNDLE_ID="${IOS_APP_BUNDLE_ID:-app.screencap.mobile}"
IOS_WIDGET_BUNDLE_ID="${IOS_WIDGET_BUNDLE_ID:-app.screencap.mobile.widget}"
IOS_REPORT_BUNDLE_ID="${IOS_REPORT_BUNDLE_ID:-app.screencap.mobile.report}"

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
require_env IOS_MARKETING_VERSION
require_env IOS_BUILD_NUMBER
require_env IOS_APP_PROFILE_NAME
require_env IOS_WIDGET_PROFILE_NAME
require_env IOS_REPORT_PROFILE_NAME

if [[ ! -f "$PROJECT_FILE" ]]; then
	echo "Missing Xcode project at $PROJECT_FILE" >&2
	exit 1
fi

if [[ -f "$PROJECT_SPEC_PATH" && "$PROJECT_SPEC_PATH" -nt "$PROJECT_FILE" ]]; then
	echo "ios/project.yml is newer than the checked-in Xcode project. Run xcodegen generate and commit ios/ScreencapMobile.xcodeproj." >&2
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
	<string>manual</string>
	<key>signingCertificate</key>
	<string>Apple Distribution</string>
	<key>stripSwiftSymbols</key>
	<true/>
	<key>provisioningProfiles</key>
	<dict>
		<key>${IOS_APP_BUNDLE_ID}</key>
		<string>${IOS_APP_PROFILE_NAME}</string>
		<key>${IOS_WIDGET_BUNDLE_ID}</key>
		<string>${IOS_WIDGET_PROFILE_NAME}</string>
		<key>${IOS_REPORT_BUNDLE_ID}</key>
		<string>${IOS_REPORT_PROFILE_NAME}</string>
	</dict>
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
	DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
	CODE_SIGN_STYLE=Manual \
	IOS_APP_PROFILE_SPECIFIER="$IOS_APP_PROFILE_NAME" \
	IOS_WIDGET_PROFILE_SPECIFIER="$IOS_WIDGET_PROFILE_NAME" \
	IOS_REPORT_PROFILE_SPECIFIER="$IOS_REPORT_PROFILE_NAME" \
	MARKETING_VERSION="$IOS_MARKETING_VERSION" \
	CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER" \
	clean archive

xcodebuild \
	-exportArchive \
	-archivePath "$ARCHIVE_PATH" \
	-exportPath "$EXPORT_PATH" \
	-exportOptionsPlist "$EXPORT_OPTIONS_PATH"

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
