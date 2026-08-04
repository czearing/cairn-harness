CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_topic TEXT,
    runtime_id TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_replica_profiles (
    agent_id TEXT PRIMARY KEY,
    role_template TEXT NOT NULL,
    replica_eligible INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
);

CREATE TABLE IF NOT EXISTS agent_capabilities (
    agent_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    PRIMARY KEY(agent_id, capability),
    FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    origin_id TEXT,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    creator TEXT NOT NULL,
    assignee TEXT NOT NULL,
    topic TEXT NOT NULL,
    body TEXT NOT NULL,
    result TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    claim_generation INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(parent_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS tasks_inbox
ON tasks(assignee, status, created_at);

CREATE INDEX IF NOT EXISTS tasks_parent
ON tasks(parent_id, status, created_at);

CREATE TABLE IF NOT EXISTS task_context (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    creator TEXT NOT NULL,
    topic TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS task_context_task
ON task_context(task_id, created_at);

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

CREATE TABLE IF NOT EXISTS runtime_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    agent_id TEXT,
    task_id TEXT,
    session_id TEXT,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS turns_message
ON turns(message_id, started_at);

CREATE INDEX IF NOT EXISTS runtime_events_recent
ON runtime_events(created_at, severity, event_type);

CREATE INDEX IF NOT EXISTS runtime_events_agent
ON runtime_events(agent_id, created_at);

CREATE TABLE IF NOT EXISTS context_resets (
    agent_id TEXT PRIMARY KEY,
    cleared_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_pauses (
    agent_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS releases (
    content_hash TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    content TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_finalizations (
    task_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS release_finalizations_due
ON release_finalizations(next_attempt_at);

CREATE TABLE IF NOT EXISTS telemetry_events (
    event_key TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    category TEXT NOT NULL,
    code TEXT NOT NULL,
    severity TEXT NOT NULL,
    project TEXT NOT NULL,
    agent TEXT,
    task_id TEXT,
    session_id TEXT,
    duration_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_nano_aiu INTEGER,
    value REAL,
    detail TEXT,
    pointer TEXT
);

CREATE INDEX IF NOT EXISTS telemetry_events_window
ON telemetry_events(timestamp,category,code);

CREATE TABLE IF NOT EXISTS telemetry_findings (
    finding_id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    severity TEXT NOT NULL,
    scope TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS telemetry_findings_open
ON telemetry_findings(active,severity,last_seen_at);

CREATE TABLE IF NOT EXISTS published_task_releases (
    task_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    published_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id),
    FOREIGN KEY(content_hash) REFERENCES releases(content_hash)
);

CREATE TABLE IF NOT EXISTS producer_policy (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    retry_cooldown_seconds INTEGER NOT NULL
);

INSERT OR IGNORE INTO producer_policy(singleton,retry_cooldown_seconds)
VALUES(1,86400);

CREATE TABLE IF NOT EXISTS leadership_policy (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    max_delegations INTEGER NOT NULL
);

INSERT OR IGNORE INTO leadership_policy(singleton,max_delegations)
VALUES(1,3);

CREATE TABLE IF NOT EXISTS root_task_policy (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    max_active_tasks INTEGER NOT NULL,
    leader TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO root_task_policy(singleton,max_active_tasks)
VALUES(1,0);

CREATE TABLE IF NOT EXISTS worker_instance (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    owner TEXT NOT NULL,
    heartbeat TEXT NOT NULL
);
