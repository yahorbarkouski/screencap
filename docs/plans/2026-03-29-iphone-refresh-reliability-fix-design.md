# iPhone Refresh Reliability Fix Design

## Goal

Make iPhone Day Wrapped refresh reliable by fixing:

- overlapping foreground refreshes that repeatedly recreate the hidden Screen Time report host
- missing credentials in widget and background bridge requests
- weak diagnostics around superseded refreshes and shared credential availability

## Current Failures

- The iPhone app presents the hidden `DeviceActivityReport` host, but the report extension often never starts.
- `sceneBecameActive()` is triggered from multiple SwiftUI lifecycle hooks, which causes duplicate selected-day refreshes and repeated report-host presentation.
- Background and widget bridge requests can fail with `Identity not available` because signing keys are stored in a way that is not consistently readable outside the foreground app process.
- The app falls back to the Mac-only snapshot, which hides the actual failure stage from the user.

## Chosen Approach

Implement a full reliability fix in three layers:

1. Serialize selected-day refreshes in the iPhone app.
2. Remove duplicate scene-activation refresh triggers and stale refresh observers.
3. Move signing credentials to a shared keychain access group so app, widget, and related extension code can read the same identity material when needed.

## Refresh Orchestration

- Add a refresh generation token to `AppModel`.
- When a new refresh starts, it supersedes any older wait loop.
- Guard `refreshSelectedDay()` so only one selected-day refresh is active at a time for a given generation.
- Keep the hidden `DeviceActivityReport` host mounted, but only change its token when a real refresh begins.
- Ensure scene activation only schedules one foreground refresh attempt.

## Shared Credentials

- Add a shared keychain access group entitlement to the iPhone app, widget extension, and report extension.
- Update `AuthStore` to read and write keys using that access group.
- Add a small helper that validates whether both identity and key material are available before bridge calls.
- Use the stronger credential check in background and widget-facing flows so logs distinguish missing identity from missing keys.

## Diagnostics

- Log when a refresh is skipped because another refresh is already active.
- Log when a refresh wait loop exits because it was superseded by a newer request.
- Log when shared credential material is unavailable for background or widget work.
- Preserve the existing report lifecycle markers so diagnostics still point to the exact failed stage.

## Testing

- Validate that foreground activation no longer emits duplicate refresh/report-host sequences.
- Validate that manual refresh can produce a fresh `mobile-day-<day>.json` without being replaced by a second activation refresh.
- Validate that widget and background snapshot fetches use shared credentials successfully.
- Run iOS-targeted build or project validation plus repository typecheck/lint as applicable.

## Risks

- Shared keychain access requires matching entitlements across all relevant iOS targets.
- `DeviceActivityReport` remains platform-controlled, so extension startup can still be slow; the fix focuses on removing app-side races and credential failures.
