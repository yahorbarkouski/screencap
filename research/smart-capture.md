# Smart capture: what the timer misses and what input triggers cost

Date: 2026-10-15. Reader: Yahor, and the session that changes Screencap's capture and understanding code. The document answers two questions. Does today's capture schedule (a 60 s timer plus a capture when the app or website changes) miss screens that matter? And what would capturing on input events catch, and what would it cost?

## Answer

- **Yes, it misses screens.** In 2.32 active hours of Yahor's normal use, today's schedule never captured 27% of the windows and pages he stayed on for 10 seconds or more, and 7% of those he stayed on for 30 seconds or more. Every app and site he stayed on for 30 seconds or more got a capture. The misses have three causes:
  - Page and tab changes inside one site start no capture.
  - Captures are at least 30 s apart, so a short visit between two captures leaves no frame.
  - A timer tick skipped right after a switch capture leaves an 85–90 s gap.
- **Recommended policy: dwell capture (P13).** It captures:
  - a page once its title or URL has held for 10 s;
  - the screen once it has stayed still for 10 s after any change;
  - the screen 3 s after a burst of typing;
  - the screen whenever 60 s have passed since the last capture.

  It replaces the 5 s switch capture. On the same timeline it captures 97% of the windows and pages lasting 10 s or more, against 73% for today's schedule simulated the same way. It keeps 128 frames an hour against 80.
- **Model money stays flat.** The boundary question runs only on anchors (section 1): about one frame a minute plus the first frame at each new app or site. On that rule the policy asks 73 questions an hour against today's 80, which comes to $2.09 a month against $2.16 (8 active hours a day, 26 days a month).
- **The cost is CPU, through OCR.** The model is calibrated on the measured hour of the final build, which used 1.00% of a core at 91 kept frames an hour. On this timeline it puts today's schedule at 0.90% and dwell capture at 1.29% if every frame is OCR'd. Storing the 55 frames an hour that get no question as pictures without OCR brings dwell capture to 0.85%.
- **Built and measured the same evening (section 7).** Yahor approved dwell capture. The build reads text on every anchor, and on an extra frame only when it shows new content, at most 12 an hour; the other extra frames are kept as pictures. In a measured hour of real use it captured 91% of the views held 10 s or more and all of those held 30 s or more. Today's schedule, simulated on the same hour, would have captured 67% and 94%. The app and its OCR helper used 0.83% of a core, against 1.00% for the final build's hour under today's schedule.

## 1. Method

**Logger.** [`experiments/tools/smart-capture/logger.swift`](../experiments/tools/smart-capture/logger.swift) ran from 16:16 to 19:16 on 2026-10-15 while Yahor used the Mac normally. Once a second it writes one line with the number of key presses, modifier presses, clicks, scroll events, mouse moves and drags since the previous second. The counts come from `CGEventSource.counterForEventType(.combinedSessionState, ...)`, which needs no permission. Each line also holds the seconds since the last input and the current focus: the frontmost app's bundle id plus salted SHA-256 hashes of the window title and of the browser page's host and path. The logger reads titles and URLs through the same Accessibility calls as `ContextMonitor` (the process was trusted). It writes focus changes, sleep, wake and lock the moment they happen. No key contents, titles, URLs or screen contents are stored, and this report gives counts, durations and app categories only.

**Window.** All three hours, of which 2.32 were active. A second counts as active when the app's capture gate would allow a capture: input in the last 5 minutes, screen unlocked and awake, no secure input. The Mac had one display. The session building the app restarted it five times inside the window, and no active stretch went more than 90 s without a capture.

**Alignment.** [`analyze.py`](../experiments/tools/smart-capture/analyze.py) reads a `VACUUM INTO` copy of the app's store. It hashes each capture row's title and URL with the logger's salt and lines the captures up with the timeline. At 198 real captures, the logger's focus matched the app's own record 98% of the time on app and site, and 97% on app, title, site and path.

**Simulator.** The same script replays capture policies on the logged timeline. Replayed with the app's five restarts, today's schedule makes 196 captures, 84 an hour, against the app's 198. Every real timer capture has a simulated one within 2 s, and 83% of real switch captures have one within 5 s. Each switch capture's time depends on the capture before it through the 30 s spacing rule, so one difference shifts several captures after it. Sections 4 to 6 compare every policy against P0, which simulates today's schedule with a steady timer and no restarts (83 captures an hour). Section 3 uses the real captures.

**Figures reused from other documents.** The development log (IMPLEMENTATION.md) and the plan (plan/) describe the author's own captures and are not published.

- **The measured hour** is the final build's headless hour, 18:17–19:17 on 2026-10-15, in IMPLEMENTATION.md. It made 93 captures, kept 91 and OCR'd 90. CPU was 0.29% of a core in the app and 0.72% in the OCR helper, 1.00% in all. The cost model in section 5 is calibrated on it.
- **The live hour** is the earlier signed-app hour from 14:49, before the warm OCR helper and the cached model JPEG. It made 89 captures, kept 80 and spent 1.27% of a core.
- **The 1% budget** is the target in plan/03-capture.md: the app and its OCR helper together should average at most 1% of one core over a tracked day.
- **The labelled live day** is 13:40–15:50 on the same day, which IMPLEMENTATION.md also calls the development day. Its gold labels gave boundary F1 0.600, and 34 of its 39 false boundaries came at switch captures. The **first and second held-out stretches** are 16:07–17:47 and 17:59–18:59, both labelled twice and both inside or overlapping this logger's window.

**Terms.**

