# Developing Screencap

## Build and run

Requires macOS 26 and Xcode 26 (the command-line tools selected by `xcode-select` are not enough). `scripts/verify.sh` builds before testing because one test runs the real OCR helper from `.build/debug`, and builds for release after testing because the release build reports concurrency errors that the debug build lets through.

```bash
scripts/verify.sh
```

```bash
scripts/build-app.sh
```

`build-app.sh` builds `build/Screencap.app` and signs it with the Developer ID identity in the script (override with `SCREENCAP_SIGNING_IDENTITY`). Screen Recording and Accessibility grants belong to the signature, so keep one identity. Open the app once to grant both; it then lives in the menu bar (left click: the panel; right click: pause, capture now, settings, quit; ⌥⌘S anywhere: the panel; ⌥⌘R anywhere: the resume palette). Selecting a page inside a browser also needs Automation. Onboarding asks for it, and anybody who was onboarded before Resume existed is asked once on the next launch (`automationAsked` in `meta`); until it is asked, a send fails with -1743 exactly as a refusal does. Settings › Resume shows the state and asks again, and System Settings › Privacy & Security › Automation › Screencap is where a refusal is undone. Paste an OpenRouter key in Settings to turn on understanding; without one, capture and search still work.

## Command-line modes

The app binary has a few modes for checks and maintenance (`build/Screencap.app/Contents/MacOS/Screencap …`):

| Command | What it does |
|---|---|
| `headless --minutes N [--store DIR]` | Captures (and understands, when `OPENROUTER_API_KEY` or the Keychain has a key) without UI, then prints counts, OCR coverage, markers, CPU and memory |
| `understand --store DIR [--from-scratch]` | Runs understanding over a store's captures until nothing is left to ask, with responses cached under the store; `--from-scratch` first clears boundaries, activities, threads and decisions (it refuses the app's own store), to measure a changed engine on labelled captures |
| `replay --data experiments/data --store DIR --export DIR` | Runs the understanding engine over the design experiments' six recorded days and writes `seg.json` and `threads.json` for their scorers; the days are the author's own captures, so they and the scorers are not published |
| `delete-activity --id N [--store DIR]` | The inspector's Delete: removes the activity's captures and frames and queues their deletion from the backup |
| `not-this-thread --id N [--store DIR]` | The inspector's "Not this thread": asks the thread question again without the current thread, moves the activity, and prints both threads as the next thread question reads them |
| `--store DIR --view-only` | Opens the UI on a store without capturing into it |
| `--store DIR --snapshot DIR` | Renders every surface to PNGs offscreen and quits; with `SCREENCAP_README=1`, the README's dark window shots instead |
| `backup-once [--store DIR]` | Writes the day files and a snapshot, then uploads everything due |
| `restore --to DIR` | Rebuilds a store from the bucket into an empty folder |
| `compare-stores --store A --restored B` | Compares row counts and frame hashes of two stores |
| `rebuild-bindings [--since DAYS] [--from-scratch]` | Works out how long each place (a browser tab by address, a Claude session, a window) was on screen while each thread was being worked on. The app does this by itself every ten minutes for the last three days |
| `bindings [--thread N \| --name TEXT] [--all]` | What a resume would bring forward for a thread, marking with a dot what it leaves out and why |
| `split-candidates [--apply N]` | Threads whose activities fall into two groups sharing no place at all, and splitting one: the smaller side moves into a thread of its own, named by the writer model before anything moves (so it needs the OpenRouter key) |
| `resume --thread N \| --name TEXT` | Brings that thread's places to the front. Needs the app's Accessibility and Apple Events grants, so run it from the signed app: `open -n -g build/Screencap.app --args resume --name tokenizer` |
| `probe-palette [--out FILE]` | Lays the resume palette's real list out in a window off the screen, over the store, and records its scroll offset after every key, while idle and after a wheel scroll. The list should hold still while the chosen row is in view and never move when nothing is pressed |
| `probe-resume [--find TITLE] [--menus] [--out FILE]` | Accessibility and Automation state, every browser's open tabs as keys, and Claude's window tree, for diagnosing a resume that cannot reach something. `--find` reports whether a conversation's row can be pressed without pressing it |
| `resume-story --spec FILE --out DIR` | Draws the resume palette and its toasts over the made-up threads of the README demo (`demo/resume/story.json`), as PNGs for `demo/resume/render.sh` |
| `probe-windows --out FILE` | Writes what the private-window scanner sees in every browser window (verdict, identifier, frame match; no titles). Run it from the signed app so it has its permissions: `open -n -g build/Screencap.app --args probe-windows --out /tmp/probe.txt` |
| `demo-store --store DIR --pages DIR` | Fills an empty folder with a made-up yesterday on public web pages captured by `scripts/capture-pages.sh`, for screenshots that show nobody's screen |
| `mcp [--store DIR] [--defaults SUITE]` | The MCP server agents read the history through, over stdin and stdout (see [agents.md](agents.md)); `--defaults` reads Settings from another defaults domain, for tests. `scripts/mcp-check.py BINARY --store DIR` drives it through every tool |
| `mcp install\|uninstall CLIENT`, `mcp status` | Connects `claude-code`, `claude-desktop`, `cursor` or `codex` to the server, or disconnects it; `status` shows both switches and each client |

