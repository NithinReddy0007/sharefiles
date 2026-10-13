-- Migration: 0001_initial_schema.sql
-- Qshare database schema for Cloudflare D1

CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    passcode_hash TEXT NOT NULL,
    passcode_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    total_size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' -- active, expired, deleted
);

CREATE INDEX IF NOT EXISTS idx_rooms_expires_at ON rooms (expires_at);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms (status);

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, uploaded, deleted
    upload_id TEXT, -- for multipart upload tracking
    uploaded_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_room_id ON files (room_id);
CREATE INDEX IF NOT EXISTS idx_files_storage_key ON files (storage_key);
