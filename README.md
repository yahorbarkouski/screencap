# Screencap

Screen activity tracker for macOS with LLM-powered screenshot classification, project progress detection, and daily “Day Wrapped” journaling.

Screencap is **local-first**: captures and metadata are stored on your machine in **SQLite + the filesystem**. Optionally, it can use OpenRouter (cloud) and/or a local HTTP model for classification. By default, cloud classification is **text-first** (context metadata + local OCR text). Screenshot uploads are only used when `allowVisionUploads = true`.

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Local LLM](#local-llm)
- [Project status / known gaps](#project-status--known-gaps)
- [Privacy, networking, and data](#privacy-networking-and-data)
- [Permissions (macOS)](#permissions-macos)
- [Security model](#security-model)
- [Repo layout](#repo-layout)
- [Development](#development)
- [Build & packaging](#build--packaging)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Extending Screencap](#extending-screencap)
- [License](#license)

## What it does

### Timeline

- Captures screenshots on a schedule (all displays).
- Groups captures into “events” and shows them in a timeline.
- Shows LLM classification results per event:
  - **Category**: `Study | Work | Leisure | Chores | Social | Unknown`
  - **Subcategories**, **tags**, **caption**
  - **Project** + **project progress** (visual progress evidence)
  - **Addiction signals** (confirmed or “review” candidates)
- Supports:
  - **Previewing** an event (including multi-display captures)
  - **Relabeling** an event (stored as `user_label`)
  - **Dismissing** or **deleting** events
  - **Copy image to clipboard** (safe allowlisted IPC)
  - **NSFW blur**

### Project progress

- Filters events where the LLM marked **project progress** (`projectProgress = 1`).
- Groups progress events by day and by project.
- For progress events, the app keeps a **high-res** PNG capture (see “On-disk layout”).

### Journal (“Day Wrapped”)

- Daily view that computes activity metrics from captured events and can generate a short journal entry via the LLM.
- Includes a **tray popup** (“Day Wrapped”) showing a compact day heatmap and quick actions.

### Memory (prompt personalization)

“Memory” is how you teach the classifier what matters to you. Memories are stored locally and injected into prompts.

- **Projects**: names the model is allowed to assign to events.
- **Addictions**: strict rule definitions you want to track (used in a 2-stage addiction verification flow).
- **Preferences**: classification hints / constraints.

### Context detection (macOS)

To make events more specific than “browser tab”, Screencap can detect foreground context:

- Foreground **app** bundle id + name (via AppleScript / System Events)
- Foreground **window title**, bounds, display id, and fullscreen heuristic
- For browsers (Safari + several Chromium variants): current tab **URL + title**
- URL canonicalization (tracking params stripped) + content resolvers for:
  - YouTube videos/shorts
  - Netflix watch pages
  - Twitch streams / VODs
  - Generic web pages

See `docs/adding-context-providers.md` for implementation details and tests.

## How it works

### Architecture at a glance

Screencap is a standard Electron “3-layer” app:

- **Main process** (`electron/main`): privileged OS access (screen capture, filesystem, SQLite, tray, permissions).
- **Preload** (`electron/preload`): a minimal `window.api` bridge built with `contextBridge`.
- **Renderer** (`src`): React UI that talks only through `window.api`.

### Capture → event → classify pipeline

High-level flow:

1. **Scheduled capture is windowed (dominant activity)**:
   - The app continuously polls the foreground app/window.
   - When the foreground stays stable for ≥ 10s, it takes a **temporary** multi-display capture candidate.
   - Candidates are keyed by **URL host** for browsers and **bundle id** for other apps.
   - At the end of each interval, it picks the **dominant** key by time (ignoring < 10s interruptions), keeps only that candidate, and deletes the rest.
   - If permission is missing, nothing is stored. If the system is idle at the tick, the window is finalized up to the last input time (idle tail discarded). If no candidate exists, nothing is stored.
2. **Manual capture** is immediate (single capture group).
3. **Context capture**:
   - `ContextService` collects a foreground snapshot and (if supported) URL/content enrichment.
   - `buildContextKey(...)` generates a stable key like `youtube:<id>` or `app:<bundleId>:<window>`.
4. **Screen capture**:
   - `desktopCapturer` grabs all displays.
   - Each display is saved as thumbnail (`~400px` WebP) + “original” (`~1280px` WebP).
   - For the primary display only: optional high-res PNG (`*.hq.png`).
   - Captures are fingerprinted (perceptual dHash) for merge decisions.
5. **Event creation & merge**:
   - New captures are merged into the last event (same display) only if:
     - within a time gap threshold (`interval * 2 + 30s`)
     - **context key** matches
     - fingerprints are “similar” (stable + detail dHash thresholds)
   - Otherwise a new `events` row is created plus `event_screenshots` rows for each display.
   - For windowed scheduled events, the event time range is `windowStart → windowEnd`.
6. **Queue for AI**:
   - the event is enqueued by id (`queue` table)
7. **Queue processor** (every 10s):
   - applies classification reuse cache by `(stableHash, contextKey)`
   - runs local OCR (macOS Vision) and uses context metadata
   - routes through providers (local retrieval → optional local LLM → optional cloud text → optional cloud vision)
   - updates the event with classification fields
   - deletes the high-res PNG if **project progress is not shown** (storage minimization)

### “Primary display” rules

- Scheduled captures pick the primary display as the display containing the foreground window (when context is available), falling back to the OS primary display.
- Manual captures pick the primary display based on the sender window’s position (and temporarily hide the sender window to avoid capturing UI overlays).

## Configuration

### Settings

Settings are stored in `settings.json` (under the app’s user data directory) and surfaced in the UI (Settings view).

- `apiKey`: OpenRouter API key (stored encrypted with Electron `safeStorage` when available).
- `captureInterval`: capture interval (minutes). Used by the scheduler.
- `retentionDays`: retention window (days). Events and screenshots older than this are automatically deleted.
- `excludedApps`: apps excluded from **scheduled** capture (manual capture bypasses this).
- `launchAtLogin`: launch at login toggle.
- `allowVisionUploads`: allow uploading screenshots for vision-based classification (default: `false`).
- `localLlmEnabled`: enable local OpenAI-compatible provider (default: `false`).
- `localLlmBaseUrl`: local base URL (default: `http://localhost:11434/v1`).
- `localLlmModel`: local model id/name (default: `llama3.2`).

### Environment variables

- `LOG_LEVEL`: `debug | info | warn | error` (defaults to `debug` in dev and `info` in prod).
- `NODE_ENV`: affects logging defaults and dev/prod behaviors.
- `ELECTRON_RENDERER_URL`: used in development by the tooling to point the main process at the dev server.

### LLM model

The default OpenRouter model is currently hardcoded in `electron/main/features/llm/OpenRouterClient.ts` as:

- `openai/gpt-5`

## Local LLM

Local LLM support is available via an OpenAI-compatible HTTP server (Ollama / LM Studio). See `docs/local-llm.md`.

## Project status / known gaps

- **Platform support**: currently macOS-focused (AppleScript providers + macOS permission deep-links).
- **Excluded apps**: enforced for scheduled captures; manual capture intentionally bypasses.
- **Local vision**: local multimodal models are not used yet (local integration is text-only via OCR + context).

## Privacy, networking, and data

### What is stored locally

- All events are stored in a local SQLite DB (`better-sqlite3`).
- All screenshots are stored as files under the app’s user data directory.
- `settings.json` stores preferences and (when supported) an **encrypted** OpenRouter API key.

### What is sent over the network

Screencap makes network requests for:

- **OpenRouter (LLM)**
  - Classification (default): sends **text only** (context metadata + OCR text) and may include prompt text containing:
    - your **Memory** entries (projects, addictions, preferences)
    - limited per-event **context** (app name, window title, URL host, content title)
  - Classification (vision): sends the screenshot image only when `allowVisionUploads = true`
  - Journal generation: sends a text list of event summaries (time, caption, category, project/progress markers).
- **Favicons**
  - downloads site icons (`http(s)` only) and caches them locally.
  - blocks `localhost` and common private IPv4 ranges.

No other network endpoints are used by default.

### On-disk layout (macOS)

All data lives under `app.getPath('userData')` (typically `~/Library/Application Support/Screencap/`):

- `screencap.db`: SQLite database
- `settings.json`: user settings (API key encrypted when possible)
- `screenshots/`
  - `thumbnails/<uuid>.webp`
  - `originals/<uuid>.webp`
  - `originals/<uuid>.hq.png` (only kept for progress events)
  - `tmp/<windowId>/...` (temporary candidate captures; cleaned automatically)
  - `favicons/<host>.<ext>`

### Database schema (overview)

Core tables (see `electron/main/infra/db/schema.ts`):

- `events`: one row per “event” in the timeline (can represent a merged time range)
- `event_screenshots`: one row per display screenshot for an event (per capture group)
- `queue`: pending screenshot classifications
- `memory`: prompt personalization entries
- `favicons`: cached favicon paths
- `stories`: saved journal entries

## Permissions (macOS)

Screencap uses OS-level permissions for different capabilities:

- **Screen Recording**: required to capture screenshots (scheduler and manual capture).
- **Accessibility**: improves context capture (window titles, etc).
- **Automation (Apple Events)**:
  - **System Events**: foreground app/window snapshot
  - **Browsers**: Safari / Chromium URL extraction via AppleScript

In development, macOS may show the app as **“Electron”** in the Screen Recording permission list.

## Security model

Screencap treats the renderer as untrusted and uses multiple hardening layers:

- Hardened window config (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`)
- No webviews; popups are denied
- Navigation is blocked to non-app origins; external `http(s)` opens via OS browser
- Strict CSP injected at build time (dev CSP allows HMR; prod CSP is stricter)
- A custom `local-file://` protocol that only serves files under the screenshots directory (realpath + subpath checks)
- IPC is a security boundary:
  - trusted sender allowlist (webContents ids)
  - runtime argument validation via `zod`
  - a single `secureHandle(...)` wrapper for invoke handlers

See `docs/security.md` for the full checklist and extension guidelines.

## Repo layout

- `electron/main/`: main process (app bootstrap, tray, window hardening, SQLite, capture, queue, LLM, permissions)
- `electron/preload/`: `window.api` bridge
- `electron/shared/`: shared IPC channel names + shared types
- `src/`: React renderer UI (timeline, progress, journal, memory, settings)
- `docs/`: security and extension docs

## Development

### Requirements

- macOS (context providers and permission flows are currently macOS-specific)
- Node.js + npm

### Install

```bash
npm install
```

`postinstall` runs `electron-builder install-app-deps` to rebuild native modules (notably `better-sqlite3` and `sharp`) for your Electron version.

### Run (dev)

```bash
npm run dev
```

### Run tests

```bash
npm test
```

Tests are written with Vitest and currently target the Electron-side logic (`electron/**/*.test.ts`).

### Evaluation harness

To compare classification strategies side-by-side on your local data:

```bash
npm run eval:classification -- --limit=25 --strategies=vision,text,local
```

## Build & packaging

### Build bundles

```bash
npm run build
```

This produces the Electron build output under `out/`.

### Preview the built app

```bash
npm run preview
```

### Create a DMG (macOS)

This repo includes an `electron-builder.yml` config. A typical packaging flow is:

```bash
npm run build
npx electron-builder --config electron-builder.yml
```

Artifacts are output to `dist/`.

## Troubleshooting

### “No events yet” / empty screenshots

- Ensure **Screen Recording** permission is granted.
- In dev, grant Screen Recording permission to **Electron**.
- If the permission was granted while the app was running, fully quit and restart the app.

### Context detection shows empty / denied

- Grant **Accessibility** permission.
- Grant **Automation** permission for:
  - System Events
  - your browser (Safari / Chrome / Brave / Edge / etc.)
- Use Settings → “Test Context Detection” to verify.

### OpenRouter errors / events stuck then “failed”

- Add an OpenRouter API key in Settings and use “Test”.
- If no API key is configured, events still complete using local providers (retrieval/baseline). Cloud providers are skipped.

### OCR issues

- OCR runs locally using macOS Vision and is used to power text-first classification (cloud text + local LLM).
- Packaged builds bundle the OCR helper automatically. In development, OCR requires the helper binary at `build/ocr/screencap-ocr`.

### Native module install failures (`better-sqlite3`, `sharp`)

- Ensure you have macOS build tools (Xcode Command Line Tools).
- Re-run `npm install`.

## Contributing

This repo is structured so that sensitive capabilities live in the main process and cross the boundary only via explicit IPC.

- **Bug reports**: include your macOS version, whether Screen Recording/Accessibility/Automation permissions are granted, and (if relevant) `LOG_LEVEL=debug` logs.
- **Pull requests**:
  - keep IPC changes minimal and follow `docs/security.md`
  - add/extend unit tests for pure logic (see `electron/**/__tests__`)
  - prefer small, composable utilities over feature-specific duplication

## Extending Screencap

### Add a context provider or resolver

See `docs/adding-context-providers.md`.

### Add a new IPC capability

Follow the security checklist in `docs/security.md`:

- define the channel name in `electron/shared/ipc.ts`
- implement with `secureHandle(...)` + `zod` args schema in `electron/main/ipc/validation.ts`
- expose it via the preload `window.api` object

## License

MIT (see `LICENSE`).
