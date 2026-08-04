use anyhow::Result;

use crate::store::Store;

impl Store {
    pub async fn task_count(&self, status: &str) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tasks WHERE status=?")
            .bind(status)
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }

    pub async fn open_task_count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             WHERE status IN ('pending','claimed','waiting','deferred','buffered','backlog')",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    pub async fn automatic_seed_count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             WHERE kind='root' AND source='automatic'
             AND status IN ('pending','claimed','waiting','deferred','backlog')",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    pub async fn pending_generator_count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks
             WHERE kind='generator' AND status IN ('pending','claimed')",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    pub async fn completed_task_count(&self) -> Result<i64> {
        self.task_count("completed").await
    }
}
