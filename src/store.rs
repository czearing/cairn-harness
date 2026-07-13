use std::{path::Path, time::Duration};

use anyhow::Result;
use chrono::Utc;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use uuid::Uuid;

use crate::models::{AgentState, WorkerSpec};

#[derive(Clone)]
pub struct Store {
    pub(crate) pool: SqlitePool,
}

impl Store {
    pub async fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(options)
            .await?;
        sqlx::raw_sql(include_str!("../schema.sql"))
            .execute(&pool)
            .await?;
        Ok(Self { pool })
    }

    pub async fn register(&self, worker: &WorkerSpec) -> Result<AgentState> {
        let session = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO agents(agent_id,role,session_id,status,updated_at)
             VALUES(?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET role=excluded.role",
        )
        .bind(&worker.id)
        .bind(&worker.role)
        .bind(session)
        .bind("idle")
        .bind(now)
        .execute(&self.pool)
        .await?;
        self.agent(&worker.id).await
    }

    pub async fn agent(&self, id: &str) -> Result<AgentState> {
        let row: (String, String, String, String, Option<String>, String) = sqlx::query_as(
            "SELECT agent_id,role,session_id,status,current_topic,updated_at
                 FROM agents WHERE agent_id=?",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(state(row))
    }

    pub async fn states(&self) -> Result<Vec<AgentState>> {
        let rows = sqlx::query_as(
            "SELECT agent_id,role,session_id,status,current_topic,updated_at
             FROM agents ORDER BY agent_id",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(state).collect())
    }

    pub async fn set_state(&self, id: &str, status: &str, topic: Option<&str>) -> Result<()> {
        sqlx::query("UPDATE agents SET status=?,current_topic=?,updated_at=? WHERE agent_id=?")
            .bind(status)
            .bind(topic)
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_session(&self, id: &str, session_id: &str) -> Result<()> {
        sqlx::query("UPDATE agents SET session_id=?,updated_at=? WHERE agent_id=?")
            .bind(session_id)
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

fn state(row: (String, String, String, String, Option<String>, String)) -> AgentState {
    AgentState {
        agent_id: row.0,
        role: row.1,
        session_id: row.2,
        status: row.3,
        current_topic: row.4,
        updated_at: row.5,
    }
}
