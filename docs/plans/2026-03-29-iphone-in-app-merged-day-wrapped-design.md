# iPhone In-App Merged Day Wrapped Design

## Goal

Make the iPhone app show a combined Day Wrapped view with:

- Mac activity from the paired Screencap backend snapshot
- iPhone activity from Screen Time on the same device

without exporting Screen Time-derived iPhone usage data back to the Mac or backend.

## Problem

- The current iPhone refresh flow treats `DeviceActivityReport` like a hidden export pipeline.
- The report extension is expected to write a `MobileActivityDay` file into the shared app group, after which the main app uploads that payload to the backend and re-fetches a combined snapshot.
- On physical devices this path is not reliable and appears to conflict with the privacy boundary around Screen Time report data.
- As a result, the iPhone app usually falls back to the Mac-only snapshot even though the report extension can render iPhone Screen Time data locally.

## Chosen Approach

Render the merged Mac+iPhone view directly inside the visible `DeviceActivityReport` on the iPhone app screen.

The app remains responsible for fetching and caching the selected-day Mac snapshot. The report extension remains responsible for reading live Screen Time data. The merge happens inside the report extension at render time, and the merged result is only shown on the iPhone app screen.

This removes the unsupported dependency on exporting iPhone Screen Time data out of the report extension.

## Data Flow

### Sync From Mac

1. The iPhone app fetches the selected-day `DayWrappedSnapshot` from the backend.
2. The app stores that snapshot in the shared app group cache.
3. The visible `DeviceActivityReport` is refreshed so the extension can re-read the cached Mac snapshot and merge it with live iPhone Screen Time data.

### Refresh iPhone

1. The iPhone app records a new report refresh token for the selected day.
2. The visible `DeviceActivityReport` is recreated for that token.
3. The report extension reads:
   - live iPhone Screen Time data from `DeviceActivityResults`
   - the cached Mac snapshot for the same day from the app group
4. The extension merges both sources and renders one in-app Day Wrapped card.

### Fallback

- The app continues to keep the latest Mac snapshot in `AppModel.snapshot`.
- The wrapped screen places the visible `DeviceActivityReport` above a cached Mac Day Wrapped fallback card.
- If the report extension fails to render, the user still sees the Mac-only fallback instead of a blank surface.

## Merge Rules

- Reuse the existing shared slot model:
  - `count`
  - `category`
  - `appName`
  - `source`
  - `macCount`
  - `iphoneCount`
- Treat the backend snapshot as the Mac baseline for in-app merge purposes.
- Build an iPhone snapshot from Screen Time buckets using the existing iPhone intensity logic.
- Merge slot-by-slot:
  - `source = .both` when both sides have activity
  - `count = max(macCount, iphoneCount)`
  - `category` and `appName` come from the stronger side, with deterministic tie-breaking
  - `macCount` and `iphoneCount` stay separate for accents and filtering
- Compute `sourceSummary` from the merged result:
  - `Mac + iPhone`
  - `Mac`
  - `iPhone`
  - `No activity`

## UI Changes

- Replace the hidden report host with a visible report host in the app’s wrapped screen.
- Stop using the report extension as a background exporter.
- Keep the existing `DayWrappedCardView` visual language by rendering it inside the report extension using the merged snapshot.
- Move day navigation controls outside the card content so the same controls work for both:
  - the visible report host
  - the Mac-only fallback card underneath
- Remove upload-oriented status messaging from the wrapped screen because the new flow no longer uploads iPhone Screen Time data.

## App Model Changes

- Simplify `refreshSelectedDay()` so it no longer waits for `mobile-day-<day>.json`.
- Keep `performMacSync()` for selected-day backend snapshot fetches.
- Refreshing the iPhone report and syncing from Mac become separate actions:
  - `Refresh iPhone` refreshes only the visible report host
  - `Sync from Mac` updates the cached Mac snapshot and then refreshes the visible report host
- Re-sync diagnostics remain focused on bridge reachability and snapshot freshness, not local iPhone export files.

## Out of Scope

- Sending iPhone Screen Time-derived usage data back to the Mac
- Making the home-screen widget show the new merged iPhone view
- Preserving the old upload pipeline as a primary path

## Testing

- Verify the wrapped screen shows Mac-only data before Screen Time authorization.
- Verify the wrapped screen shows a merged `Mac + iPhone` card after authorization on a physical device.
- Verify `Refresh iPhone` refreshes the visible report without requiring a backend round-trip.
- Verify `Sync from Mac` updates the cached Mac contribution and the visible merged report.
- Verify day navigation updates both the cached Mac fallback and the visible merged report for the selected day.
- Verify the fallback Mac snapshot remains visible if the report host fails to render.

## Risks

- The report extension may still be slow to render because `DeviceActivityReport` is platform-controlled.
- Reading the cached Mac snapshot from the shared app group inside the report extension must be validated on-device.
- The backend snapshot may contain stale iPhone contribution from older uploads; the in-app merge should sanitize the backend snapshot to treat it as Mac-only input.