| Term | Meaning |
|---|---|
| View | The app's context key: app, window title without unread counters, site and path. A new tab, page or document is a new view. A change of the URL's query string alone is not a view change. |
| Place | App and site: the key whose change starts today's switch capture. |
| Quiet screen | A stretch with no key press (a shortcut included), click, scroll or view change; mouse moves and drags do not end it. It starts at a change and ends at the next one. A change is a view change, a click, the end of a scroll (the first second with no scroll events) or the end of typing (the first second with no key presses). |
| Typing burst | A run of seconds with key presses, with no two empty seconds in a row, holding 8 or more presses. Shorter runs are mostly shortcuts. |
| Kept frame | A capture that dedupe keeps: its frame is written and backed up. A duplicate is stored as a row without a frame. |
| Anchor | A kept frame that gets a boundary question. In designs B to D (section 5), anchors are: timer frames; wake and unlock frames; switch frames, in policies that keep the switch capture; the first frame at an app or site different from the previous anchor's; and an event frame when no anchor has come for 55 s. |
| Evidence frame | A kept frame that is not an anchor. It is stored, backed up and shown in the timeline, and OCR'd in every design except D. |
| Event capture | A capture made by an input trigger (view held, settle, typing, click, scroll, place held), as opposed to the timer, switch and wake captures. |
| Token bucket | A cap on event captures. It holds a few captures that can be spent in a row after a quiet spell and refills at a fixed rate; a trigger that finds it empty waits for the next token. |

## 2. Measured behaviour

The window was mostly browsing. The browser held the screen for 72% of the active time, AI assistants 16%, chat and mail 5%, and other apps 7%.

| Input | Events per active hour | Active seconds with any |
|---|---:|---:|
| Key presses | 284 | 3.6% |
| Clicks | 690 | 16.1% |
| Scroll events | 29,776 | 19.2% |
| Mouse moves | 61,831 | 43.2% |
| Drags | 2,699 | 10.2% |
| Title notifications from Accessibility | 3,659 | 49.8% |
| No key, click, scroll, move or drag | | 46.1% |

Typing was light: 13 bursts an hour, a median 12 keys over 4 s (90th percentile 21 keys over 7 s), plus 44 shorter runs an hour.

| Focus level | Changes per active hour | Median length | 90th percentile | Shorter than 5 s | Shorter than 60 s |
|---|---:|---:|---:|---:|---:|
| App | 96 | 8 s | 80 s | 35% | 84% |
| Place | 132 | 8 s | 72 s | 38% | 88% |
| View | 231 | 5 s | 40 s | 49% | 94% |

Views change almost twice as often as places, because pages and tabs inside one site change every few seconds. Nearly every change follows the person's own input. Of 314 changes of page, site or title within one app, 4 came with no key, click or scroll in the 3 s before. Of 222 app switches, 34 did, likely through notifications or the Dock. A trigger on view changes therefore fires on the person's actions; pages that update their own titles rarely set it off.

## 3. What today's schedule misses

Today's schedule, in `Sources/Screencap/Platform/CaptureEngine.swift`:

- A repeating 60 s timer. A tick within 30 s of the last capture is skipped.
- A switch capture 5 s after a place change, and at least 30 s after the previous capture.
- A capture on wake and unlock.

The window held 198 real captures, 85 per active hour: 71 by timer and 127 by switch. 8 of them were duplicates. The median gap between captures was 35 s.

**Views and places that never got a capture**, counting active time only:

| States lasting at least | States | Never captured | Active minutes per hour spent in them | Median and longest missed | Categories of the missed ones |
|---|---:|---:|---:|---:|---|
| Place, 5 s | 190 | 62 (33%) | 4.3 | 8 s, 25 s | browser 30, chat and mail 14, AI assistant 13, other 5 |
| Place, 10 s | 137 | 26 (19%) | 2.6 | 13 s, 25 s | browser 17, chat and mail 4, AI assistant 3, other 2 |
| Place, 30 s | 73 | 0 | 0 | | |
| View, 5 s | 274 | 130 (47%) | 9.7 | 8 s, 49 s | browser 97, chat and mail 16, AI assistant 13, other 4 |
| View, 10 s | 170 | 46 (27%) | 5.8 | 14 s, 49 s | browser 36, chat and mail 5, AI assistant 3, other 2 |
| View, 30 s | 73 | 5 (7%) | 1.4 | 42 s, 49 s | browser 5 |

So 10 of every 60 active minutes went to views of 5 s or more that left no frame, mostly pages within one site. The missed places are visits of 5 to 25 s (median 8 s) that began and ended between two captures held apart by the 30 s rule.

**The 85–90 s gaps.** A switch capture that lands 30 to 35 s after a timer capture puts the next tick less than 30 s after it. That tick is skipped, and the next capture comes 85 to 90 s after the switch capture. The 30 s rule often defers a switch capture to exactly 30 s after a timer capture, which gives the full 90 s:

```
0 s timer capture ── 30 s switch capture ── 60 s tick skipped (29.9 s after) ── 120 s timer capture
```

Of the 196 gaps between consecutive captures shorter than 5 minutes, 11 lasted 85–90 s (6 of them exactly 90 s), and every one was a switch capture followed by a timer capture. Two of the five missed views of 30 s or more (33 to 49 s long) sat inside such a gap; the other three fit inside ordinary 60 s gaps between timer captures.

**Moments after input.** Each row is a moment when the screen likely showed something new and the person paused on it. "Captured" means a capture fell inside the pause.

| Moment | Pause at least | Per active hour | Captured today |
|---|---:|---:|---:|
| Click, then no key, click, scroll or view change | 5 s | 44 | 39% |
| Click, then the same | 10 s | 18 | 60% |
| Scroll of 10 or more events, then the same | 5 s | 23 | 17% |
| Scroll, then the same | 10 s | 7 | 44% |
| Quiet screen | 5 s | 150 | 28% |
| Quiet screen | 10 s | 47 | 52% |
| Quiet screen | 30 s | 10 | 96% |

**Typing.** The next capture came within 30 s of 80% of the 30 typing bursts and within 60 s of all of them, a median 18 s later. Fifteen bursts ended with the page changing within 1.5 s (typing, then Enter); for those, the new page is what a capture can show. The other 15 stayed on screen for 3 s or more in the same view, and 4 of them were captured there.

**Between captures.** In 41% of the 196 gaps at least one view of 5 s or more began and ended unseen, 56 such views an hour. In 64% at least one quiet screen of 5 s or more did, 107 an hour, and up to 3 fell in a single gap at the 90th percentile.

