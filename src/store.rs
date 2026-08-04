use crate::models::{AgentState, WorkerSpec};
use anyhow::Result;
use chrono::Utc;
use sqlx::SqlitePool;
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use uuid::Uuid;

#[derive(Clone)]
pub struct Store {
    pub(crate) pool: SqlitePool,
    publication_enabled: Arc<AtomicBool>,
}

impl Store {
    pub async fn open(path: &Path) -> Result<Self> {
        let pool = crate::store_open::open_pool(path).await?;
        Ok(Self {
            pool,
            publication_enabled: Arc::new(AtomicBool::new(false)),
        })
    }

    pub(crate) fn set_publication_enabled(&self, enabled: bool) {
        self.publication_enabled.store(enabled, Ordering::SeqCst);
    }

    pub(crate) fn publication_enabled(&self) -> bool {
        self.publication_enabled.load(Ordering::SeqCst)
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

    pub async fn set_runtime(&self, agent: &str, runtime_id: &str) -> Result<()> {
        sqlx::query("UPDATE agents SET runtime_id=? WHERE agent_id=?")
            .bind(runtime_id)
            .bind(agent)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn clear_runtime_if(&self, agent: &str, runtime_id: &str) -> Result<()> {
        sqlx::query("UPDATE agents SET runtime_id='' WHERE agent_id=? AND runtime_id=?")
            .bind(agent)
            .bind(runtime_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn runtime_is_current(&self, agent: &str, runtime_id: &str) -> Result<bool> {
        let (current,): (bool,) =
            sqlx::query_as("SELECT EXISTS(SELECT 1 FROM agents WHERE agent_id=? AND runtime_id=?)")
                .bind(agent)
                .bind(runtime_id)
                .fetch_one(&self.pool)
                .await?;
        Ok(current)
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

    pub async fn clear_session_if(&self, id: &str, session_id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE agents SET session_id='',updated_at=? WHERE agent_id=? AND session_id=?",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .bind(session_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn record_runtime_event(
        &self,
        event_type: &str,
        severity: &str,
        agent_id: Option<&str>,
        task_id: Option<&str>,
        session_id: Option<&str>,
        detail: &str,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO runtime_events(
                event_type,severity,agent_id,task_id,session_id,detail,created_at
             ) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(event_type)
        .bind(severity)
        .bind(agent_id)
        .bind(task_id)
        .bind(session_id)
        .bind(detail)
        .bind(Utc::now().to_rfc3339())
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
