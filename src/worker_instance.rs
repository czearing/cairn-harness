use anyhow::Result;
use chrono::{Duration as ChronoDuration, Utc};

use crate::store::Store;

/// Identifies one watcher process for the lifetime of that process.
pub fn instance_owner() -> String {
    format!("{}:{}", hostname(), std::process::id())
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "local".to_string())
}

impl Store {
    /// Takes the exclusive watcher slot for this database.
    ///
    /// Only one watcher may run claim and recovery loops against a harness
    /// database. A second process would race the first: its recovery sweep
    /// requeues the first process's live claims, which then lets either
    /// process dispatch a second task into an agent that is still working.
    pub async fn acquire_worker_instance(&self, owner: &str, lease_ms: u64) -> Result<bool> {
        let now = Utc::now();
        let stale_before = (now - ChronoDuration::milliseconds(lease_ms as i64)).to_rfc3339();
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let current: Option<(String, String)> =
            sqlx::query_as("SELECT owner,heartbeat FROM worker_instance WHERE singleton=1")
                .fetch_optional(&mut *transaction)
                .await?;
        if let Some((existing, heartbeat)) = current
            && existing != owner
            && heartbeat.as_str() >= stale_before.as_str()
        {
            transaction.rollback().await?;
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO worker_instance(singleton,owner,heartbeat) VALUES(1,?,?)
             ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner,heartbeat=excluded.heartbeat",
        )
        .bind(owner)
        .bind(now.to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(true)
    }

    /// Keeps this process's claim on the watcher slot alive.
    /// Returns false when another process has taken the slot over.
    pub async fn renew_worker_instance(&self, owner: &str) -> Result<bool> {
        let updated = sqlx::query(
            "UPDATE worker_instance SET heartbeat=? WHERE singleton=1 AND owner=?",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(owner)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(updated == 1)
    }

    /// Frees the watcher slot on a clean shutdown so a restart need not wait
    /// for the lease to expire.
    pub async fn release_worker_instance(&self, owner: &str) -> Result<()> {
        sqlx::query("DELETE FROM worker_instance WHERE singleton=1 AND owner=?")
            .bind(owner)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "worker_instance_tests.rs"]
mod tests;
