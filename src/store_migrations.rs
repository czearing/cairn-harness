use anyhow::Result;
use sqlx::SqlitePool;

pub(crate) async fn migrate(pool: &SqlitePool) -> Result<()> {
    migrate_column(
        pool,
        "root_task_policy",
        "leader",
        "TEXT NOT NULL DEFAULT ''",
    )
    .await?;
    migrate_column(pool, "agents", "runtime_id", "TEXT NOT NULL DEFAULT ''").await?;
    migrate_column(
        pool,
        "tasks",
        "claim_generation",
        "INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    migrate_telemetry(pool).await?;
    migrate_legacy(pool).await
}

async fn migrate_telemetry(pool: &SqlitePool) -> Result<()> {
    let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as("PRAGMA table_info(telemetry_events)")
            .fetch_all(pool)
            .await?;
    if columns.iter().any(|item| item.1 == "occurred_at") {
        sqlx::raw_sql(
            "DROP TABLE telemetry_events;
             DROP TABLE telemetry_findings;
             CREATE TABLE telemetry_events(
               event_key TEXT PRIMARY KEY,timestamp TEXT NOT NULL,source TEXT NOT NULL,
               category TEXT NOT NULL,code TEXT NOT NULL,severity TEXT NOT NULL,
               project TEXT NOT NULL,agent TEXT,task_id TEXT,session_id TEXT,
               duration_ms INTEGER,input_tokens INTEGER,output_tokens INTEGER,
               cost_nano_aiu INTEGER,value REAL,detail TEXT,pointer TEXT);
             CREATE INDEX telemetry_events_window
               ON telemetry_events(timestamp,category,code);
             CREATE TABLE telemetry_findings(
               finding_id TEXT PRIMARY KEY,code TEXT NOT NULL,severity TEXT NOT NULL,
               scope TEXT NOT NULL,summary TEXT NOT NULL,evidence TEXT NOT NULL,
               occurrence_count INTEGER NOT NULL DEFAULT 1,started_at TEXT NOT NULL,
               last_seen_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,resolved_at TEXT);
             CREATE INDEX telemetry_findings_open
               ON telemetry_findings(active,severity,last_seen_at);",
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn migrate_column(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<()> {
    let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as(sqlx::AssertSqlSafe(format!("PRAGMA table_info({table})")))
            .fetch_all(pool)
            .await?;
    if !columns.iter().any(|item| item.1 == column) {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        )))
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn migrate_legacy(pool: &SqlitePool) -> Result<()> {
    let (messages,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='messages'")
            .fetch_one(pool)
            .await?;
    if messages == 0 {
        return Ok(());
    }
    let (work_items,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='work_items'",
    )
    .fetch_one(pool)
    .await?;
    if work_items > 0 {
        sqlx::raw_sql(
            "INSERT OR IGNORE INTO tasks(
             id,parent_id,origin_id,kind,source,creator,assignee,topic,body,result,
             status,attempts,error,created_at,claimed_at,completed_at)
             SELECT m.id,NULL,NULL,'root','import',m.sender,m.recipient,m.topic,m.body,NULL,
             CASE WHEN w.status='done' OR m.status='completed' THEN 'completed' ELSE m.status END,
             m.attempts,m.error,m.created_at,m.claimed_at,m.completed_at
             FROM work_items w JOIN messages m ON m.id=w.message_id;
             INSERT OR IGNORE INTO tasks(
             id,parent_id,origin_id,kind,source,creator,assignee,topic,body,result,
             status,attempts,error,created_at,claimed_at,completed_at)
             SELECT m.id,
             (SELECT w.message_id FROM work_items w WHERE m.id LIKE w.message_id || ':%'
              ORDER BY length(w.message_id) DESC LIMIT 1),
             NULL,CASE WHEN m.topic IN ('create-work-item','create-idea') THEN 'generator'
             WHEN m.sender IN ('dashboard','human') THEN 'message' ELSE 'delegation' END,
             'import',m.sender,m.recipient,m.topic,m.body,NULL,m.status,m.attempts,m.error,
             m.created_at,m.claimed_at,m.completed_at FROM messages m;",
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "INSERT OR IGNORE INTO tasks(
             id,kind,source,creator,assignee,topic,body,status,attempts,error,
             created_at,claimed_at,completed_at)
             SELECT id,'message','import',sender,recipient,topic,body,status,attempts,error,
             created_at,claimed_at,completed_at FROM messages",
        )
        .execute(pool)
        .await?;
    }
    sqlx::raw_sql(
        "DROP TABLE IF EXISTS todo_files;
         DROP TABLE IF EXISTS work_items;
         DROP TABLE IF EXISTS messages;",
    )
    .execute(pool)
    .await?;
    Ok(())
}
