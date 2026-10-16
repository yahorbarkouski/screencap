# Detecting private browser windows on macOS

Screencap's title check (`CaptureGate.privateWindowMarkers`) protects only part of what it claims. Chromium writes "(Incognito)" into the window's accessibility title (AXTitle) but leaves it out of the real window title (`kCGWindowName`, which is what `SCWindow.title` returns). Brave writes "(Private)", which no current marker matches. Arc and Dia put no marker in any title. Safari adds ", Private Browsing" to AXTitle, and only Firefox puts its marker in the real window title. Every marker is translated into the browser's UI language. `ScreenCapturer` filters windows by `SCWindow.title`, so a visible but unfocused private window in any browser except Firefox ends up in the display frame.

Each browser has a signal that does work. For Chromium browsers it is the AXTitle suffix (no extra permission) or Apple Events `mode of window` (works in any language). Arc and Dia mark the window's `AXIdentifier`. Safari has its AXTitle suffix and a description on its address field. Firefox has its title suffix plus one preference file.

The tags in the tables say how each claim was checked. **V** means verified in public source code during this research, at the file and function named. **R** means reported by other developers, often with a transcript from a real Mac. **U** means unknown: no public source was found. Nothing here was run on this Mac.

## Per-browser findings

| Browser (bundle ID) | Title signal in a private window | Best signal without Automation | Apple Events signal | Confidence | Sources |
|---|---|---|---|---|---|
| Chrome (`com.google.Chrome`) | **AXTitle: yes**, `<tab title> - Google Chrome (Incognito)`. A normal window's AXTitle is `<tab title> - Google Chrome`, with ` - <profile name>` added when there are several profiles (V). Runtime: `Privacy - Wikipedia - Google Chrome (Incognito)` on macOS 26 (R). **kCGWindowName: no**: page title only, plus 🔊 or 🔇 when a tab plays audio (V). | AXTitle suffix, translated: de ` (anonym)`, fr ` (Navigation privée)`, es ` (incógnito)`, ja `（シークレット モード）`, zh-CN `（无痕）`, ko ` (시크릿 모드)`, ru ` (инкогнито)`, pt-BR ` (Modo anônimo)` (V, from xtb files). Guest windows get ` (Guest)`. While a tab-modal dialog has focus, AXTitle is the dialog's title and has no suffix (V). | `mode of window` returns `"incognito"` for any off-the-record profile, which covers incognito and guest windows. A window's mode is fixed when it is created (V). | High | [1][2][3][4][5][6][7] |
| Brave (`com.brave.Browser`) | **AXTitle: yes**, `<tab title> - Brave (Private)` (V). **kCGWindowName: no** (V: same Chromium code as Chrome). | AXTitle suffix: de ` (Privat)`, fr ` (Navigation privée)`, ja ` (プライベート)` (V). Not checked: whether "Private Window with Tor" windows get the suffix, since they use a separate off-the-record profile (U). | `mode` (V: Chromium code; ActivityWatch and SimplyTrack read it from Brave). | High, Tor windows Medium | [8][9][10] |
| Edge (`com.microsoft.edgemac`) | AXTitle and kCGWindowName for an InPrivate window: U. Edge's strings are closed source, and no report was found. | AXTitle suffix once a recorded test shows it. | `mode`, read by SimplyTrack and screenpipe (R). | Medium | [10][11] |
| Vivaldi (`com.vivaldi.Vivaldi`) | U | U | `mode` (R: SimplyTrack). A Raycast extension confirms the Chrome dictionary exposes windows and tabs. | Low without Automation | [10][12] |
| Opera (`com.operasoftware.Opera`) | U | U | Chrome dictionary windows and tabs work (R: Raycast). `mode` is assumed by screenpipe (R). | Low without Automation | [11][12] |
| Arc (`company.thebrowser.Browser`) | No title marker reported. | **AXIdentifier** of the window contains `Incognito`, for example `bigIncognitoBrowserWindow-…` (R: screenpipe). Works in any UI language. | `incognito of window` is a boolean (R: SimplyTrack reads it, and Raycast sets it in `make new window`). screenpipe says Arc 1.138 broke this. | Medium | [11][10][13] |
| Dia (`company.thebrowser.dia`) | **No**. AXTitle is `Work: <page title>…` with a profile prefix. | **AXIdentifier** `bigIncognitoBrowserWindow_<UUID>` for private windows and `bigBrowserWindow_<UUID>` for normal ones, shown in a transcript with 2 profiles × 2 modes (R). | None. `Dia.sdef` has neither `mode` nor `incognito`, and asking for `incognito` fails with -2753 (R). | Medium | [10][14] |
| Safari (`com.apple.Safari`) | **AXTitle: yes**, `<page title>, Private Browsing` (R: Safari 18.6 on macOS 15.6, English) and `…, privat surfning` (R: Safari 26 on macOS 27, Swedish). kCGWindowName: U, probably the page title alone. | AXTitle suffix. The address field (`AXIdentifier` `WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD` in every language) has an `AXDescription` that adds "in a private window" in private windows (R, seen in Swedish). The Window menu shows "Move Tab to New Private Window" in a private window (R, 2021; can be stale unless Safari is frontmost). | None. Safari's dictionary has no private flag (R). | Medium | [15][16][17][18] |
| Firefox (`org.mozilla.firefox`) | **Yes in both AXTitle and kCGWindowName**: `<page title> — Private Browsing`, and `Mozilla Firefox — Private Browsing` for a page without a title. A normal window shows the bare page title. The suffix comes after ` — <profile>` when the browser has several profiles (V). With `browser.privatebrowsing.autostart` ("Never remember history"), every window is private and no window gets a suffix (V). | Title suffix after ` — `: de `Privater Modus`, fr `Navigation privée`, it `Navigazione anonima`, ja `プライベートブラウジング`, pl `Tryb prywatny`, sv `Privat surfning`, nl `Privénavigatie` (V). For autostart, read `prefs.js` in the Firefox profile. | None: Firefox has no window scripting. | High | [19][20][21] |