## 4. Policies simulated

Every policy keeps the app's idle, lock, secure-input, exclusion and private-window gate, and its dedupe. An event capture comes at least 10 s after the previous capture unless the rule says otherwise. A trigger that arrives inside that spacing waits. Triggers that arrive while one waits merge into a single capture, taken no earlier than the latest of them. "Timer after last capture" means a capture whenever 60 s have passed since the last capture of any kind.

| Policy | Rule |
|---|---|
| P0 current | 60 s repeating timer with the 30 s skip; switch capture on a new place held 5 s, 30 s spacing |
| P0b timer after last capture | P0 with the timer counted from the last capture |
| P1 typing pause | P0, plus a capture 3 s after a typing burst |
| P2 click settle | P0, plus a capture when 2 s pass after a click with no key, click or scroll |
| P3 scroll stop | P0, plus a capture 2 s after a scroll of 10 or more events ends |
| P4 every view change | P0, plus a capture when any new view holds 3 s |
| P5 adaptive interval | Switch capture as in P0; timer every 20 s while there was a key, click or scroll in the last 20 s, else every 60 s |
| P6 all triggers | Timer after last capture, switch as in P0, plus the triggers of P1 to P4 |
| P7 all triggers, capped | P6 with 15 s spacing and a token bucket of 3, refilled at 2 a minute |
| P8 settled changes | Timer after last capture, switch as in P0; typing pause 3 s, view held 5 s, click settle 3 s; 20 s spacing; bucket of 2 refilled at 1.5 a minute |
| P9 settle 5 s | Timer after last capture, switch as in P0, plus a capture once a quiet screen has lasted 5 s |
| P10 settle 10 s | P9 with a 10 s dwell |
| P11 view + settle, with switch | Timer after last capture, switch as in P0, plus view held 10 s and quiet screen 10 s |
| P12 view + settle | P11 without the 5 s switch capture |
| P13 dwell capture | P12, plus the typing pause; bucket of 4 refilled at 3 a minute |
| P14 dwell capture + place | P13, plus a capture once a new app or site has held 10 s |

**Coverage.** Each percentage is the share of states or moments that got at least one capture during them.

| Policy | Captures/h | Kept/h | Places 5 s+ | Places 10 s+ | Views 5 s+ | Views 10 s+ | Views 30 s+ | Missed view min/h | Typing that stayed | Click 3 s+ | Scroll 3 s+ | Quiet 10 s+ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| P0 current | 83 | 80 | 67% | 79% | 54% | 73% | 96% | 9.5 | 8 of 15 | 23% | 19% | 52% |
| P0b timer after last capture | 83 | 80 | 66% | 81% | 51% | 71% | 93% | 10.0 | 8 of 15 | 27% | 17% | 54% |
| P1 typing pause | 94 | 89 | 71% | 79% | 55% | 73% | 96% | 9.5 | 15 of 15 | 25% | 21% | 50% |
| P2 click settle | 179 | 164 | 81% | 89% | 71% | 85% | 100% | 5.2 | 12 of 15 | 74% | 29% | 78% |
| P3 scroll stop | 216 | 195 | 81% | 93% | 78% | 94% | 99% | 3.5 | 11 of 15 | 37% | 66% | 73% |
| P4 every view change | 189 | 178 | 95% | 100% | 92% | 100% | 100% | 0.9 | 9 of 15 | 48% | 23% | 66% |
| P5 adaptive interval | 174 | 160 | 75% | 88% | 69% | 88% | 100% | 4.8 | 12 of 15 | 35% | 43% | 82% |
| P6 all triggers | 273 | 246 | 92% | 100% | 89% | 100% | 100% | 1.2 | 15 of 15 | 55% | 57% | 99% |
| P7 all triggers, capped | 162 | 149 | 73% | 89% | 66% | 88% | 100% | 5.5 | 10 of 15 | 40% | 40% | 76% |
| P8 settled changes | 137 | 128 | 71% | 86% | 63% | 84% | 100% | 6.2 | 10 of 15 | 40% | 27% | 68% |
| P9 settle 5 s | 195 | 176 | 77% | 92% | 71% | 92% | 100% | 4.2 | 12 of 15 | 49% | 48% | 100% |
| P10 settle 10 s | 117 | 110 | 68% | 87% | 56% | 81% | 100% | 7.3 | 11 of 15 | 33% | 26% | 94% |
| P11 view + settle, with switch | 163 | 150 | 73% | 94% | 66% | 97% | 100% | 4.4 | 7 of 15 | 38% | 34% | 95% |
| P12 view + settle | 127 | 118 | 67% | 91% | 62% | 96% | 100% | 5.0 | 6 of 15 | 33% | 29% | 94% |
| P13 dwell capture | 137 | 128 | 72% | 93% | 64% | 97% | 100% | 4.7 | 14 of 15 | 35% | 31% | 92% |
| P14 dwell capture + place | 144 | 134 | 75% | 96% | 67% | 98% | 100% | 4.3 | 13 of 15 | 38% | 37% | 92% |

Column meanings:

- **Missed view min/h:** active minutes an hour spent in views of 5 s or more that got no capture.
- **Typing that stayed:** of the 15 typing bursts that stayed 3 s or more in the same view, how many got a capture there.
- **Click 3 s+:** clicks followed by at least 3 s with no key, click, scroll or view change, with a capture inside that pause.
- **Scroll 3 s+:** the same, for scrolls of 10 or more events.

P0 lands on section 3's real figures for views of 10 s or more (73% against 73%) and quiet screens of 10 s or more (52% against 52%). Typing is the exception: P0 catches 8 of the 15 bursts that stayed and the real app caught 4, because whether a 60 s tick lands in a few seconds of typing depends on its phase.

What the table shows:

