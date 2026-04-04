# Adding Context Providers

This guide explains how to add support for new applications and browsers to the context capture system.

## Architecture Overview

The context system captures two types of activities:

- **Foreground Activity**: What the user is actively focused on (browser tab, IDE, etc.)
- **Background Activity**: Ambient context like music playing in the background

```
ContextService
    ├── collectForegroundSnapshot()        # Gets active app/window via native macOS APIs
    ├── ForegroundProviders                # Enrich based on foreground app
    │   ├── SafariProvider
    │   ├── ChromiumProvider
    │   └── SpotifyProvider (when Spotify is foreground)
    └── BackgroundProviders                # Collect ambient context
        └── SpotifyProvider.collectBackground() (when playing music)
```

**Flow:**
1. `SystemEventsProvider` captures foreground app (bundle ID, name, PID) and window info (title, bounds, fullscreen state)
2. `ContextService` runs foreground and background collection in parallel:
   - **Foreground**: Queries providers that support the current app
   - **Background**: Queries all `BackgroundCapableProvider`s (e.g., Spotify playing music)
3. Foreground results are merged: best `content` and `url` by confidence are selected
4. Background results are filtered to exclude the foreground app (no duplication)
5. `buildActivityContext()` constructs the final `ActivityContext` with foreground + background data

### Foreground vs Background

| Aspect | Foreground | Background |
|--------|------------|------------|
| Trigger | App must be in focus | Always collected if active |
| Example | YouTube video being watched | Spotify track playing |
| Storage | `content`, `url`, `contextKey` | `background[]` array |
| UI | Main event display | Small indicator with action button |

## File Structure

```
electron/main/features/context/
├── providers/
│   ├── types.ts              # ContextProvider interface
│   ├── registry.ts           # Provider registration and ordering
│   ├── ChromiumProvider.ts   # Chrome, Brave, Edge, Dia, etc.
│   ├── SafariProvider.ts     # Safari, Safari Technology Preview
│   ├── SpotifyProvider.ts    # Spotify desktop app
│   ├── SystemEventsProvider.ts
│   └── index.ts              # Exports all providers
├── resolvers.ts              # URL content resolvers (YouTube, Netflix, etc.)
├── url.ts                    # URL canonicalization utilities
├── keyBuilder.ts             # Context key generation
├── applescript.ts            # AppleScript execution helper
├── ContextService.ts         # Main orchestrator
└── __tests__/                # Unit tests
```

## Adding a New Chromium Browser

Most Chromium-based browsers share the same AppleScript API. To add one:

### 1. Find the Bundle ID

```bash
osascript -e 'id of app "BrowserName"'
```

### 2. Verify AppleScript Support

```bash
osascript -e 'tell application "BrowserName"
  set activeTab to active tab of front window
  return (URL of activeTab) & "|||" & (title of activeTab)
end tell'
```

If this returns URL and title, the browser uses standard Chromium API.

### 3. Add to ChromiumProvider

Edit `providers/ChromiumProvider.ts`:

```typescript
const CHROMIUM_BROWSERS: ChromiumBrowserConfig[] = [
  { bundleId: 'com.google.Chrome', appName: 'Google Chrome' },
  // Add your browser:
  { bundleId: 'com.example.browser', appName: 'Example Browser' }
]
```

### Browsers with Non-Standard APIs

Some browsers (e.g., Dia) use different AppleScript syntax. In such cases:

1. Discover the API:
```bash
# Check window properties
osascript -e 'tell application "Dia" to get properties of front window'

# Check tab properties
osascript -e 'tell application "Dia" to get properties of tab 1 of window 1'

# Find the active/focused tab property
osascript -e 'tell application "Dia" to get isFocused of tab 1 of window 1'
```

2. Create a custom script builder:
```typescript
function buildDiaTabScript(): string {
  return `
tell application "Dia"
  set tabCount to count of tabs of window 1
  repeat with i from 1 to tabCount
    if isFocused of tab i of window 1 then
      return (URL of tab i of window 1) & "|||" & (name of tab i of window 1)
    end if
  end repeat
