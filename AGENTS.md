# AGENTS.md

Guidance for Codex when working with this repository.

## Project Overview

**Screencap** is a macOS Electron desktop app that captures screenshots on a schedule, classifies them using optional LLM analysis, and turns them into timelines, daily summaries ("Day Wrapped"), and journals. It tracks app/window context, browser activity, media playback, and IDE workspace info to help users understand where their time goes.

Key features:
- Scheduled screenshot capture with context detection (app, window title, browser URL, media, IDE workspace)
- Event timeline with automatic merging of similar captures
- LLM-based classification (local or cloud) with fallback strategies
- Daily journal entries and "Day Wrapped" tray widget
- Project tracking with Git integration
- Addiction tracking with confirmation/rejection workflow
- Social features: sharing projects, friend feeds, encrypted room collaboration
- Privacy-focused: local-first with optional cloud AI (text-first, vision fallback)

## Commands

### Development
```bash
npm install         # Install dependencies
npm run dev         # Start dev server (rebuilds native modules)
npm run dev:fast    # Start dev server (skip native rebuild)
npm test            # Run tests (rebuilds for Node first)
npm run test:watch  # Run tests in watch mode
```

### Building
```bash
npm run build    # Build for production
npm run preview  # Preview production build
npx electron-builder --config electron-builder.yml  # Package distributable
```

### Code Quality
```bash
npm run lint       # Check code with Biome
npm run lint:fix   # Auto-fix linting issues
npm run typecheck  # TypeScript type checking
```

### Utilities
```bash
npm run rebuild:electron  # Rebuild native modules for Electron
npm run rebuild:node      # Rebuild native modules for Node (tests)
npm run generate:icon     # Generate app icon from source
npm run eval:classification -- --limit=25 --strategies=vision,text,local
```

### Single Test Execution
```bash
npm test -- electron/main/features/context/__tests__/resolvers.test.ts
npm test -- -t "spotifyResolver"
```

## Architecture

### Directory Structure

```
electron/
  main/           # Main process (Node.js)
    app/          # App lifecycle (window, tray, popup, protocol, bootstrap)
    features/     # Business logic organized by domain
    infra/        # Infrastructure (db, settings, logging, paths)
    ipc/          # IPC handlers (security boundary)
    testUtils/    # Test utilities
  preload/        # Preload script (contextBridge)
  shared/         # Types and channel names shared between main/renderer
src/              # Renderer process (React UI)
  components/     # UI components organized by feature
  hooks/          # React hooks
  lib/            # Utilities
  stores/         # Zustand state stores
```

### Main Process Features (electron/main/features/)

**Core:**
- `capture/` - Screenshot capture logic (dominant activity sampling)
- `scheduler/` - Interval-based capture scheduling
- `queue/` - Async task processing (classification, OCR, merging)
- `events/` - Event storage, querying, and mutations
- `context/` - Context detection (apps, browsers, media, IDE)
- `ai/` - AI routing and provider abstraction
- `llm/` - LLM API clients (OpenRouter, local endpoints), ClassificationService
- `ocr/` - macOS Vision-based OCR
- `retention/` - Storage cleanup policies

**Supporting:**
- `activityWindow/` - Activity window management
- `automationRules/` - Per-app/website relabeling and dismissal rules
- `projectJournal/` - Git repo linking, commit history
- `projects/` - Project management
- `favicons/` - Safe favicon fetching
- `permissions/` - macOS permission status
- `shortcuts/` - Global hotkeys
- `update/` - Auto-updater (electron-updater)
- `appIcons/` - App icon extraction
- `aiEval/` - Classification evaluation harness

**Social:**
- `social/` - Username registration, friend requests, avatar sync
- `publishing/` - Project share creation with E2EE
- `rooms/` - Project collaboration rooms
- `sharedProjects/` - Syncing shared project events
- `socialFeed/` - Friends feed, day wrapped snapshots
- `chat/` - Direct messages and project threads
- `sync/` - Data synchronization

### Infrastructure (electron/main/infra/)

- `db/` - SQLite schema, migrations, repositories (better-sqlite3)
- `settings/` - Settings storage with encrypted API keys (safeStorage)
- `log/` - File-based logging with rotation
- `paths/` - Path utilities (screenshots, database, user data)
- `windows/` - Window management utilities

### Renderer Components (src/components/)