- **A single input trigger buys one kind of coverage for 84 to 115 more kept frames an hour.** Click settle covers clicks (P2), scroll stop covers scrolls (P3) and view change covers views (P4).
- **The settle trigger reaches every kind of change.** Every click, scroll, typing burst and view change ends in a quiet screen, so one rule covers them all. With a 10 s dwell, it lifts quiet screens of 10 s or more from 52% to 94% for 30 more kept frames an hour (P10). A 5 s dwell reaches 100% for 96 more (P9).
- **A 10 s view hold covers the pages.** Adding it lifts views of 10 s or more from 81% (P10) to 96–97% (P11, P12). Many pages pass while the person keeps scrolling, so they never hold a quiet 10 s, and the view trigger catches them.
- **The 5 s switch capture adds little once these triggers exist.** P12 drops it and matches P11 on views of 10 s or more (96% against 97%) and on quiet screens (94% against 95%), with 32 fewer kept frames an hour. P12 gives up apps and sites visited for 5 to 10 s: coverage of places of 5 s or more falls from 73% to 67%. Section 6 checks what that does to the check-ins of the second held-out stretch.
- **A place held 10 s is caught through its pages and pauses.** Under P13 that covers 93% of places of 10 s or more, against 79% today. A site visited as a string of pages shorter than 10 s, with no still moment, gets no frame. A place-held trigger (P14) lifts that to 96% for 6 more kept frames an hour.
- **The typing pause costs 10 kept frames an hour** (P12 to P13) and catches 14 of the 15 bursts whose text stayed on screen, against 6 for P12.
- **Counting the timer from the last capture caps every gap at 60 s,** but on this timeline it changes coverage within noise: views of 30 s or more get 93% under P0b against 96% under P0. Its place is inside a policy with event triggers, which fill the gaps it leaves.
- **Dedupe drops few event frames.** Of real captures taken after a view change, 3 of 153 were duplicates. Of those after input with no view change, 4 of 23 were, and of those with no input since the previous capture, 1 of 22. Event triggers fire right after input, so the simulation keeps 93% of P13's captures.
- **The cap never bound.** P13's busiest minute held 5 captures in all, inside its bucket of 4 refilled at 3 a minute. The cap stays as protection against bursts.

The sweeps varied the dwell, the view hold and the spacing; the full table is in the appendix. What they show:

- A 5 s view hold covers 99% of places of 10 s or more, for 31 to 41 more kept frames an hour than a 10 s hold.
- A 15 s hold drops views of 10 s or more to 80–87%.
- At a 10 s dwell, a 20 s spacing saves 4 kept frames an hour and loses 7 points of quiet-screen coverage.

## 5. What it costs

### What scales with what

| Cost | Scales with | Value |
|---|---|---|
| Boundary question | Anchors | $0.0000547 each, the mean of the 184 asked in the window (two screenshots at 1024 px and a window of up to 12 captures) |
| Caption, thread, card, category, provisional-thread and join calls | Activities | $0.00041 per activity, from the window's decision log; the app closed 14.7 activities per active hour. A one-off backfill of 117 title calls and 2 day-story calls in the window are left out |
| OCR | OCR'd frames | 0.288 s of CPU per frame: the measured hour's 0.72% over its 90 OCR'd frames, helper starts included. IMPLEMENTATION.md measured 0.31 s for the recognition itself; this report's benchmark medians were 0.35 s within one view and 0.25 s across a page change |
| Capture | Captures | 0.5 ms of app CPU each, plus 7 ms in `replayd`, the macOS screen-capture daemon |
| Encode, thumbnail, insert | Kept frames | about 11 ms of CPU each |
| Model JPEG | Anchors | 23.5 ms of CPU each, built once now that it is cached |
| Remaining app work | Anchors (attributed) | 0.044 s per question. This is what is left of the measured hour's 0.29% after the idle shell (0.09%, the app's CPU with no capture work, from plan/03-capture.md), capture, encode and the JPEGs. It also holds the activities' calls, so it is an upper bound for work that grows with questions |
| Storage and backup | Kept frames | 134 KB each. Frames stay on the Mac for 90 days and in the backup for good (plan/04-storage-backup.md). Cloudflare R2 charges $0.015 per GB-month after the first 10 GB, and writes are free up to 1 million a month |

Captures change model money only through boundary questions. The activity calls come to $0.0060 an hour, 58% of today's modelled $0.0104, and the tables hold them fixed. The measured hour itself spent $0.0074.

The measured hour ran headless, with no panel or window, so the menu-bar app's UI work is outside these CPU figures. On this timeline the model puts today's schedule at 0.90% of a core (0.64% OCR, 0.27% app). That is below the measured hour's 1.00% because this timeline keeps 80 frames an hour against that hour's 91.

### Four ways to use the extra frames

- **A. Every kept frame is an anchor.** It gets a boundary question and full OCR. This is how today's pipeline treats every frame.
- **B. Evidence frames.** The boundary question runs on anchors only. Every kept frame still gets full OCR, search and a place in the timeline. P12 to P14 ask fewer questions this way than today; policies that keep the 5 s switch capture ask as many or more.
- **C. As B, with changed-region OCR on evidence frames.** OCR reads only the tiles that changed since the previous frame (measurements below).
- **D. As B, with no OCR on evidence frames.** They appear in the timeline and the inspector, and search misses their text. Anchors keep full OCR. The frames stay on the Mac for 90 days, so a later move to B can OCR the backlog.

### Model money (8 active hours a day, 26 days a month)

C and D ask the same questions as B, so they cost the same. Money is computed from unrounded question counts.

