# Multiplayer Projects Architecture

## Executive Summary

This document describes the architecture for transforming "progress sharing" into true **multiplayer projects** - collaborative workspaces where friends can share full events (not just screenshots) and work together on projects as if they were local.

---

## Current State

### What Exists Today

#### Data Model
- **`events` table**: Full local event data (40+ fields including timestamp, project, category, caption, app metadata, context, paths, etc.)
- **`room_memberships` table**: Tracks rooms I belong to (roomId, roomName, role, ownerUserId, etc.)
- **`room_events_cache` table**: Currently stores **minimal** shared data:
  ```
  id, room_id, author_user_id, author_username, timestamp_ms, caption, image_cache_path
  ```
- **`project_room_links` table**: Links a local project to a room for publishing

#### Sync Service (`RoomSyncService.ts`)
- `publishProgressEventToRoom()`: Encrypts and uploads **only caption + image**
  ```typescript
  buildPayloadJson({ caption, imageRef, mime })
  ```
- `fetchRoomEvents()`: Returns only `id, roomId, authorUserId, timestampMs, caption, imageRef`

#### Current Flow
1. AI detects "project progress" on a local event
2. If project has room link, publish `{ caption, imageRef }` to room
3. Friends fetch and see caption + screenshot only
4. No backfill - only new events since last sync

### What's Wrong

| Issue | Impact |
|-------|--------|
| **Minimal payload** | Friends can't filter by category, see app context, or get full event metadata |
| **No backfill** | New members miss all historical project activity |
| **Separate types** | `SharedEvent` != `Event`, requires parallel UI code paths |
| **Progress-only** | Can't share regular activity (Spotify, browsing, etc.) |
| **One-way** | Invitees can view but not contribute back |

---

## Vision

### Multiplayer Projects = Collaborative Workspaces

A shared project should behave **exactly like a local project**, except:
1. Events come from multiple contributors
2. Author avatar shown on non-local events
3. Contributors can all publish to the same room

### Core Principles

1. **Full Event Data**: Sync the complete (privacy-filtered) event payload, not just screenshots
2. **First-Class Events**: Remote events should use the same `Event` type as local events
3. **Bidirectional**: All room members can contribute events
4. **Backfill on Join**: New members see full project history
5. **Unified UI**: One timeline, one query interface, one event type
6. **Privacy Controls**: User chooses which fields to share via settings

### Future Capability (Not Now)
- Share individual events ad-hoc with friends (not tied to projects)
- Share background activity like music, browsing if user opts in

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LOCAL EVENT CAPTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Screenshot captured                                                     │
│  2. AI classifies: category, project, caption, context, etc.                │
│  3. Event saved to local `events` table                                     │
│  4. If project has room link AND sharing enabled:                           │
│     → Encrypt full event payload (privacy-filtered)                         │
│     → Upload to room                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER (room_events)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  - Stores encrypted payloads                                                │
│  - Stores encrypted images                                                  │
│  - All room members can fetch                                               │
│  - All room members can publish (bidirectional)                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SYNC TO LOCAL CACHE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Fetch events from room (since last sync OR since=0 for backfill)        │
│  2. Decrypt payloads → full event data                                      │
│  3. Download and decrypt images → local paths                               │
│  4. Store in `room_events_cache` with full event schema                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UNIFIED QUERY LAYER                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  Query: getProjectEvents({ project: "screencal" })                          │
│                                                                             │
│  → SELECT from `events` WHERE project = 'screencal'                         │
│  → SELECT from `room_events_cache` WHERE project = 'screencal'              │
│                    AND author_user_id != myUserId (dedup)                   │
│  → UNION + sort by timestamp                                                │
│  → Return unified Event[] with optional author fields                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Event Payload Schema

#### What Gets Shared (Privacy-Filtered)

```typescript
interface SharedEventPayload {
  // Version for future migrations
  v: number;
  
  // Core event data
  timestamp: number;
  endTimestamp: number | null;
  project: string | null;
  category: string | null;
  caption: string | null;
  projectProgress: number;
  
  // Optional based on user privacy settings
  appBundleId?: string | null;
  appName?: string | null;
  windowTitle?: string | null;
  contentKind?: string | null;    // "music", "video", etc.
  contentTitle?: string | null;   // Song/video title
  
  // Image reference (separate upload)
  image: { ref: string | null; mime: string };
}
```

#### What's NOT Shared (Privacy)
- `urlHost`, `urlCanonical` (browsing history)
- `contextJson` (detailed context data)
- `trackedAddiction`, `addictionCandidate` (personal)
- Local file paths
- `stableHash`, `detailHash` (internal)

### Updated Table Schema

```sql
CREATE TABLE room_events_cache (
  -- Identity
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  author_username TEXT NOT NULL,
  
  -- Core event fields (same as events table)
  timestamp INTEGER NOT NULL,
  end_timestamp INTEGER,
  project TEXT,
  category TEXT,
  caption TEXT,
  project_progress INTEGER DEFAULT 0,
  
  -- Optional app context (if shared)
  app_bundle_id TEXT,
  app_name TEXT,
  window_title TEXT,
  content_kind TEXT,
  content_title TEXT,
  
  -- Local cached paths
  thumbnail_path TEXT,
  original_path TEXT,
  
  -- Sync metadata
  synced_at INTEGER NOT NULL
);

CREATE INDEX idx_room_events_cache_project ON room_events_cache(project);
CREATE INDEX idx_room_events_cache_room_timestamp ON room_events_cache(room_id, timestamp);
CREATE INDEX idx_room_events_cache_author ON room_events_cache(author_user_id);
```