end tell
`
}
```

3. Add conditional logic in `collect()`:
```typescript
const isDia = snapshot.app.bundleId === 'company.thebrowser.dia'
const script = isDia ? buildDiaTabScript() : buildChromiumTabScript(browserConfig.appName)
```

## Adding a New Browser Type (Non-Chromium)

For browsers with completely different APIs (like Safari), create a dedicated provider.

### 1. Create Provider File

`providers/NewBrowserProvider.ts`:

```typescript
import { runAppleScript, isAutomationDenied } from '../applescript'
import { canonicalizeUrl, extractHost } from '../url'
import { resolveContent } from '../resolvers'
import { createLogger } from '../../../infra/log'
import type { ContextProvider } from './types'
import type { ForegroundSnapshot, ContextEnrichment, UrlMetadata } from '../types'

const logger = createLogger({ scope: 'NewBrowserProvider' })

const BUNDLE_IDS = new Set(['com.example.browser'])

const TAB_SCRIPT = `
tell application "ExampleBrowser"
  -- browser-specific AppleScript here
  return tabUrl & "|||" & tabTitle
end tell
`

export const newBrowserProvider: ContextProvider = {
  id: 'example',

  supports(snapshot: ForegroundSnapshot): boolean {
    return BUNDLE_IDS.has(snapshot.app.bundleId)
  },

  async collect(snapshot: ForegroundSnapshot): Promise<ContextEnrichment | null> {
    if (!this.supports(snapshot)) return null

    const result = await runAppleScript(TAB_SCRIPT)
    if (!result.success) return null

    const parts = result.output.split('|||')
    if (parts.length < 2) return null

    const rawUrl = parts[0]
    const title = parts[1] || null

    const canonical = canonicalizeUrl(rawUrl)
    if (!canonical) return null

    const host = extractHost(rawUrl)
    if (!host) return null

    const url: UrlMetadata = {
      urlCanonical: canonical,
      host,
      title
    }

    const resolved = resolveContent(canonical, title)

    return {
      url,
      content: resolved?.content ?? null,
      confidence: resolved?.confidence ?? 0.6
    }
  }
}
```

### 2. Export from Index

Edit `providers/index.ts`:

```typescript
export { newBrowserProvider } from './NewBrowserProvider'
```

### 3. Register in Provider Registry

Edit `providers/registry.ts`:

```typescript
import { newBrowserProvider } from './NewBrowserProvider'

const builtInProviders: ContextProvider[] = [
  safariProvider,
  chromiumProvider,
  newBrowserProvider  // Add here
]
```

Providers are automatically sorted by `priority` (higher runs first). Set `priority` on your provider if order matters.

## Adding a Native App Provider (Spotify-style)

For native apps that expose their state via AppleScript (like Spotify, Music.app, etc.), create a dedicated provider that extracts app-specific metadata.

### Key Differences from Browser Providers

| Aspect | Browser Provider | Native App Provider |
|--------|-----------------|---------------------|
| Data source | Active tab URL + title | App-specific state (track, game, etc.) |
| Content kind | Usually `web_page` or URL-based | App-specific (e.g., `spotify_track`) |
| URL metadata | From browser tab | Synthesized canonical URL |
| Confidence | 0.5–0.7 (URL-based) | 0.9–0.95 (direct app state) |

### Example: Spotify Provider

`providers/SpotifyProvider.ts`:

```typescript
import { runAppleScript, isAutomationDenied } from '../applescript'
import { createLogger } from '../../../infra/log'
import type { ContextProvider } from './types'
import type { ForegroundSnapshot, ContextEnrichment, ContentDescriptor, UrlMetadata } from '../types'

const logger = createLogger({ scope: 'SpotifyProvider' })

const SPOTIFY_BUNDLE_IDS = new Set(['com.spotify.client'])

// IMPORTANT: Check if app is running first to avoid launching it
const SPOTIFY_STATE_SCRIPT = `
if application "Spotify" is running then
  tell application "Spotify"
    if player state is stopped then
      return "stopped"
    end if
    set trackName to name of current track
    set artistName to artist of current track
    set albumName to album of current track
    set spotifyUrl to spotify url of current track
    set playerState to player state as string
    return playerState & "|||" & spotifyUrl & "|||" & trackName & "|||" & artistName & "|||" & albumName
  end tell