| Policy | Questions/h A | A per day | A per month | Questions/h B | B per hour | B per day | B per month |
|---|---:|---:|---:|---:|---:|---:|---:|
| P0 current | 80 | $0.083 | $2.16 | 80 | $0.0104 | $0.083 | $2.16 |
| P0b timer after last capture | 80 | $0.083 | $2.16 | 80 | $0.0104 | $0.083 | $2.16 |
| P1 typing pause | 89 | $0.087 | $2.27 | 85 | $0.0107 | $0.086 | $2.23 |
| P2 click settle | 164 | $0.120 | $3.12 | 105 | $0.0118 | $0.094 | $2.45 |
| P3 scroll stop | 195 | $0.134 | $3.48 | 106 | $0.0118 | $0.095 | $2.46 |
| P4 every view change | 178 | $0.126 | $3.27 | 125 | $0.0129 | $0.103 | $2.67 |
| P5 adaptive interval | 160 | $0.118 | $3.08 | 107 | $0.0119 | $0.095 | $2.47 |
| P6 all triggers | 246 | $0.156 | $4.06 | 120 | $0.0126 | $0.101 | $2.62 |
| P7 all triggers, capped | 149 | $0.113 | $2.95 | 98 | $0.0114 | $0.091 | $2.37 |
| P8 settled changes | 128 | $0.104 | $2.71 | 93 | $0.0111 | $0.089 | $2.31 |
| P9 settle 5 s | 176 | $0.125 | $3.26 | 99 | $0.0114 | $0.091 | $2.38 |
| P10 settle 10 s | 110 | $0.096 | $2.50 | 80 | $0.0104 | $0.083 | $2.17 |
| P11 view + settle, with switch | 150 | $0.114 | $2.96 | 92 | $0.0111 | $0.089 | $2.31 |
| P12 view + settle | 118 | $0.100 | $2.60 | 66 | $0.0096 | $0.077 | $2.00 |
| P13 dwell capture | 128 | $0.104 | $2.71 | 73 | $0.0100 | $0.080 | $2.09 |
| P14 dwell capture + place | 134 | $0.107 | $2.78 | 73 | $0.0100 | $0.080 | $2.08 |

The spread is small: the most frame-hungry policy, asking a question of every frame, costs $1.90 a month more than today.

### CPU and storage

CPU is the app plus the OCR helper, the two processes the 1% budget covers. `replayd` adds another 0.016% of a core today and 0.027% under P13.

| Policy | Kept/h | CPU % A | CPU % B | CPU % C | CPU % D | MB a day | GB a month | Local GB at 90 days | R2 per month after 12 months |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| P0 current | 80 | 0.90 | 0.90 | 0.90 | 0.90 | 85 | 2.2 | 6.6 | $0.25 |
| P0b timer after last capture | 80 | 0.91 | 0.91 | 0.91 | 0.91 | 86 | 2.2 | 6.7 | $0.25 |
| P1 typing pause | 89 | 1.00 | 0.99 | 0.98 | 0.96 | 96 | 2.5 | 7.5 | $0.30 |
| P2 click settle | 164 | 1.77 | 1.65 | 1.56 | 1.18 | 176 | 4.6 | 13.7 | $0.67 |
| P3 scroll stop | 195 | 2.08 | 1.91 | 1.77 | 1.20 | 209 | 5.4 | 16.3 | $0.83 |
| P4 every view change | 178 | 1.90 | 1.80 | 1.77 | 1.38 | 190 | 4.9 | 14.8 | $0.74 |
| P5 adaptive interval | 160 | 1.72 | 1.62 | 1.55 | 1.19 | 172 | 4.5 | 13.4 | $0.65 |
| P6 all triggers | 246 | 2.60 | 2.36 | 2.14 | 1.35 | 264 | 6.9 | 20.6 | $1.09 |
| P7 all triggers, capped | 149 | 1.61 | 1.51 | 1.44 | 1.10 | 159 | 4.1 | 12.4 | $0.60 |
| P8 settled changes | 128 | 1.39 | 1.33 | 1.29 | 1.05 | 137 | 3.6 | 10.7 | $0.49 |
| P9 settle 5 s | 176 | 1.89 | 1.74 | 1.59 | 1.12 | 189 | 4.9 | 14.7 | $0.73 |
| P10 settle 10 s | 110 | 1.21 | 1.15 | 1.09 | 0.92 | 117 | 3.1 | 9.2 | $0.40 |
| P11 view + settle, with switch | 150 | 1.62 | 1.51 | 1.42 | 1.05 | 161 | 4.2 | 12.6 | $0.60 |
| P12 view + settle | 118 | 1.30 | 1.20 | 1.12 | 0.78 | 127 | 3.3 | 9.9 | $0.44 |
| P13 dwell capture | 128 | 1.39 | 1.29 | 1.20 | 0.85 | 137 | 3.6 | 10.7 | $0.49 |
| P14 dwell capture + place | 134 | 1.45 | 1.34 | 1.24 | 0.85 | 143 | 3.7 | 11.2 | $0.52 |

For P13 under B, the 1.29% is 1.02% of OCR and 0.27% of app. Design A charges the attributed 0.044 s of app work per question on every frame, so its column is an upper bound.

**OCR cost per frame that would fit the budget**, against 0.288 s in the measured hour:

| Policy | A | B | C | D |
|---|---:|---:|---:|---:|
| P0 current | 0.33 s | 0.33 s | 0.33 s | 0.33 s |
| P10 settle 10 s | 0.22 s | 0.24 s | 0.26 s | 0.32 s |
| P12 view + settle | 0.20 s | 0.23 s | 0.25 s | 0.41 s |
| P13 dwell capture | 0.18 s | 0.21 s | 0.23 s | 0.36 s |
| P14 dwell capture + place | 0.17 s | 0.20 s | 0.22 s | 0.36 s |

**Changed-region OCR, measured.** [`crop_ocr_bench.swift`](../experiments/tools/smart-capture/crop_ocr_bench.swift) took pairs of consecutive kept frames from today's store, 30 to 60 s apart. For each pair:

1. It found the 16 px tiles that changed, comparing the frames at 1280 px.
2. It ran the OCR helper's Vision request on the whole frame.
3. It ran the same request on crops around the changed tiles.
4. It counted how many of the whole frame's words the crops recover, together with the previous frame's words outside the crops.

| Pair | Pairs | Changed area (median) | Full OCR CPU (median) | Crop OCR CPU against full | Words recovered (median, 10th percentile) | Previous frame's words alone |
|---|---:|---:|---:|---:|---:|---:|
| Same view | 87 | 43% | 354 ms | 67% | 92%, 74% | 62% |
| Same site, new title or path | 21 | 88% | 254 ms | 97% | 93%, 81% | 37% |

