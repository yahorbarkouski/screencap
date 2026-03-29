# iPhone Widget Sync And Debugging Design

## Goal

Make the iPhone companion reliably refresh the widget from the paired Mac, expose a one-tap manual sync action, and replace the current opaque Screen Time refresh failure with actionable diagnostics.

## Problems

- The widget already renders the desktop-computed combined Day Wrapped snapshot, but the refresh path is implicit and not user-controlled.
- The iPhone app times out quickly while waiting for the Screen Time report extension and only shows a generic error.
- There is no shared logging surface across the iPhone app, widget cache, and report extension, so failures are hard to diagnose.
- The app does not attempt regular best-effort refreshes while it is active or when iOS grants background execution time.

## Chosen Approach

Split the flows and instrument them:

1. Keep iPhone Screen Time export as a dedicated refresh path.
2. Add an explicit `Sync from Mac` action that fetches the current combined snapshot from the paired Mac and reloads the widget.
3. Add best-effort automatic refresh every ten minutes using:
   - a foreground timer while the app is active
   - `BGAppRefreshTask` scheduling when iOS grants background execution time
4. Add shared app-group diagnostics and rolling logs so the app can report the exact stage that failed.

## Data Flow

### Refresh iPhone Data

1. The app records a refresh request in the shared app-group store.
2. The hidden `DeviceActivityReport` view requests hourly Screen Time data for the selected day.
3. The report extension writes the produced `MobileActivityDay` file and lifecycle markers into the app-group store.
4. The app waits longer for the day file, reads the lifecycle markers, uploads the day to the paired Mac, fetches the combined snapshot, stores it, and reloads WidgetKit.

### Sync From Mac

1. The app calls the existing signed `/api/me/day-wrapped-snapshot` endpoint on the paired Mac bridge.
2. The returned snapshot is written to the shared app-group snapshot file.
3. WidgetKit timelines are reloaded.

This path does not depend on the Screen Time report extension producing fresh iPhone activity first.

## Diagnostics

Add a shared app-group diagnostics layer with:

- rolling text log file
- last report request token and requested day
- report started timestamp
- report finished timestamp
- produced day start
- last report error
- snapshot write timestamp
- last manual Mac sync timestamp
- last automatic Mac sync timestamp

The iPhone app exposes a `Copy Logs` button that copies:

- identity and paired Mac base URL
- selected day
- authorization status
- widget snapshot metadata
- mobile-day file metadata for the selected day
- lifecycle markers
- recent rolling log lines

## UI Changes

- Rename the current refresh control to clarify it refreshes iPhone Screen Time data.
- Add a `Sync from Mac` button beside it.
- Add a `Copy Logs` button in the same actions area.
- Improve error text so it identifies the failing stage when possible.
- Show last successful Mac sync time in the status text when available.

## Background Refresh

Register a background refresh task for the iPhone app that:

- attempts to upload any already-written mobile activity file for today
- fetches the current combined snapshot from the paired Mac
- reloads WidgetKit
- reschedules itself

This is best-effort only. iOS may delay or skip executions, so foreground refresh remains important.

## Platform Plumbing

- Add `BackgroundTasks` registration and permitted task identifiers.
- Add local-network usage description because the iPhone app talks to the Mac over the LAN bridge.
- Keep the current local bridge protocol and signed requests unchanged.

## Risks

- `DeviceActivityReport` may still be slow or inconsistent for freshly requested days.
- Background refresh cadence is controlled by iOS and cannot be guaranteed every ten minutes.
- The paired Mac bridge URL can still become stale if the Mac IP changes; this design keeps the existing network model and focuses on visibility and recovery first.

## Verification

- Unit tests for desktop snapshot composition remain green.
- Typecheck and lint still pass for the Electron app.
- iOS compile validation covers new background task, logging, and app-group plumbing.
- Manual QA:
  - pair iPhone and trigger `Refresh iPhone Data`
  - trigger `Sync from Mac`
  - verify widget updates
  - verify `Copy Logs` includes recent report and sync markers