else
  return "not_running"
end if
`

export const spotifyProvider: ContextProvider = {
  id: 'spotify',
  priority: 10,  // Higher priority than browser providers

  supports(snapshot: ForegroundSnapshot): boolean {
    return SPOTIFY_BUNDLE_IDS.has(snapshot.app.bundleId)
  },

  async collect(snapshot: ForegroundSnapshot): Promise<ContextEnrichment | null> {
    if (!this.supports(snapshot)) return null

    const result = await runAppleScript(SPOTIFY_STATE_SCRIPT)
    if (!result.success) {
      if (isAutomationDenied(result.error)) {
        logger.warn('Automation permission denied for Spotify')
      }
      return null
    }

    const output = result.output.trim()
    if (output === 'stopped' || output === 'not_running') {
      return null
    }

    const parts = output.split('|||')
    if (parts.length < 5) return null

    const [playerState, spotifyUri, trackName, artistName, albumName] = parts
    const trackId = parseSpotifyId(spotifyUri)
    if (!trackId) return null

    const content: ContentDescriptor = {
      kind: 'spotify_track',
      id: trackId,
      title: trackName,
      urlCanonical: `https://open.spotify.com/track/${trackId}`,
      subtitle: artistName,
      metadata: { album: albumName, playerState }
    }

    const url: UrlMetadata = {
      urlCanonical: content.urlCanonical,
      host: 'open.spotify.com',
      title: trackName
    }

    return { url, content, confidence: 0.95 }
  }
}
```

### Native App AppleScript Discovery

```bash
# 1. Get bundle ID
osascript -e 'id of app "Spotify"'
# Result: com.spotify.client

# 2. Check available properties (when app is running)
osascript -e 'tell application "Spotify" to get properties'

# 3. Get current track properties
osascript -e 'tell application "Spotify" to get properties of current track'

# 4. Common Spotify properties:
# - name of current track
# - artist of current track
# - album of current track
# - spotify url of current track (e.g., spotify:track:4uLU6hMCjMI75M1A2tKUQC)
# - player state (playing, paused, stopped)
# - artwork url of current track
```

### Best Practices for Native App Providers

1. **Always check if app is running first** to avoid launching it:
   ```applescript
   if application "AppName" is running then
     tell application "AppName"
       -- your code here
     end tell
   else
     return "not_running"
   end if
   ```

2. **Handle stopped/idle states gracefully** - return `null` when there's no meaningful content to track.

3. **Use high confidence values** (0.9+) since you're reading directly from the app.

4. **Set appropriate priority** - native app providers should typically have higher priority than generic browser providers.

5. **Synthesize canonical URLs** for content that has web equivalents (e.g., Spotify tracks have `open.spotify.com` URLs).

6. **Use the `metadata` field** for additional context that doesn't fit standard fields (album name, player state, etc.).

7. **Track automation errors** to surface permission issues in the Settings UI.

### Adding Background Capability

Native app providers can optionally collect "background" context—activity that happens while the user is focused on another app (e.g., music playing while coding).

To make a provider background-capable:

1. **Implement `BackgroundCapableProvider` interface**:

```typescript
import type { BackgroundCapableProvider } from './types'
import type { BackgroundContext } from '../types'