Cropping saves a third of OCR within one view and almost nothing after a page change. This agrees with IMPLEMENTATION.md, which found that reading only the changed band of rows would save 5% under today's schedule, where two thirds of kept frames follow a switch. Under P13, cropping saves 0.09 points (C against B). These pairs were 30 to 60 s apart. Frames taken seconds after typing or a click should change less of the screen, so 67% is an upper estimate for them.

**Detecting the triggers costs no measurable CPU.** One read of seven event counters (key down, three mouse buttons, scroll, mouse move, drag) plus the idle time costs 0.1 µs of CPU ([`counter_bench.swift`](../experiments/tools/smart-capture/counter_bench.swift)). Polling once a second adds one wakeup a second, within plan/03's limit of 2 wakeups a second even when idle. The logger itself used 8.0 s of CPU over its first 1 hour 53 minutes, 0.12% of a core. That included its own Accessibility read on every title notification and a line written every second.

## 6. Recommendation: dwell capture (P13)

This is what was recommended; section 7 describes what was built from it and how it measured.

**Triggers:**

1. **Fallback timer.** Capture when 60 s have passed since the last capture of any kind, a duplicate included. This replaces the repeating timer and its 30 s skip, and caps every gap at 60 s. On its own it does not improve coverage (section 4), so ship it together with the event triggers.
2. **View held.** When the context key changes (app, title without counters, site, path), capture once the new key has held 10 s, unless a capture already happened after the change. The 2 s title throttle in `ContextMonitor` delays detection by at most 2 s.
3. **Settle.** After a view change, a click, the end of a scroll or the end of typing, capture once 10 s pass with no key press (a shortcut included), click, scroll or view change, unless a capture already happened after that change. Mouse moves and drags do not restart the 10 s.
4. **Typing pause.** After a typing burst, capture 3 s after the last key.
5. **Remove the 5 s switch capture.** A new app or site gets a frame through rules 2 and 3, which covered 93% of places held 10 s or more. Optional: add a capture once a new app or site has held 10 s, which lifts that to 96% for 6 more kept frames an hour (P14). Every figure in this section is for P13 without it.
6. **Spacing and cap.** An event capture comes at least 10 s after the previous capture. A trigger inside the spacing waits, and triggers that arrive while one waits merge into one capture. A token bucket of 4, refilled at 3 a minute, caps event captures.
7. **Captures and displays.** "A capture already happened" means any capture, duplicate or not. Timer captures take every display; wake, unlock and event captures take the focused display only. Every capture resets the spacing and the fallback timer; only event captures use the bucket.
8. **Polling.** Read the input counters once a second while the screen is unlocked and awake, idle included, so the first input after a break is seen within a second.
9. **Unchanged:** the idle, lock, secure-input, exclusion and private-window gate, and dedupe against the last kept frame.

**Questions.** Ask the boundary question on anchors only, as defined in section 1. Expect about 73 an hour against 80 today: 41 view frames, 16 timer frames, 8 typing frames and 8 settle frames. To tell anchors from evidence frames, record the trigger on the capture row, for example with new `CaptureTrigger` cases for view, settle and typing. Until the understanding work decides otherwise, the boundary question should compare consecutive anchors, and count its window, its lookahead and the join question's window in anchors. Evidence frames then stay out of those windows, which keep covering the same stretch of time as today. Whether an evidence frame's OCR text should join the next anchor's line is left to that work.

**OCR.** P13 keeps about 55 evidence frames an hour: 25 view frames (new pages within a site), 26 settle frames and 4 typing frames.

- **Design B** OCRs all of them, so they are searchable. It runs at 1.29% of a core, and fits the budget once OCR costs 0.21 s a frame.
- **Design D** stores them as pictures. It runs at 0.85% and OCRs 73 frames an hour, against 80 today. All 55 evidence frames then stay out of search until a move to B OCRs them.

The build sits between the two: it reads an evidence frame only when it shows new content, at most 12 an hour (section 7).

**Expected cost per active hour:**

| | Today (P0) | Dwell capture, design B | Dwell capture, design D |
|---|---:|---:|---:|
| Captures | 83 | 137 | 137 |
| Kept frames | 80 | 128 | 128 |
| Boundary questions | 80 | 73 | 73 |
| OCR'd frames | 80 | 128 | 73 |
| Model money | $0.0104 an hour, $0.083 a day, $2.16 a month | $0.0100, $0.080, $2.09 | the same as B |
| CPU, app and OCR helper | 0.90% | 1.29% | 0.85% |
| Storage | 85 MB a day, 2.2 GB a month | 137 MB a day, 3.6 GB a month | the same as B |
| Local frames at 90 days | 6.6 GB | 10.7 GB | the same as B |
| Cloudflare R2 after 12 months | $0.25 a month | $0.49 a month | the same as B |

**How it bears on the boundary work.** The engine now asks a join question after every boundary it draws, and two held-out stretches fall inside this logger's window. On the first (16:07–17:47), the join raised boundary F1 from 0.727 to 0.788. On the second (17:59–18:59), the shipped setting scored 0.333 against 0.714 for the old one. There, short check-ins on coding sessions, mail and chat, which both labelers split off, got p(new) of 0.6–0.8 from the decider, below the 0.85 cut, and merged into the surrounding activity.

Dropping the 5 s switch capture could hide such check-ins from the boundary question. The logger covered that hour, so here is every app or site visit in it, by length:

| Visit length | Visits | With a capture today (real) | With a frame under P13 | With a boundary question under P13 |
|---|---:|---:|---:|---:|
| Under 5 s | 61 | 3 | 4 | 3 |
| 5 to 10 s | 26 | 7 | 3 | 3 |
| 10 to 30 s | 30 | 16 | 27 | 22 |
| 30 s or more | 28 | 28 | 28 | 28 |

