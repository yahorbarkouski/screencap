import type Database from "better-sqlite3";
import { createLogger } from "../log";

const logger = createLogger({ scope: "Schema" });

export function createTables(db: Database.Database): void {
	logger.info("Creating tables if not exists");

	db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      end_timestamp INTEGER,
      display_id TEXT,
      category TEXT,
      subcategories TEXT,
      project TEXT,
      project_progress INTEGER DEFAULT 0,
      project_progress_confidence REAL,
      project_progress_evidence TEXT,
      tags TEXT,
      confidence REAL,
      caption TEXT,
      tracked_addiction TEXT,
      addiction_candidate TEXT,
      addiction_confidence REAL,
      addiction_prompt TEXT,
      thumbnail_path TEXT,
      original_path TEXT,
      stable_hash TEXT,
      detail_hash TEXT,
      merged_count INTEGER DEFAULT 1,
      dismissed INTEGER DEFAULT 0,
      user_label TEXT,
      status TEXT DEFAULT 'pending',
      app_bundle_id TEXT,
      app_name TEXT,
      window_title TEXT,
      url_host TEXT,
      url_canonical TEXT,
      content_kind TEXT,
      content_id TEXT,
      content_title TEXT,
      is_fullscreen INTEGER DEFAULT 0,
      context_provider TEXT,
      context_confidence REAL,
      context_key TEXT,
      context_json TEXT
    );

    CREATE TABLE IF NOT EXISTS event_screenshots (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      display_id TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      thumbnail_path TEXT NOT NULL,
      original_path TEXT NOT NULL,
      stable_hash TEXT,
      detail_hash TEXT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favicons (
      host TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_icons (
      bundle_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      description TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      next_attempt_at INTEGER NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      period_type TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eod_entries (
      id TEXT PRIMARY KEY,
      day_start INTEGER NOT NULL,
      day_end INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      submitted_at INTEGER,
      UNIQUE(day_start)
    );

    CREATE TABLE IF NOT EXISTS project_repos (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      project_name TEXT NOT NULL,
      repo_root TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(project_key, repo_root)
    );

    CREATE TABLE IF NOT EXISTS project_shares (
      project_name TEXT PRIMARY KEY,
      public_id TEXT NOT NULL,
      write_key TEXT NOT NULL,
      share_url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_published_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS project_room_links (
      project_name TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_keys_cache (
      room_id TEXT PRIMARY KEY,
      room_key_enc TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_account (
      user_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      username TEXT NOT NULL,
      enc_private_keys_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friends_cache (
      friend_user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      last_seen INTEGER
    );

    CREATE TABLE IF NOT EXISTS room_memberships (
      room_id TEXT PRIMARY KEY,
      room_name TEXT NOT NULL,
      role TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      owner_username TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      last_synced_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS room_events_cache (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      author_username TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      end_timestamp_ms INTEGER,
      project TEXT,
      category TEXT,
      caption TEXT,
      project_progress INTEGER DEFAULT 0,
      app_bundle_id TEXT,
      app_name TEXT,
      window_title TEXT,
      content_kind TEXT,
      content_title TEXT,
      thumbnail_path TEXT,
      original_path TEXT,
      synced_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_members_cache (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY(room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_threads_cache (
      thread_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      room_id TEXT,
      title TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages_cache (
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      author_user_id TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(thread_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS chat_unread_state (
      thread_id TEXT PRIMARY KEY,
      last_read_timestamp_ms INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

	logger.info("Tables created");
}

export function createIndexes(db: Database.Database): void {
	logger.info("Creating indexes if not exists");

	db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_display_timestamp ON events(display_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
    CREATE INDEX IF NOT EXISTS idx_events_project_progress ON events(project_progress);
    CREATE INDEX IF NOT EXISTS idx_events_project_progress_project_timestamp ON events(project_progress, project, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_app_bundle_id ON events(app_bundle_id);
    CREATE INDEX IF NOT EXISTS idx_events_url_host ON events(url_host);
    CREATE INDEX IF NOT EXISTS idx_events_content_kind ON events(content_kind);
    CREATE INDEX IF NOT EXISTS idx_events_context_key ON events(context_key);
    CREATE INDEX IF NOT EXISTS idx_events_stable_hash_context_key ON events(stable_hash, context_key);
    CREATE INDEX IF NOT EXISTS idx_event_screenshots_event_id ON event_screenshots(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_screenshots_event_primary ON event_screenshots(event_id, is_primary);
    CREATE INDEX IF NOT EXISTS idx_favicons_updated_at ON favicons(updated_at);
    CREATE INDEX IF NOT EXISTS idx_app_icons_updated_at ON app_icons(updated_at);
    CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
    CREATE INDEX IF NOT EXISTS idx_queue_created ON queue(created_at);
    CREATE INDEX IF NOT EXISTS idx_queue_next_attempt ON queue(next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_queue_event_id ON queue(event_id);
    CREATE INDEX IF NOT EXISTS idx_project_repos_project_key ON project_repos(project_key);
    CREATE INDEX IF NOT EXISTS idx_project_repos_repo_root ON project_repos(repo_root);
    CREATE INDEX IF NOT EXISTS idx_eod_entries_day_start ON eod_entries(day_start);
    CREATE INDEX IF NOT EXISTS idx_eod_entries_submitted_at ON eod_entries(submitted_at);
    CREATE INDEX IF NOT EXISTS idx_project_shares_public_id ON project_shares(public_id);
    CREATE INDEX IF NOT EXISTS idx_project_room_links_room_id ON project_room_links(room_id);
    CREATE INDEX IF NOT EXISTS idx_room_keys_cache_updated_at ON room_keys_cache(updated_at);
    CREATE INDEX IF NOT EXISTS idx_friends_cache_last_seen ON friends_cache(last_seen);
    CREATE INDEX IF NOT EXISTS idx_room_memberships_role ON room_memberships(role);
    CREATE INDEX IF NOT EXISTS idx_room_events_cache_room_timestamp ON room_events_cache(room_id, timestamp_ms);
    CREATE INDEX IF NOT EXISTS idx_room_events_cache_author ON room_events_cache(author_user_id);
    CREATE INDEX IF NOT EXISTS idx_room_events_cache_project ON room_events_cache(project);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_cache_thread_timestamp ON chat_messages_cache(thread_id, timestamp_ms);
  `);

	logger.info("Indexes created");
}