export const spotifyProvider: BackgroundCapableProvider = {
  id: 'spotify',
  priority: 10,

  supports(snapshot) { ... },
  collect(snapshot) { ... },  // Foreground collection

  // Background collection - called even when app is NOT foreground
  async collectBackground(): Promise<BackgroundContext | null> {
    const state = await fetchSpotifyState()
    
    // Only return if actually playing (not paused/stopped)
    if (!state || state.playerState !== 'playing') {
      return null
    }

    return {
      provider: 'spotify',
      kind: 'spotify_track',
      id: state.trackId,
      title: state.trackName,
      subtitle: state.artistName,
      imageUrl: state.artworkUrl,
      actionUrl: state.spotifyUri  // spotify:track:ID opens directly in Spotify app
    }
  }
}
```

2. **Key rules for background collection**:
   - Only return data when there's **active** activity (e.g., playing, not paused)
   - Return `null` for inactive states—the UI won't show empty background items
   - Include `actionUrl` so users can click to open the content in its native app
   - Keep the data lightweight—no metadata object, just essential display fields

3. **BackgroundContext fields**:

| Field | Type | Description |
|-------|------|-------------|
| `provider` | string | Provider ID (e.g., `'spotify'`) |
| `kind` | ContentKind | Content type (e.g., `'spotify_track'`) |
| `id` | string | Stable content identifier |
| `title` | string | Primary display text |
| `subtitle` | string | Secondary text (artist, etc.) |
| `imageUrl` | string | Album art / icon URL |
| `actionUrl` | string | URI to open content via `shell.openExternal` (e.g., `spotify:track:ID`) |

4. **Allowed protocols for actionUrl**:
   - `http:`, `https:` - opens in default browser
   - `spotify:` - opens directly in Spotify app
   - To add new protocols, update `ALLOWED_PROTOCOLS` in `ipc/handlers/app.ts`

5. **ContextService automatically**:
   - Runs background providers in parallel with foreground
   - Filters out background items from the foreground app (no duplication)
   - Stores background array in `ActivityContext.background`

### Registering the Provider

1. Export from `providers/index.ts`:
   ```typescript
   export { spotifyProvider, getSpotifyAutomationError } from './SpotifyProvider'
   ```

2. Add to `providers/registry.ts`:
   ```typescript
   import { spotifyProvider } from './SpotifyProvider'
   
   const builtInProviders: ContextProvider[] = [
     safariProvider,
     chromiumProvider,
     spotifyProvider  // Add here
   ]
   ```

3. Export automation error getter from `context/index.ts` for permission status tracking.

4. Update `PermissionService.ts` to include the new provider's automation error in the `apps` status.

5. **If your provider returns external image URLs** (like Spotify album art), update the Content Security Policy in `electron.vite.config.ts`:
   ```typescript
   // Add the CDN domain to img-src
   const prodCsp = "... img-src 'self' data: blob: local-file: https://i.scdn.co; ..."
   ```

### Content Kinds for Native Apps

When adding a new native app, extend the `ContentKind` type if needed:

```typescript
// types.ts
export type KnownContentKind =
  | 'youtube_video'
  | 'spotify_track'
  | 'spotify_episode'
  | 'steam_game'        // Example: future provider
  | 'vscode_project'    // Example: future provider
  | 'web_page'
```

The `keyBuilder.ts` includes a fallback for unknown kinds, so new content types work automatically:

```typescript
// Generates: content:custom_kind:some_id
return `content:${sanitizeContentKind(content.kind)}:${sanitizeContentId(content.id)}`
```

## Adding a Content Resolver

To recognize specific content types (like YouTube videos), add a resolver.

Edit `resolvers.ts`:

```typescript
export const spotifyResolver: UrlContentResolver = {
  hosts: ['open.spotify.com'],

  resolve(url: string, title: string | null): ResolverResult | null {
    const parsed = parseUrl(url)
    if (!parsed || !this.hosts.includes(parsed.hostname)) return null

    // Match: /track/abc123, /album/xyz789, /playlist/def456
    const match = parsed.pathname.match(/^\/(track|album|playlist)\/([a-zA-Z0-9]+)/)
    if (!match) return null

    const [, type, id] = match
    const kind = `spotify_${type}` as ContentKind

    return {
      content: {
        kind,
        id,
        title,
        urlCanonical: `https://open.spotify.com/${type}/${id}`
      },
      confidence: 0.95
    }
  }
}