Today every capture gets a question, so 23 of the 56 visits of 5 to 30 s were asked about. P13 asks about 25 of them: it loses 4 visits of 5 to 10 s and gains 6 of 10 to 30 s. The check-ins stay visible, and that stretch's errors came from the decider's answers on frames it did see, which capture policy does not change. P13 also removes the switch captures where the labelled live day had 34 of its 39 false boundaries. Nothing here measures the net effect on F1; a labelled stretch captured under P13 would.

**How to check it after shipping.**

1. A live hour of the menu-bar app: kept frames, boundary questions and CPU against the table above.
2. An hour of this logger with `analyze.py` against the app's own captures: views of 10 s or more captured at 95% or better.
3. A labelled stretch scored for boundary F1 against today's capture.

## 7. Built and measured

Dwell capture was built on 2026-10-15 from section 6 and measured for an hour of real use.

**What was built.**

- `DwellScheduler` (`Sources/ScreencapCore/Evidence/DwellScheduler.swift`) holds the rules of section 6. `CaptureEngine` reads the input counters once a second and asks it which capture is due, and `ContextMonitor` reports every view change to it.
- Each capture row records whether it is an anchor (`isAnchor`, migration `v5-anchors`) and its trigger: `view`, `settle` and `typing` join `timer`, `switch` (now wake and unlock only) and `manual`.
- The boundary question runs on anchors only. Its window of 12 captures, its lookahead of 2 and the join question's view of the activity before a boundary all count anchors. An evidence frame gets a ruled answer, boundary source `evidence`, which continues the activity of the capture before it; after a lock, sleep or idle marker it gets a hard break instead.
- Text is read on every anchor. An evidence frame is read when it shows another view than the last frame read on its display, or when at least a quarter of its 64 × 40 fingerprint thumbnail changed since that frame, and then at most 12 an hour (2 in a row). The others get the OCR state `skipped` and stay pictures: shown in the timeline, with their title and site searchable and their screen text not.

Three things differ from the P13 simulated in sections 4 to 6:

- A trigger is dropped when a capture already came after the change it answers, as rules 2 and 3 say. The simulation of section 4 kept such triggers, so it counted some settle captures twice.
- Any key press, a shortcut included, restarts the settle clock. The simulation restarted it only after typing of two or more keys.
- The decider's boundary threshold is now 0.45 (IMPLEMENTATION.md), a change made in the understanding work alongside this one.

**The build, simulated on the three logged hours.** The `P13 as built` policy in `analyze.py` follows `DwellScheduler`. The CPU line uses the build's OCR rule. The share of the screen that changed needs pixels, so it is left out, which makes CPU a lower bound by at most the 12 reads an hour (0.1 points).

| Per active hour | Today (P0) | P13 as specified | P13 as built |
|---|---:|---:|---:|
| Captures | 83 | 137 | 111 |
| Kept frames | 80 | 128 | 104 |
| Boundary questions | 80 | 73 | 69 |
| Views 10 s+ captured | 73% | 97% | 97% |
| Views 30 s+ captured | 96% | 100% | 100% |
| Places 10 s+ captured | 79% | 93% | 93% |
| Quiet screens 10 s+ captured | 52% | 92% | 89% |
| CPU, app and OCR helper | 0.90% | 0.93% | 0.88% |
| Model money per month | $2.16 | $2.09 | $2.04 |
| Storage per day | 85 MB | 137 MB | 111 MB |

**The measured hour.** `Screencap headless --minutes 60` ran from 19:48 to 20:48 on 2026-10-15, built from the working tree, into its own store, with understanding on. The logger ran alongside. Yahor was active for 56 of the 60 minutes, mostly in the browser (67% of active time) and AI assistants (25%). The comparison is the final build's measured hour under today's schedule (18:17–19:17, fully active).

| | Today's schedule, 18:17–19:17 | Dwell capture, 19:48–20:48 |
|---|---:|---:|
| Captures | 93 (60 switch) | 95 (62 view, 17 timer, 13 settle, 3 typing) |
| Kept frames | 91 | 94 |
| Anchors, which get the boundary question | every kept frame | 59 (55 questions asked) |
| Frames read for text | 90 | 69 (58 anchors, 11 evidence frames) |
| Frames kept as pictures | none | 25 |
| CPU, app | 0.29% | 0.28% |
| CPU, OCR helper | 0.72% | 0.55% |
| CPU in all (budget 1%) | 1.00% | 0.83% |
| Memory footprint | 31.3 MB | 31.3 MB |
| Disk per kept frame (frame and thumbnail) | 166 KB | 174 KB |
| Model cost | $0.0074 | $0.0059 |

Section 5's cost model, run on this hour's timeline for the build, predicted 0.84% of a core; the measurement was 0.83%.

**Coverage in the measured hour**, from the logger's timeline against the hour's own captures (they agreed on app and site for 99% of the captures):

| | Dwell capture, measured | Today's schedule, simulated on the same hour |
|---|---:|---:|
| Views 10 s+ captured | 91% (63 of 69) | 67% |
| Views 30 s+ captured | 100% (31 of 31) | 94% |
| Places 10 s+ captured | 94% | 83% |
| Quiet screens 10 s+ captured | 82% | 52% |
| Longest gap between captures | 61 s | |

