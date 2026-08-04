use anyhow::Result;
use chrono::Utc;

use crate::{release_store::ReleaseFinalization, store::Store};

impl Store {
    pub(crate) async fn backfill_release_finalizations(&self) -> Result<()> {
        let tasks: Vec<(String, String)> = sqlx::query_as(
            "SELECT id,result FROM tasks
             WHERE status='completed' AND kind='root' AND source!='message'
             AND result IS NOT NULL AND trim(result)!=''
             AND NOT EXISTS(SELECT 1 FROM published_task_releases published
               WHERE published.task_id=tasks.id)
             AND NOT EXISTS(SELECT 1 FROM release_finalizations pending
               WHERE pending.task_id=tasks.id)",
        )
        .fetch_all(&self.pool)
        .await?;
        let now = Utc::now().to_rfc3339();
        for (task_id, content) in tasks {
            let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
            sqlx::query(
                "INSERT OR IGNORE INTO release_finalizations(
                 task_id,content_hash,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?)",
            )
            .bind(task_id)
            .bind(hash)
            .bind(&now)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub(crate) async fn due_release_finalizations(
        &self,
        limit: i64,
    ) -> Result<Vec<ReleaseFinalization>> {
        let rows: Vec<(String, String, String, String, String, u32)> = sqlx::query_as(
            "SELECT pending.task_id,pending.content_hash,tasks.assignee,tasks.topic,
             tasks.result,pending.attempts FROM release_finalizations pending
             JOIN tasks ON tasks.id=pending.task_id WHERE pending.next_attempt_at<=?
             ORDER BY pending.next_attempt_at,pending.created_at LIMIT ?",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(finalization).collect())
    }

    pub(crate) async fn schedule_release_finalizations_now(&self) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE release_finalizations SET next_attempt_at=?,updated_at=? WHERE next_attempt_at>?",
        )
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub(crate) async fn release_finalization(
        &self,
        task_id: &str,
    ) -> Result<Option<ReleaseFinalization>> {
        let row = sqlx::query_as(
            "SELECT pending.task_id,pending.content_hash,tasks.assignee,tasks.topic,
             tasks.result,pending.attempts FROM release_finalizations pending
             JOIN tasks ON tasks.id=pending.task_id WHERE pending.task_id=?",
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(finalization))
    }

    pub(crate) async fn record_release_finalization_failure(
        &self,
        task_id: &str,
        error: &str,
        next_attempt_at: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE release_finalizations SET attempts=attempts+1,last_error=?,
             next_attempt_at=?,updated_at=? WHERE task_id=?",
        )
        .bind(error)
        .bind(next_attempt_at)
        .bind(Utc::now().to_rfc3339())
        .bind(task_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub(crate) async fn acknowledge_release_finalization(
        &self,
        task_id: &str,
        content_hash: &str,
    ) -> Result<()> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        sqlx::query(
            "INSERT OR IGNORE INTO published_task_releases(task_id,content_hash,published_at)
             VALUES(?,?,?)",
        )
        .bind(task_id)
        .bind(content_hash)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM release_finalizations WHERE task_id=? AND content_hash=?")
            .bind(task_id)
            .bind(content_hash)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn release_matches(
        &self,
        hash: &str,
        content: &str,
        path: &str,
    ) -> Result<bool> {
        let row: Option<(String, String)> =
            sqlx::query_as("SELECT content,path FROM releases WHERE content_hash=?")
                .bind(hash)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.is_some_and(|row| row.0 == content && row.1 == path))
    }

    pub(crate) async fn pending_release_finalization_count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM release_finalizations")
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }
}

type FinalizationRow = (String, String, String, String, String, u32);

fn finalization(row: FinalizationRow) -> ReleaseFinalization {
    ReleaseFinalization {
        task_id: row.0,
        content_hash: row.1,
        agent: row.2,
        topic: row.3,
        content: row.4,
        attempts: row.5,
    }
}