Command-line modes read the OpenRouter key from `OPENROUTER_API_KEY` before the Keychain, so a development build never asks for the signed app's Keychain item. The backup commands take `--endpoint`, `--bucket`, `--region` and `--access-key`, with the secret in `SCREENCAP_BACKUP_SECRET` and the encryption key's recovery text in `SCREENCAP_BACKUP_RECOVERY_KEY` (both fall back to the Keychain). `scripts/fake-s3.py PORT DIR` is a local bucket for testing them.

## Where things live

| What | Where |
|---|---|
| Database, frames, thumbnails | `~/Library/Application Support/com.screencaping.app/` |
| OpenRouter key, backup secret | Keychain, service `com.screencaping.app` |
| Backup encryption key | Keychain of this Mac; Settings exports its recovery key, which another Mac needs to restore or continue the backup |
| Settings | user defaults of `com.screencaping.app` |

## What leaves the Mac

Screenshots of the focused display (1024 px JPEG), window titles, page hosts and OCR excerpts go to OpenRouter for the decision and text models. Text-only mode in Settings stops sending screenshots. Excluded apps, password managers, private browser windows and moments with secure input on are never captured. The backup, when turned on, uploads frames and history encrypted on the Mac (AES-256-GCM); the bucket holds only ciphertext. With agent access on, agents connected to `Screencap mcp` read the history and send what they read to their own AI provider ([agents.md](agents.md)).

## Code map

| Folder | Holds |
|---|---|
| `Sources/ScreencapCore/Model` | Captures, markers, activities, threads, decisions |
| `Sources/ScreencapCore/Store` | The GRDB database, its schema and queries, full-text search |
| `Sources/ScreencapCore/Evidence` | Fingerprints, frame encoding, capture text, the capture gate and recorder, the OCR runner |
| `Sources/ScreencapCore/Understanding` | Model clients, the questions, the engine, corrections, the day timeline, replay |
| `Sources/ScreencapCore/Backup` | Encryption key, sealing, SigV4 and the S3 client, the outbox drain, restore |
| `Sources/ScreencapCore/Agents` | The MCP server, its tools over a read-only store, the access log, connecting agent apps, the skill text |
| `Sources/ScreencapCore/Resume` | Places and the time spent in them per thread, the ranking, thread splits, and a reader per app under `Providers` |
| `Sources/Screencap/Platform/Resume` | Bringing a place back: the window index, a driver per app, and the resumer that runs a plan |
| `Sources/Screencap` | The app: platform capture and context, the UI, the command-line modes |
| `Sources/ScreencapOCR` | The OCR helper process |

## The README's screenshots

They show a made-up yesterday built from public web pages (Wikipedia, Apple's documentation, GitHub, the Rust book, NASA, Hacker News, OpenStreetMap), captured in a fresh Chrome profile, so they show nobody's screen. `demo-store` reads the pages' text with the OCR helper, so search finds words on them. `readme-shots.py` frames the screenshots and turns the frames of the main window and the menu-bar panel into `docs/readme/window.gif` and `docs/readme/popup.gif` with `ffmpeg`, which must be installed:

```bash
scripts/capture-pages.sh /tmp/screencap-pages
build/Screencap.app/Contents/MacOS/Screencap demo-store --store /tmp/screencap-demo --pages /tmp/screencap-pages
SCREENCAP_README=1 build/Screencap.app/Contents/MacOS/Screencap --store /tmp/screencap-demo --view-only --snapshot /tmp/screencap-shots
python3 scripts/readme-shots.py /tmp/screencap-shots docs/readme
```

The Resume GIF, `docs/readme/resume.gif`, is its own project in `demo/resume`: a made-up afternoon on a Mac, drawn with [Remotion](https://www.remotion.dev). It opens on the problem before it shows Screencap: a bug fix in three places, a switch to a trip in the same windows, and seven steps to get the bug fix back by hand; then the same moment with the palette. The captions sit under the screen, set as the Day page sets its headline, with the keys drawn inline as the palette draws them; the camera moves in on whatever a beat is about, and every size is chosen for the width GitHub shows the GIF at (`src/layout.ts`). It is styled as Screencap is, with the inks, surfaces and thread colours of `Theme.swift` and the README's backdrop. The palette in it is the app's own: `Screencap resume-story` writes the threads of `demo/resume/story.json` into a throwaway store, with the screens the demo drew for them, and draws `ResumePalette` over it in each state the demo shows. Every person, page and session in it is invented. One script renders all of it and needs Node, `ffmpeg` and Xcode:

```bash
demo/resume/render.sh
```

To change the timing or the scenes, `npm run studio` in `demo/resume` opens the demo in Remotion's editor. The beats, captions, camera and keys are in `src/script.ts`, the windows in `src/apps.tsx` and `src/desktop.tsx`, and the threads, their places and the palette's states in `story.json`; after changing `story.json`, run `render.sh` again, since the palette is drawn from it.