- `timeline/` - Event timeline view
- `wrapped/` - Day Wrapped visualization
- `settings/` - Settings panels
- `popup/` - Tray popup UI
- `eod/` - End-of-day journal flow
- `progress/` - Project progress timeline
- `memory/` - Memories, projects, addictions views
- `story/` - Story/recap views
- `onboarding/` - Onboarding wizard
- `layout/` - Layout components (titlebar, navigation)
- `visualization/` - Charts and visualizations
- `avatar/` - User avatar components
- `preview/` - Event preview modal
- `dialogs/` - Dialog components
- `performance/` - Performance guards
- `ui/` - Reusable UI components (shadcn/ui-style)

### IPC Security

All IPC goes through a hardened security layer:

1. Channel definitions: `electron/shared/ipc.ts`
2. Preload API: `electron/preload/index.ts` (contextBridge)
3. Secure handlers: `electron/main/ipc/secure.ts` (sender validation)
4. Input validation: `electron/main/ipc/validation.ts` (Zod schemas)
5. Handler registration: `electron/main/ipc/register.ts`

**Adding a new IPC channel:**
1. Add channel name to `IpcChannels` in `electron/shared/ipc.ts`
2. Add handler signature to `IpcInvokeHandlers` interface
3. Create Zod schema in `electron/main/ipc/validation.ts`
4. Implement handler in `electron/main/ipc/handlers/`
5. Export from preload in `electron/preload/index.ts`

### Database

SQLite with main tables:
- `events` - Screenshot events with context, classification, project metadata
- `event_screenshots` - Multiple screenshots per event (for merging)
- `memories` - User journal entries
- `automation_rules` - Per-app/website rules
- `project_repos` - Git repos linked to projects
- `eod_entries` - End-of-day journal entries
- `social_*` tables - Social features

Schema: `electron/main/infra/db/schema.ts`, migrations: `migrations.ts`

### Context Detection Flow

1. `SystemEventsProvider` captures foreground app via System Events
2. `ContextService` runs foreground + background providers in parallel
3. Foreground: queries providers supporting current app bundle ID
4. Background: queries `BackgroundCapableProvider`s (e.g., Spotify)
5. Merges results: best content/URL by confidence, background array for ambient context

Provider registration: `electron/main/features/context/providers/registry.ts`

### AI Classification Pipeline

Fallback strategy:
1. Reuse cache (fingerprint lookup)
2. Retrieval (similar events by context)
3. Local LLM (if configured)
4. Cloud text (OpenRouter, no image)
5. Cloud vision (if enabled)
6. Baseline fallback (rule-based)

## Development Patterns

### Creating a New Feature

1. Create directory in `electron/main/features/<feature>/`
2. Define service class or functions
3. Add IPC handlers in `electron/main/ipc/handlers/<feature>.ts`
4. Register in `electron/main/ipc/register.ts`
5. Add Zod schemas in `electron/main/ipc/validation.ts`
6. Export API from `electron/preload/index.ts`
7. Create UI in `src/components/<feature>/`
8. Add hooks in `src/hooks/` if needed

### Adding Database Fields

1. Modify schema in `electron/main/infra/db/schema.ts`
2. Add migration in `migrations.ts`
3. Update repository in `electron/main/infra/db/repositories/`
4. Update types in `electron/shared/types/` if exposed via IPC

### Writing Tests

- Use Vitest, run with `npm test`
- Test files: `__tests__/` directories or `*.test.ts` colocated
- Mock IPC and Electron APIs when needed

## Important Notes

- **macOS only** - Uses macOS-specific APIs (System Events, AppleScript, Vision)
- **Native modules** - sharp/better-sqlite3 require rebuild for Electron vs Node
- **Permissions** - Screen Recording required; Accessibility + Automation optional
- **Database**: `~/Library/Application Support/Screencap/screencap.db`
- **Screenshots**: `~/Library/Application Support/Screencap/screenshots/`
- **OCR binary** must exist at `build/ocr/screencap-ocr` for dev
- **CSP**: Update `electron.vite.config.ts` if adding new image CDNs

## Key Files

- `electron/main/app/bootstrap.ts` - App initialization
- `electron/shared/ipc.ts` - IPC channel definitions
- `electron/main/ipc/validation.ts` - Zod schemas
- `electron/main/infra/db/schema.ts` - Database schema
- `electron/main/features/llm/ClassificationService.ts` - LLM classification
- `electron/main/features/context/ContextService.ts` - Context detection
- `docs/security.md` - Security guidelines
- `docs/adding-context-providers.md` - Provider guide