### Settings for Privacy Control

Add to `Settings` interface:

```typescript
interface Settings {
  // ... existing fields
  
  sharing: {
    // What to include when sharing events to rooms
    includeAppName: boolean;        // Default: true
    includeWindowTitle: boolean;    // Default: false
    includeContentInfo: boolean;    // Default: true (music/video titles)
  };
}
```

---

## Key Behaviors

### 1. Accepting Room Invite (Backfill)

When user accepts a room invite:
1. Create `room_membership` record
2. Auto-link local project if names match
3. **Trigger full sync with `since=0`** (backfill all history)
4. Download and cache all historical images

### 2. Publishing Events

When any room member captures an event for a linked project:
1. Build full payload (privacy-filtered based on settings)
2. Encrypt with room key
3. Upload to room
4. **Both owner AND members can publish** (bidirectional)

### 3. Querying Events

When UI requests project events:
```typescript
getProjectEvents({ project, startDate, endDate, ... })
```
Returns unified `Event[]` that includes:
- Local events from `events` table (author = implicit self)
- Remote events from `room_events_cache` (author = explicit, excluding self)

### 4. Display in UI

**Projects View** (`ProjectsView.tsx`):
- List all projects (local memories + shared rooms where no local project exists)
- Show `[shared]` badge for projects with room membership
- Clicking opens same `ProjectDetailView`

**Project Progress View** (`ProjectProgressView.tsx`):
- Dropdown shows all projects (local + shared)
- Timeline merges local + remote events
- Author avatar displayed on remote events
- Sync button triggers full re-sync

**Timeline View** (`TimelineView.tsx`):
- When filtering by project, include remote events
- Author avatar on non-local events

---

## Component Changes Required

### Backend

| Component | Change |
|-----------|--------|
| `room_events_cache` schema | Add full event fields |
| `migrations.ts` | Migration for schema change |
| `RoomEventsCacheRepository.ts` | Update to handle full event data |
| `RoomSyncService.ts` | Update payload to include full event data |
| `SharedProjectsService.ts` | Update to return Event-compatible objects |
| `SettingsStore.ts` | Add sharing privacy settings |
| `RoomsService.ts` | Trigger backfill on accept |

### Frontend Types

| Type | Change |
|------|--------|
| `Event` | Add optional `authorUserId`, `authorUsername` fields |
| Remove `SharedEvent` | Use unified `Event` type instead |
| `Settings` | Add `sharing` settings |

### Frontend Components

| Component | Change |
|-----------|--------|
| `ProjectsView.tsx` | Include shared-only projects in list |
| `ProjectDetailView.tsx` | Query unified events |
| `ProjectProgressView.tsx` | Already mostly done, verify unified query |
| `ProgressCard.tsx` | Show author avatar when `authorUserId` present |
| `TimelineFilters.tsx` | Include shared projects in filter |
| Settings UI | Add sharing privacy controls |

---

## API Contract (Server)

### Current Server Response
```typescript
// GET /api/rooms/:roomId/events
{
  id: string;
  roomId: string;
  authorUserId: string;
  timestampMs: number;
  payloadCiphertext: string;  // Encrypted { caption, image }
  imageRef: string | null;
}
```

### Required Server Changes (if any)

The server stores encrypted payloads opaquely. The payload content change is **transparent to server** - we just send more data in the encrypted payload.

**No server changes required** for the payload expansion.

Server may need:
- Endpoint to list room members (for username resolution) - **may already exist**
- Ensure all members can POST events (bidirectional) - **verify**

---

## Migration Path

### Phase 1: Schema & Backend
1. Add full fields to `room_events_cache` table (migration)
2. Update repository to read/write full event data
3. Update sync service to build full payloads
4. Add privacy settings to SettingsStore

### Phase 2: Sync Logic
1. Update `publishProgressEventToRoom` to send full event payload
2. Update `fetchRoomEvents` to parse full payload
3. Implement backfill (since=0) on invite accept
4. Add background sync for all room memberships

### Phase 3: Unified Query Layer
1. Create `getProjectEventsUnified()` that queries both tables
2. Return `Event[]` with author fields populated for remote events
3. Handle deduplication (local events take precedence)

### Phase 4: Frontend Integration
1. Update `Event` type with optional author fields
2. Remove `SharedEvent` type
3. Update components to use unified type
4. Add author avatar display logic
5. Add sharing settings UI

### Phase 5: Polish
1. Verify bidirectional publishing works
2. Test backfill with large histories
3. Add progress indicators for initial sync
4. Handle offline/error states gracefully

---

## Open Questions for Implementer

1. **Server bidirectional**: Verify all room members can POST events (not just owner)
2. **Room members endpoint**: Verify `/api/rooms/:roomId/members` exists and returns usernames
3. **Image storage quota**: Any limits on total images per room?
4. **Payload size limits**: Max size for encrypted payload?
5. **Background activity**: Should we auto-share non-progress events for linked projects, or only explicit progress captures?

---

## Success Criteria

- [ ] Shared projects appear in Projects view like regular projects
- [ ] Clicking shared project shows unified timeline with all contributors
- [ ] Author avatar visible on events from friends
- [ ] New member sees full history after accepting invite
- [ ] All members can contribute events (bidirectional)
- [ ] Privacy settings control what fields are shared
- [ ] Type system is unified (no separate SharedEvent)
- [ ] Queries work identically for local and shared projects