All six views of 10 s or more that got no frame lasted 10 to 12 s. The view trigger counts its 10 s from the moment `ContextMonitor` notices the change, which reads titles at most every 2 s, so a view that ends 10 to 12 s after it began can close before its capture. The simulation, which saw every change at once, put the same hour at 97%. A shorter view hold would catch these at the cost of more frames (section 4's sweep).

## 8. Limits

- **One person, one afternoon.** The window holds 2.32 active hours, mostly browsing, with 284 key presses an hour. An hour of coding or writing would show more typing pauses and fewer view changes. Several figures rest on few cases: 15 typing bursts whose text stayed on screen, 5 missed views of 30 s or more, 11 long gaps, and the false boundaries of one labelled day.
- **Screen changes are inferred from input and focus.** A click that changes nothing still counts as a moment. Video and animation change the screen with no input, and they are not counted. A view counts as captured when any frame fell inside it.
- **Dedupe is calibrated on 198 real captures**, of which 45 had no view change since the previous capture.
- **Activities are held at 14.7 an hour.** The model does not change how often the boundary question splits activities.
- **CPU is modelled.** It is calibrated on one headless hour of the final build, attributes the app's remaining work to questions as an upper bound, and leaves out the menu-bar app's UI. The changed-region OCR bench used frames 30 to 60 s apart.
- **The logger ran beside the app.** It added its own Accessibility observer to the frontmost app. The app's captures show no gaps over the window.
- **One measured hour per schedule, at different times.** The two measured hours are an hour and a half apart with different use, so their capture counts and CPU are compared directly, and coverage is compared on one hour's timeline through the simulation of today's schedule.

## 9. Reproduce

All scripts are in [`experiments/tools/smart-capture/`](../experiments/tools/smart-capture/). Build each Swift tool with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swiftc -O <file>.swift -o <name>`.

```bash
./logger --probe
./logger --out timeline.jsonl --salt salt.txt --hours 3
sqlite3 ~/Library/Application\ Support/com.screencaping.app/screencap.sqlite "VACUUM INTO 'store-copy.sqlite'"
python3 -I analyze.py --timeline timeline.jsonl --salt salt.txt --store store-copy.sqlite --out results.json --stretch START END  # a labelled stretch, in epoch seconds
python3 -I crop_pairs.py --store store-copy.sqlite --frames ~/Library/Application\ Support/com.screencaping.app --kind view --limit 100 > pairs-view.tsv
python3 -I crop_pairs.py --store store-copy.sqlite --frames ~/Library/Application\ Support/com.screencaping.app --kind place --limit 60 > pairs-place.tsv
./crop_ocr_bench < pairs-view.tsv > crop-view.jsonl
./crop_ocr_bench < pairs-place.tsv > crop-place.jsonl
python3 -I report_tables.py results.json crop-view.jsonl crop-place.jsonl
swift build -c release --scratch-path .build/dwell --product Screencap && swift build -c release --scratch-path .build/dwell --product screencap-ocr
.build/dwell/release/Screencap headless --minutes 60 --store <scratch dir>
```

The headless run reads the OpenRouter key from `OPENROUTER_API_KEY` (run it through `zsh -ilc` so `~/.zshrc` is read); with the key in the environment it never touches the Keychain. Running the logger at the same time and passing the headless store to `analyze.py` gives the measured hour's coverage.

`--probe` prints whether Accessibility is trusted, plus one sample. `analyze.py` cuts the timeline at the store copy's newest capture, so both cover the same window; `--stretch` takes the second held-out stretch's start and end in epoch seconds. The timeline, salt and results stay outside the repository, because the timeline records which apps were used and when.

## Appendix: sweeps

Each variant has the timer after last capture. "No switch" variants drop the 5 s switch capture. "Switch 10 s" and "switch 20 s" keep the switch capture with a longer hold.

| Variant | Kept/h | Places 10 s+ | Views 10 s+ | Views 30 s+ | Quiet 10 s+ | CPU % B | CPU % C |
|---|---:|---:|---:|---:|---:|---:|---:|
| Settle 3 s, spacing 10 s | 231 | 98% | 98% | 100% | 100% | 2.23 | 2.02 |
| Settle 3 s, spacing 20 s | 159 | 91% | 90% | 100% | 86% | 1.61 | 1.55 |
| Settle 5 s, spacing 10 s | 176 | 92% | 92% | 100% | 100% | 1.74 | 1.59 |
| Settle 5 s, spacing 20 s | 144 | 91% | 89% | 100% | 85% | 1.47 | 1.40 |
| Settle 8 s, spacing 10 s | 123 | 87% | 83% | 100% | 100% | 1.27 | 1.18 |
| Settle 8 s, spacing 20 s | 120 | 85% | 82% | 100% | 84% | 1.25 | 1.20 |
| Settle 10 s, spacing 10 s | 110 | 87% | 81% | 100% | 94% | 1.15 | 1.09 |
| Settle 10 s, spacing 20 s | 106 | 85% | 79% | 100% | 87% | 1.13 | 1.09 |
| Settle 15 s, spacing 10 s | 96 | 80% | 74% | 97% | 66% | 1.03 | 0.99 |
| Settle 15 s, spacing 20 s | 95 | 80% | 74% | 97% | 64% | 1.03 | 0.99 |
| View 5 s + settle 8 s | 196 | 99% | 100% | 100% | 99% | 1.93 | 1.79 |
| No switch, view 5 s + settle 8 s | 174 | 99% | 100% | 100% | 100% | 1.69 | 1.55 |
| View 5 s + settle 10 s | 183 | 99% | 100% | 100% | 94% | 1.83 | 1.73 |
| No switch, view 5 s + settle 10 s | 159 | 99% | 100% | 100% | 94% | 1.58 | 1.48 |
| View 10 s + settle 8 s | 165 | 96% | 98% | 100% | 100% | 1.64 | 1.51 |
| No switch, view 10 s + settle 8 s | 139 | 92% | 97% | 100% | 100% | 1.37 | 1.25 |
| View 10 s + settle 10 s | 150 | 94% | 97% | 100% | 95% | 1.51 | 1.42 |
| No switch, view 10 s + settle 10 s | 118 | 91% | 96% | 100% | 94% | 1.20 | 1.12 |
| View 15 s + settle 8 s | 154 | 88% | 87% | 100% | 99% | 1.54 | 1.41 |
| No switch, view 15 s + settle 8 s | 129 | 83% | 84% | 100% | 100% | 1.28 | 1.16 |
| View 15 s + settle 10 s | 139 | 87% | 85% | 100% | 95% | 1.41 | 1.31 |
| No switch, view 15 s + settle 10 s | 112 | 79% | 80% | 100% | 94% | 1.14 | 1.05 |
| Switch 10 s + settle 10 s | 103 | 84% | 80% | 100% | 93% | 1.09 | 1.04 |
| Switch 20 s + settle 10 s | 100 | 75% | 73% | 100% | 92% | 1.07 | 1.02 |