Sources:
[1] Chromium [`browser_view.cc`](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/views/frame/browser_view.cc) `GetAccessibleWindowTitle`, `GetAccessibleWindowTitleForChannelAndProfile`, `GetWindowTitle`.
[2] [`native_widget_mac_nswindow.mm`](https://github.com/chromium/chromium/blob/main/components/remote_cocoa/app_shim/native_widget_mac_nswindow.mm) `accessibilityTitle` (it returns the root view's accessible name) and [`root_view.cc`](https://github.com/chromium/chromium/blob/main/ui/views/widget/root_view.cc) `UpdateAccessibleName`.
[3] [`window_metadata_controller.cc`](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/window_metadata/window_metadata_controller.cc) `GetWindowTitleFromWebContents` (on Mac it returns the page title without the app name), and [`widget.cc`](https://github.com/chromium/chromium/blob/main/ui/views/widget/widget.cc) `UpdateWindowTitle`.
[4] [`generated_resources.grd`](https://github.com/chromium/chromium/blob/main/chrome/app/generated_resources.grd) `IDS_ACCESSIBLE_INCOGNITO_WINDOW_TITLE_FORMAT`, [`google_chrome_strings.grd`](https://github.com/chromium/chromium/blob/main/chrome/app/google_chrome_strings.grd), and the translations in [`chrome/app/resources/generated_resources_<locale>.xtb`](https://github.com/chromium/chromium/tree/main/chrome/app/resources), message ID `6751344591405861699`.
[5] [`window_applescript.mm`](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/cocoa/applescript/window_applescript.mm) `mode`, [`scripting.sdef`](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/cocoa/applescript/scripting.sdef), and [`browsercrapplication+applescript.mm`](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/cocoa/applescript/browsercrapplication+applescript.mm) (windows come in front-to-back order).
[6] [screenpipe #5531](https://github.com/screenpipe/screenpipe/issues/5531), a runtime log from macOS 26.
[7] [`profiles_strings.grdp`](https://github.com/chromium/chromium/blob/main/chrome/app/profiles_strings.grdp) `IDS_AVATAR_BUTTON_INCOGNITO`: the toolbar's avatar button reads "Incognito" or "Incognito (N)".
[8] brave-core [`generated_resources_override.grd`](https://github.com/brave/brave-core/blob/master/app/generated_resources_override.grd), [`brave_strings.grd`](https://github.com/brave/brave-core/blob/master/app/brave_strings.grd), and `app/resources/*.xtb`, message ID `6827869674836193263`.
[9] [ActivityWatch `macos.swift`](https://github.com/ActivityWatch/aw-watcher-window/blob/master/aw_watcher_window/macos.swift).
[10] SimplyTrack [`Services/Browsers/*.swift`](https://github.com/renjfk/SimplyTrack/tree/main/SimplyTrack/Services/Browsers) and [PR #74](https://github.com/renjfk/SimplyTrack/pull/74).
[11] screenpipe [`incognito/mod.rs`](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-a11y/src/incognito/mod.rs), [`incognito/macos.rs`](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-a11y/src/incognito/macos.rs), and [`tree/macos.rs`](https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-a11y/src/tree/macos.rs).
[12] Raycast [`extensions/opera`, `extensions/vivaldi`](https://github.com/raycast/extensions/tree/main/extensions).
[13] Raycast [`arc/src/arc.ts`](https://github.com/raycast/extensions/blob/main/extensions/arc/src/arc.ts).
[14] Raycast [`dia/src/dia.ts`](https://github.com/raycast/extensions/blob/main/extensions/dia/src/dia.ts) (it opens incognito windows with a keystroke) and the [Dia changelog](https://www.diabrowser.com/changelog).
[15] [Keyboard Maestro forum, Aug 2025](https://forum.keyboardmaestro.com/t/smart-safari-private-window-tab-opener-opens-new-tab-if-already-private/41634) (Safari 18.6, System Events `title of window 1`).
[16] [lax PR #41](https://github.com/fnyman-ctrl/lax/pull/41), an AX probe of Safari 26 with a Swedish UI.
[17] [Alex Chan, 2021](https://alexwlchan.net/2021/detect-private-browsing/).
[18] [Apple Safari guide](https://support.apple.com/guide/safari/browse-privately-ibrw1069/mac) (the only documented cue is the dark Smart Search field).
[19] Firefox [`Tabbrowser.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/tabbrowser/Tabbrowser.sys.mjs) `getWindowTitleForBrowser` (it adds the suffix only when `privatebrowsingmode == "temporary"`), [`browser.ftl`](https://github.com/mozilla-firefox/firefox/blob/main/browser/locales/en-US/browser/browser.ftl), and [`browser_privatebrowsing_windowtitle.js`](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/privatebrowsing/test/browser/browser_privatebrowsing_windowtitle.js).
[20] [`nsCocoaWindow.mm`](https://github.com/mozilla-firefox/firefox/blob/main/widget/cocoa/nsCocoaWindow.mm) `SetTitle`, which passes the title to `NSWindow setTitle:`.
[21] [mozilla-l10n/firefox-l10n](https://github.com/mozilla-l10n/firefox-l10n), key `browser-main-private-suffix-for-content`.

## Why Screencap's check fails today

- `CaptureGate.evaluate` reads the focused window's AXTitle (`ContextMonitor.readContext`). It catches English Chrome, Safari and Firefox, and Edge if Edge uses "InPrivate". It misses Brave's `(Private)`, Arc, Dia, and every translated marker.
- `ScreenCapturer.capture` excludes windows whose `SCWindow.title` matches. That title is the real window title, which carries a marker only in Firefox. So an unfocused private window from any other browser, visible on any display, is captured. screenpipe had the same bug and fixed it by checking every window before capture ([#6198](https://github.com/screenpipe/screenpipe/issues/6198), [#6260](https://github.com/screenpipe/screenpipe/pull/6260)).
- Hand-written translation lists go wrong. screenpipe's `titles.rs` lists `inkognito` for German Chrome, but Chrome's German text is `(anonym)`. The list also misses Firefox's Polish `Tryb prywatny` and Russian `Приватный просмотр`.

## Recommended design

1. **Check every window, every tick.** Before each capture, classify each on-screen window (layer 0) of each running browser, and record the verdict against its `CGWindowID`. Read the AX windows (`kAXWindowsAttribute`) and pair each with its `SCWindow` by process ID and frame: AX position and size equal `SCWindow.frame`, and both use global coordinates with a top-left origin. Pass every private window to `SCContentFilter(display:excludingWindows:)`. Keep blocking the whole capture when the focused window is private.
2. **A private verdict lasts for the window's lifetime.** Chrome cannot change a window's mode after creation (V, [5]). Caching the verdict covers two cases where the marker disappears: a Chrome tab-modal dialog replacing AXTitle, and a page title changing while it loads.
3. **Use these rules, keyed by bundle ID.** The detector's bundle list must include `org.mozilla.firefox` and Firefox Developer Edition and Nightly, which `ContextMonitor.browsers` lacks today:

| Browser family | Private when |
|---|---|
| Chrome, Brave, Edge, Vivaldi, Opera, Chromium | AXTitle ends with that browser's translated suffix, or, with Automation granted, `mode` is `"incognito"` |
| Arc, Dia | The window's `AXIdentifier` contains `incognito` (case-insensitive). For Arc, also `incognito of window` when Automation is granted |
| Safari | AXTitle ends with `, ` plus the translated "Private Browsing", or the description of the field `WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD` contains the translated "private window" phrase |
| Firefox and Gecko forks | The title (either one) ends with ` — ` plus the translated suffix, or `prefs.js` in the profile sets `browser.privatebrowsing.autostart` to true. In the second case every window counts as private |

4. **Generate the translations at build time.** A script pulls Chromium's and Brave's `.xtb` files (IDs [4][8]) and Firefox's `.ftl` files [21] and writes the Swift tables. Match the suffix only at the end of the title, so a normal Chrome window showing a page titled "Incognito mode explained" is still captured.
5. **Check the language first.** Find the browser's UI language with `Bundle.preferredLocalizations(from:forPreferences:)`, using the app bundle's `.lproj` folders and the app's `AppleLanguages` default (or the system languages). If Screencap has no tested marker for that browser and language, use Apple Events if granted. Otherwise treat the browser as unverified: exclude the whole app from capture, and say so in Settings. Edge, Vivaldi and Opera stay unverified until a recorded test supplies their markers.
6. **Apple Events are opt-in, per Chromium browser** ("Strict detection" in Settings). This needs:
   - `NSAppleEventsUsageDescription` in Info.plist.
   - The `com.apple.security.automation.apple-events` entitlement under the hardened runtime ([Apple](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.automation.apple-events)).
   - User consent for each browser. macOS asks once per browser whether Screencap may control it, and the user manages this under Privacy & Security › Automation.

   Check consent without a prompt by calling `AEDeterminePermissionToAutomateTarget` with `askUserIfNeeded` false. It returns -1744 (`errAEEventWouldRequireUserConsent`) before the user has answered and -1743 (`errAEEventNotPermitted`) after a denial ([mjtsai](https://mjtsai.com/blog/?p=22597), [Apple forums](https://developer.apple.com/forums/thread/130949)). Address the browser by process ID: ActivityWatch found that targeting the bundle ID can relaunch a browser that is quitting. When a new window appears, ask once for `{mode, bounds, name} of every window`. Chrome's `name` is the real window title, the same string as `SCWindow.title` (V, [5]). Pair each answer with an `SCWindow` by bounds and name. If the pairing is ambiguous, treat the window as private.
7. **Fail closed.** If an AX call fails or times out, or a browser window has just appeared and has no verdict yet, exclude that window for this tick. Treat Chrome guest windows as private.

## Tests that confirm it at runtime

1. **Probe command.** Add a debug command that lists every window of every running browser with its bundle ID, `CGWindowID`, `kCGWindowName`, AXTitle, `AXIdentifier`, Safari's address-field description, `mode` (when granted) and the verdict. Commit the output, with titles replaced, as fixtures in `Tests/Fixtures/private-windows/<browser>-<version>-<macOS>-<lang>.json`, and test the rules against them. These fixtures replace the Windows-style Chrome title in `Tests/ScreencapCoreTests/CaptureTests.swift`.
2. **Test matrix.** Run every browser in the table with a normal and a private window, in English and German (Chrome's German marker shares no word with English), on macOS 15 and 26.
3. **Pixel check.** Open a page with a solid magenta background (a `data:` URL) in a private window, then capture with that window:
   - focused: expect a blocked marker;
   - visible behind a focused normal window: expect no magenta pixel;
   - on a second display;
   - in a full-screen Space.

   The frame must contain no magenta pixel in any case.
4. **Edge cases.** Repeat the pixel check with:
   - a Chrome incognito window showing a JavaScript `alert()`;
   - a Chrome guest window;
   - a Brave "Private Window with Tor";
   - Firefox with `browser.privatebrowsing.autostart` set;
   - an Arc incognito window, and Little Arc;
   - Dia windows in two profiles;
   - Automation denied for Chrome, with the UI in a language that has no marker (the whole app must then be excluded).

## Prior art

- **screenpipe** (open source, Rust). It matches a translated title list (`titles.rs`) and checks `AXIdentifier` for Arc (`tree/macos.rs`). An opt-in AppleScript asks Chromium browsers for `mode` and Arc for `incognito` (`incognito/macos.rs`). It fixed capture of unfocused private windows in [#6260](https://github.com/screenpipe/screenpipe/pull/6260) after [#6198](https://github.com/screenpipe/screenpipe/issues/6198), on macOS 15.7.
- **ActivityWatch** ([`macos.swift`](https://github.com/ActivityWatch/aw-watcher-window/blob/master/aw_watcher_window/macos.swift)). It reads `mode == "incognito"` through ScriptingBridge for Chrome, Chromium and Brave, and blanks those events. Its comments say Safari's private state cannot be read, and it leaves Firefox's title suffix to user rules.
- **SimplyTrack.** It reads `mode` for Chrome, Brave, Edge and Vivaldi, Arc's `incognito`, and Dia's `AXIdentifier`. For Safari it checks the Window menu through System Events, and for Firefox it matches the English suffix `— Private Browsing`.
- **Rewind** (shut down). A [teardown](https://kevinchen.co/blog/rewind-ai-app-teardown/) shows a Safari private window left out of a ScreenCaptureKit frame. How Rewind detected it is undocumented.
- **Timing** ([help](https://timingapp.com/help/exclusions)). It replaces the title and URL of Safari and Chrome incognito windows with "Private". It needs Automation for Safari and Chrome, and its detection method is undocumented.
- **Rize** ([docs](https://docs.rize.io/automatic-tracking/tracking-websites)). It needs Automation on macOS, and its docs say it can no longer detect Safari private windows since recent Safari changes.
- **Dayflow** ([`RecordingPrivacyPreferences.swift`](https://github.com/JerryZLiu/Dayflow/blob/main/Dayflow/Dayflow/Core/Recording/RecordingPrivacyPreferences.swift)). It has an app blocklist and no private-window detection.
- **Limitless and RescueTime.** No public description of private-window handling was found.
