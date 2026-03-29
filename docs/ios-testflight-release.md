# iOS TestFlight Release Setup

This repository can now publish the iPhone companion to TestFlight from GitHub Actions.

## What the workflow does

On a new release from `main`, the release workflow can:

1. archive `ScreencapMobile`
2. export a signed `.ipa`
3. upload the `.ipa` to TestFlight
4. attach the `.ipa` as a workflow artifact

## Required GitHub secrets

### Existing macOS release secrets

- `APPLE_CERT_P12_BASE64`
- `APPLE_CERT_P12_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

### New iOS / TestFlight secrets

- `IOS_DIST_CERT_P12_BASE64`
  - Base64-encoded Apple Distribution `.p12`
- `IOS_DIST_CERT_P12_PASSWORD`
  - Password for the `.p12`
- `IOS_APP_PROFILE_BASE64`
  - Base64-encoded App Store provisioning profile for `app.screencap.mobile`
- `IOS_WIDGET_PROFILE_BASE64`
  - Base64-encoded App Store provisioning profile for `app.screencap.mobile.widget`
- `IOS_REPORT_PROFILE_BASE64`
  - Base64-encoded App Store provisioning profile for `app.screencap.mobile.report`
- `APPSTORE_API_KEY_ID`
  - App Store Connect API key ID
- `APPSTORE_ISSUER_ID`
  - App Store Connect issuer ID
- `APPSTORE_API_PRIVATE_KEY`
  - Full `.p8` App Store Connect API private key contents

## Apple-side prerequisites

Before the workflow can succeed, Apple-side setup must already exist:

1. App Store Connect app record for `app.screencap.mobile`
2. Bundle IDs registered for:
   - `app.screencap.mobile`
   - `app.screencap.mobile.widget`
   - `app.screencap.mobile.report`
3. App Store provisioning profiles created for all three bundle IDs and exported into the GitHub secrets above
4. App Group configured:
   - `group.app.screencap.mobile`
5. `Family Controls` capability enabled for the app and report extension
6. Apple approval for TestFlight/App Store use of the `Family Controls` entitlement

Without entitlement approval, local development installs can still work, but TestFlight distribution may fail.

## Notes

- The iPhone app still pairs to the desktop app over the local network.
- TestFlight removes the Xcode requirement for installing the app, but the desktop app must still be running for pairing and snapshot sync.
- If `ios/project.yml` changes, regenerate and commit `ios/ScreencapMobile.xcodeproj` before releasing.
