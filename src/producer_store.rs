use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};

use crate::store::Store;

impl Store {
    pub async fn set_producer_retry_cooldown(&self, seconds: u64) -> Result<()> {
        let seconds = seconds.min(i64::MAX as u64) as i64;
        let (persisted,): (i64,) =
            sqlx::query_as("SELECT retry_cooldown_seconds FROM producer_policy WHERE singleton=1")
                .fetch_one(&self.pool)
                .await?;
        if persisted == seconds {
            return Ok(());
        }
        sqlx::query("UPDATE producer_policy SET retry_cooldown_seconds=? WHERE singleton=1")
            .bind(seconds)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn buffered_automatic_root_count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             WHERE kind='root' AND source='automatic' AND status='buffered'",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    pub async fn automatic_root_count_for(&self, producer: &str) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             WHERE kind='root' AND source='automatic' AND creator=?
             AND status IN ('pending','claimed','waiting','deferred','buffered','backlog')",
        )
        .bind(producer)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    pub async fn pending_generator_count_for(&self, producer: &str) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             WHERE kind='generator' AND assignee=? AND status IN ('pending','claimed')",
        )
        .bind(producer)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    pub async fn automatic_root_topics(&self) -> Result<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT topic FROM tasks
             WHERE kind='root' AND source='automatic'
             AND status IN ('pending','claimed','waiting','deferred','buffered','backlog')
             ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|row| row.0).collect())
    }

    pub async fn recent_terminal_automatic_topics(&self, limit: i64) -> Result<Vec<String>> {
        let cutoff = automatic_retry_cutoff(&self.pool).await?;
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT status,topic FROM tasks
             WHERE kind='root' AND source='automatic'
             AND status IN ('failed','cancelled') AND completed_at>=?
             ORDER BY completed_at DESC LIMIT ?",
        )
        .bind(cutoff)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(status, topic)| format!("{status}: {topic}"))
            .collect())
    }

    pub async fn promote_buffered_automatic_roots(&self, limit: i64) -> Result<i64> {
        let (active, buffered): (i64, i64) = sqlx::query_as(
            "SELECT
               COUNT(*) FILTER (
                 WHERE kind='root' AND source='automatic'
                 AND status IN ('pending','claimed','waiting','deferred')
               ),
               COUNT(*) FILTER (
                 WHERE kind='root' AND source='automatic' AND status='buffered'
               )
             FROM tasks",
        )
        .fetch_one(&self.pool)
        .await?;
        if active >= limit || buffered == 0 {
            return Ok(0);
        }
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let (active,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             WHERE kind='root' AND source='automatic'
             AND status IN ('pending','claimed','waiting','deferred')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        let missing = (limit - active).max(0);
        let promoted = sqlx::query(
            "UPDATE tasks SET status='pending'
             WHERE id IN (
               SELECT id FROM tasks
               WHERE kind='root' AND source='automatic' AND status='buffered'
               ORDER BY created_at LIMIT ?
             )",
        )
        .bind(missing)
        .execute(&mut *transaction)
        .await?
        .rows_affected() as i64;
        transaction.commit().await?;
        Ok(promoted)
    }
}

pub(crate) async fn automatic_retry_cutoff<'e, E>(executor: E) -> Result<String>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    automatic_retry_cutoff_at(executor, Utc::now()).await
}

pub(crate) async fn automatic_retry_cutoff_at<'e, E>(
    executor: E,
    now: DateTime<Utc>,
) -> Result<String>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let (seconds,): (i64,) =
        sqlx::query_as("SELECT retry_cooldown_seconds FROM producer_policy WHERE singleton=1")
            .fetch_one(executor)
            .await?;
    let cooldown =
        Duration::try_seconds(seconds).context("producer retry cooldown is too large")?;
    Ok((now - cooldown).to_rfc3339())
}
