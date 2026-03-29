# iOS TestFlight Release Design

## Goal

Extend the existing GitHub Actions release flow so the iPhone companion can be signed, archived, uploaded to TestFlight, and installed through the normal TestFlight app instead of Xcode.

## Options Considered

### 1. Native `xcodebuild` + App Store Connect API key

Use the checked-in Xcode project, an imported Apple Distribution certificate, and an App Store Connect API key to archive and export the app in CI, then upload the resulting `.ipa` to TestFlight.

Pros:
- Minimal new tooling
- Fits the current GitHub Actions setup
- Keeps release logic visible in-repo

Cons:
- Requires careful secret management
- Depends on Apple-side entitlements and provisioning being configured correctly

### 2. Fastlane `match` + `pilot`

Adopt Fastlane for signing and TestFlight upload.

Pros:
- Mature iOS release ecosystem
- Strong signing/profile management story

Cons:
- Adds a large secondary toolchain
- Overkill for one iOS target bundle plus two extensions

### 3. External mobile CI platform

Move the iOS pipeline out of GitHub Actions.

Pros:
- Better mobile-specific ergonomics

Cons:
- Splits release logic across systems
- Unnecessary complexity for this repository

## Chosen Approach

Use native `xcodebuild` in GitHub Actions and upload with Xcode's bundled `altool`. This keeps the existing release workflow intact, avoids introducing Fastlane, and avoids the runner-specific `iTMSTransporter` launcher issue that can appear on hosted macOS images.

## Release Flow

1. Existing semantic release determines whether a new release was published on `main`.
2. The macOS Electron release continues unchanged.
3. If iOS signing secrets and App Store Connect credentials are present:
   - import an Apple Distribution certificate
   - install explicit App Store provisioning profiles for the app, widget, and report extension
   - archive the `ScreencapMobile` app for `generic/platform=iOS` with manual signing
   - export a signed `.ipa` using `app-store-connect` export mode
   - upload the `.ipa` to TestFlight
4. Upload the built `.ipa` as a workflow artifact for debugging.

## CI Inputs

Required GitHub secrets:
- `IOS_DIST_CERT_P12_BASE64`
- `IOS_DIST_CERT_P12_PASSWORD`
- `IOS_APP_PROFILE_BASE64`
- `IOS_WIDGET_PROFILE_BASE64`
- `IOS_REPORT_PROFILE_BASE64`
- `APPSTORE_API_KEY_ID`
- `APPSTORE_ISSUER_ID`
- `APPSTORE_API_PRIVATE_KEY`
- `APPLE_TEAM_ID`

Existing macOS release secrets remain unchanged.

## Versioning

The release workflow injects:
- `MARKETING_VERSION` from the semantic-release version
- `CURRENT_PROJECT_VERSION` from `github.run_number`

The app and both extensions read these values from build settings instead of hard-coded plist literals.

## Risks and Constraints

- TestFlight distribution for this app requires Apple approval for the `Family Controls` entitlement.
- The iPhone app still relies on the Mac-local pairing bridge, so TestFlight improves installation, not the network model.
- The checked-in Xcode project must stay in sync with `ios/project.yml`; CI should fail fast if the spec is newer than the generated project.

## Verification

- Local verification covers simulator build/install/launch and shell/workflow validation.
- Full TestFlight validation depends on real Apple credentials, provisioning, and entitlement approval.
