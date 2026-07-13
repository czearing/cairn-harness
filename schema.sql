CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_topic TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    topic TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS messages_inbox
ON messages(recipient, status, created_at);

CREATE TABLE IF NOT EXISTS dead_letters (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    target TEXT NOT NULL,
    topic TEXT NOT NULL,
    body TEXT NOT NULL,
    error TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_files (
    path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    message_id TEXT NOT NULL,
    ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    message_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    inbound_sender TEXT NOT NULL,
    inbound_topic TEXT NOT NULL,
    inbound_body TEXT NOT NULL,
    prompt TEXT NOT NULL,
    output_json TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
    content_hash TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    content TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
);
