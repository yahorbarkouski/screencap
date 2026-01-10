# Shared Projects Timeline Design

## Overview

Desktop-to-desktop project progress sharing. Friends see shared projects rendered similarly to their own local projects, with contributor avatars to distinguish authorship.

## Architecture

### Data Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        Project Types                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LOCAL PROJECT (mine)           SHARED PROJECT (from friend)    │
│  ─────────────────────          ──────────────────────────────  │
│  • Events in local SQLite       • Events fetched from server    │
│  • I capture progress           • Friend captures progress      │
│  • Optional: link to room       • Linked to room (required)     │
│  • I may invite friends         • I accepted an invite          │
│                                                                  │
│  MY LINKED PROJECT (collaborative)                              │
│  ─────────────────────────────────                              │
│  • Events in local SQLite (mine)                                │
│  • Events from room (friends' contributions)                    │
│  • Both merged in timeline                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Database Additions

**New table: `shared_projects`**
```sql
CREATE TABLE IF NOT EXISTS shared_projects (
  room_id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,          -- Display name (from room)
  owner_user_id TEXT NOT NULL,         -- Who created the project
  owner_username TEXT NOT NULL,        -- For avatar display
  accepted_at INTEGER NOT NULL,        -- When invite was accepted
  last_synced_at INTEGER               -- Last successful fetch
);
```

**New table: `shared_events_cache`**
```sql
CREATE TABLE IF NOT EXISTS shared_events_cache (
  id TEXT PRIMARY KEY,                 -- Event ID
  room_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  author_username TEXT NOT NULL,       -- For avatar
  timestamp_ms INTEGER NOT NULL,
  caption TEXT,
  image_cache_path TEXT,               -- Local decrypted image path
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES shared_projects(room_id)
);
```

**New table: `room_members_cache`**
```sql
CREATE TABLE IF NOT EXISTS room_members_cache (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL,                  -- 'owner' | 'member'
  PRIMARY KEY(room_id, user_id)
);
```

### Type Definitions

```typescript
// electron/shared/types.ts

interface SharedProject {
  roomId: string;
  projectName: string;
  ownerUserId: string;
  ownerUsername: string;
  acceptedAt: number;
  lastSyncedAt: number | null;
}

interface SharedEvent {
  id: string;
  roomId: string;
  authorUserId: string;
  authorUsername: string;
  timestampMs: number;
  caption: string | null;
  imageCachePath: string | null;
}

// Unified timeline item for display
interface UnifiedProgressEvent {
  id: string;
  timestamp: number;
  caption: string | null;
  imagePath: string | null;
  projectName: string;
  source: 'local' | 'shared';
  author: {
    userId: string;
    username: string;
    isMe: boolean;
  } | null;
}
```

## UI Design

### Project Progress View Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Project progress                              [Share] [▼ Proj]  │
│  Visual milestones detected from captures           [7d] [30d]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  MY PROJECTS                              [▼]              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  December 28, 2025                                               │
│                                                                   │
│  14:32    ┌────────────────────────────────────────────────┐    │
│     ●─────│  [Screenshot image]                            │    │
│           │                                                 │    │
│           │  ┌──┐  Implemented authentication flow         │    │
│           │  │YB│  screencal                               │    │
│           │  └──┘                                [Progress] │    │
│           └────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SHARED WITH ME                           [▼]              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  December 28, 2025                                               │
│                                                                   │
│  11:45    ┌────────────────────────────────────────────────┐    │
│     ●─────│  [Screenshot image]                       [JD] │    │
│           │                                                 │    │
│           │  Added dark mode support                       │    │
│           │  thenetwork-landing                            │    │
│           │                                       [Progress] │    │
│           └────────────────────────────────────────────────┘    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Avatar Component

```
Avatar positioning options:

OPTION A: Corner overlay (recommended)
┌─────────────────────────────────┐
│                           ┌───┐ │
│      [Screenshot]         │ J │ │
│                           └───┘ │
│  Caption text here...           │
└─────────────────────────────────┘

OPTION B: Inline with caption
┌─────────────────────────────────┐
│      [Screenshot]               │
│                                 │
│  ┌─┐ Caption text here...       │
│  │J│ project-name               │
│  └─┘                            │
└─────────────────────────────────┘

OPTION C: Timeline marker (chosen)
┌─────────────────────────────────────────────────────┐
│                                                      │
│  14:32  ┌─┐  ┌───────────────────────────────────┐  │
│    ●────│J│──│  [Screenshot]                     │  │
│         └─┘  │                                   │  │
│              │  Caption text here...             │  │
│              └───────────────────────────────────┘  │
│                                                      │
└─────────────────────────────────────────────────────┘

Design decision: OPTION C
- Avatar sits between timeline dot and card
- Clear visual flow: time → author → content
- Doesn't obscure screenshot
- Works well with existing timeline structure
```

### Avatar Rendering Rules

1. **Local project, I'm only contributor**: No avatar shown
2. **Local project, has invited friends**: Show avatars for all events
3. **Shared project**: Always show avatars (it's someone else's project)
4. **My own events in any context**: Show my avatar with subtle styling (outlined instead of filled)

```tsx
// Avatar component
function AuthorAvatar({ 
  username, 
  isMe 
}: { 
  username: string; 
  isMe: boolean 
}) {
  const initial = username.charAt(0).toUpperCase();
  
  return (
    <div className={cn(
      "h-6 w-6 rounded-full flex items-center justify-center",
      "text-xs font-medium",
      isMe 
        ? "border border-primary/40 text-primary/70 bg-transparent" 
        : "bg-primary text-primary-foreground"
    )}>
      {initial}
    </div>
  );
}
```

## Service Layer

### SharedProjectsService.ts

```typescript
// electron/main/features/sync/SharedProjectsService.ts

interface SharedProjectsService {
  // Called when accepting room invite
  linkSharedProject(params: {
    roomId: string;
    projectName: string;
    ownerUserId: string;
    ownerUsername: string;
  }): void;
  
  // List all shared projects
  listSharedProjects(): SharedProject[];
  
  // Get events for a shared project (from cache)
  getSharedProjectEvents(params: {
    roomId: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): SharedEvent[];
  
  // Sync events from server, decrypt, cache images
  syncSharedProject(roomId: string): Promise<number>;
  
  // Sync all shared projects
  syncAllSharedProjects(): Promise<void>;
  
  // Get cached image path for event
  getEventImagePath(eventId: string): string | null;
}
```

### Image Caching Flow

```
1. Fetch encrypted room events from server
2. For each event with imageRef:
   a. Download encrypted image bytes from Blob URL
   b. Decrypt using room key
   c. Save to local cache directory: ~/.screencal/shared-images/{roomId}/{eventId}.png
   d. Update shared_events_cache.image_cache_path
3. Return decrypted events with local image paths
```

## IPC Channels

```typescript
// electron/shared/ipc.ts additions

export const IpcChannels = {
  // ... existing channels
  
  SharedProjects: {
    List: 'shared-projects:list',
    GetEvents: 'shared-projects:get-events',
    Sync: 'shared-projects:sync',
    SyncAll: 'shared-projects:sync-all',
  },
} as const;
```

## Renderer API

```typescript
// window.api.sharedProjects
interface SharedProjectsApi {
  list(): Promise<SharedProject[]>;
  getEvents(params: {
    roomId: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): Promise<SharedEvent[]>;
  sync(roomId: string): Promise<number>;
  syncAll(): Promise<void>;
}
```

## ProjectProgressView Changes

### State Additions

```typescript
const [viewMode, setViewMode] = useState<'all' | 'mine' | 'shared'>('all');
const [sharedProjects, setSharedProjects] = useState<SharedProject[]>([]);
const [sharedEvents, setSharedEvents] = useState<SharedEvent[]>([]);
const [isSyncing, setIsSyncing] = useState(false);
```

### Data Fetching

```typescript
// Fetch shared projects on mount and periodically
useEffect(() => {
  const fetchShared = async () => {
    if (!window.api?.sharedProjects) return;
    const projects = await window.api.sharedProjects.list();
    setSharedProjects(projects);
    
    // Fetch events for all shared projects
    const allEvents = await Promise.all(
      projects.map(p => 
        window.api.sharedProjects.getEvents({
          roomId: p.roomId,
          ...rangeBounds(preset),
          limit: 5000,
        })
      )
    );
    setSharedEvents(allEvents.flat());
  };
  
  void fetchShared();
  const interval = setInterval(fetchShared, 60000); // Poll every minute
  return () => clearInterval(interval);
}, [preset]);
```

### Timeline Merging

```typescript
const unifiedItems = useMemo(() => {
  const items: UnifiedProgressEvent[] = [];
  
  // Add local events
  for (const e of visibleEvents) {
    items.push({
      id: e.id,
      timestamp: e.timestamp,
      caption: e.caption,
      imagePath: e.originalPath ?? e.thumbnailPath,
      projectName: e.project ?? 'Unknown',
      source: 'local',
      author: hasCollaborators ? { userId: myUserId, username: myUsername, isMe: true } : null,
    });
  }
  
  // Add shared events
  for (const e of sharedEvents) {
    items.push({
      id: e.id,
      timestamp: e.timestampMs,
      caption: e.caption,
      imagePath: e.imageCachePath,
      projectName: sharedProjects.find(p => p.roomId === e.roomId)?.projectName ?? 'Unknown',
      source: 'shared',
      author: { userId: e.authorUserId, username: e.authorUsername, isMe: false },
    });
  }
  
  return items.sort((a, b) => b.timestamp - a.timestamp);
}, [visibleEvents, sharedEvents, sharedProjects, hasCollaborators, myUserId, myUsername]);
```

## Web Frontend Removal

### Files to Delete

```
screencap-website/
├── app/p/
│   └── [publicId]/
│       ├── page.tsx          ❌ DELETE
│       └── not-found.tsx     ❌ DELETE
└── components/progress/
    ├── PublicProgressView.tsx      ❌ DELETE
    ├── PublicProgressCard.tsx      ❌ DELETE
    ├── PublicProgressTimelineGroup.tsx  ❌ DELETE
    └── types.ts                    ❌ DELETE
```

### API Routes to Keep (for desktop uploads)

```
screencap-website/app/api/
├── published-projects/          ✓ KEEP (legacy desktop uploads)
│   ├── route.ts
│   └── [publicId]/
│       └── events/
│           └── route.ts
└── rooms/                       ✓ KEEP (E2EE desktop sync)
    └── [roomId]/
        ├── events/
        └── ...
```

## Implementation Plan

### Phase 1: Database & Service Layer
1. Add new SQLite tables: `shared_projects`, `shared_events_cache`, `room_members_cache`
2. Create `SharedProjectsService.ts` with basic CRUD
3. Modify `acceptProjectInvite` to call `linkSharedProject`

### Phase 2: Sync & Caching
4. Implement `syncSharedProject` with image download/decryption/caching
5. Add background sync on app launch and periodic polling
6. Handle offline mode gracefully (use cache)

### Phase 3: IPC & Preload
7. Add IPC handlers for shared projects
8. Expose `window.api.sharedProjects`

### Phase 4: UI Integration
9. Create `AuthorAvatar` component
10. Modify `ProgressCard` to accept optional author prop
11. Modify `ProgressTimelineGroup` to handle unified events
12. Update `ProjectProgressView` with view mode toggle and shared events

### Phase 5: Web Cleanup
13. Delete web frontend files
14. Update any remaining references

## Success Criteria

1. Friend A shares project X with Friend B
2. Friend B accepts invite in tray popup
3. Friend B sees project X in "Shared with me" section of Project Progress
4. All events show Friend A's avatar (first letter)
5. Images load from local cache (work offline after first sync)
6. No web pages exist for viewing progress (desktop-only)