// Add to resolver chain
const resolvers: UrlContentResolver[] = [
  youtubeResolver,
  netflixResolver,
  twitchResolver,
  spotifyResolver,  // Add here
  webPageResolver   // Keep last as fallback
]
```

## AppleScript Discovery Process

When adding support for a new app, use this process to discover its AppleScript API:

```bash
# 1. Get bundle ID
osascript -e 'id of app "AppName"'

# 2. Check if scripting is supported
osascript -e 'tell application "AppName" to get properties'

# 3. Get window properties
osascript -e 'tell application "AppName" to get properties of front window'
osascript -e 'tell application "AppName" to get properties of window 1'

# 4. List available elements
osascript -e 'tell application "AppName" to get tabs of front window'
osascript -e 'tell application "AppName" to get documents'

# 5. Get specific properties
osascript -e 'tell application "AppName" to get URL of front document'
osascript -e 'tell application "AppName" to get URL of active tab of front window'
osascript -e 'tell application "AppName" to get URL of tab 1 of window 1'
```

Common patterns:
- Safari: `front document` → `URL`, `name`
- Chrome/Chromium: `active tab of front window` → `URL`, `title`
- Dia: `tab i of window 1` with `isFocused` property

## Testing

### Unit Tests

Create tests in `__tests__/` for pure functions:

```typescript
// __tests__/resolvers.test.ts
import { describe, it, expect } from 'vitest'
import { spotifyResolver } from '../resolvers'

describe('spotifyResolver', () => {
  it('resolves track URL', () => {
    const result = spotifyResolver.resolve(
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      'Never Gonna Give You Up'
    )
    expect(result?.content.kind).toBe('spotify_track')
    expect(result?.content.id).toBe('4uLU6hMCjMI75M1A2tKUQC')
  })

  it('returns null for non-Spotify URLs', () => {
    const result = spotifyResolver.resolve('https://youtube.com/watch?v=abc', null)
    expect(result).toBeNull()
  })

  it('returns null for Spotify homepage', () => {
    const result = spotifyResolver.resolve('https://open.spotify.com/', null)
    expect(result).toBeNull()
  })
})
```

Run tests:
```bash
npm test
```

### Manual Testing

1. **Test AppleScript directly:**
```bash
osascript -e 'tell application "BrowserName" to get URL of active tab of front window'
```

2. **Test in app with context detection:**
   - Open the target browser
   - Navigate to a specific page
   - Trigger manual capture (Cmd+Shift+C or via menu)
   - Check terminal logs for `[ContextService] Activity context collected`
   - Verify `urlHost`, `contextKey`, and `provider` values

3. **Verify database storage:**
```bash
sqlite3 ~/Library/Application\ Support/Screencap/screencap.db \
  "SELECT app_name, url_host, content_kind, context_key FROM events ORDER BY timestamp DESC LIMIT 5;"
```

### Test Checklist

When adding a new provider, verify:

- [ ] Bundle ID detection works (`supports()` returns true)
- [ ] AppleScript executes without errors
- [ ] URL is captured correctly
- [ ] Title is captured correctly
- [ ] URL canonicalization removes tracking params
- [ ] Content resolvers identify specific content (if applicable)
- [ ] Context key is stable for same content
- [ ] Permission denial is handled gracefully
- [ ] App without windows doesn't crash

## Common Issues

### AppleScript Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `-1728` Can't get | Property doesn't exist | Check API with `get properties` |
| `-2740` Can't go after | Wrong syntax | Different browser API, see discovery |
| `-2741` Expected end of line | Syntax error | Reserved word used as identifier |
| `-1743` Not authorized | Permission denied | Grant Automation permission |

### Browser Not Detected

1. Verify bundle ID: `osascript -e 'id of app "BrowserName"'`
2. Ensure it's in `CHROMIUM_BUNDLE_IDS` or dedicated provider
3. Check `supports()` logic matches bundle ID exactly

### URL Not Captured

1. Test AppleScript manually
2. Check for automation permission in System Settings → Privacy → Automation
3. Verify the provider is registered in `ContextService.providers`
