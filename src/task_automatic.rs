use anyhow::{Result, bail};
use chrono::{DateTime, Utc};

use crate::{producer_store::automatic_retry_cutoff_at, store::Store, task_query::keyed_id};

impl Store {
    pub(crate) async fn create_automatic_root_once(
        &self,
        creator: &str,
        assignee: &str,
        topic: &str,
        body: &str,
        origin: &str,
        buffered: bool,
    ) -> Result<String> {
        self.create_automatic_root_once_at(
            creator,
            assignee,
            topic,
            body,
            origin,
            buffered,
            Utc::now(),
        )
        .await
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn create_automatic_root_once_at(
        &self,
        creator: &str,
        assignee: &str,
        topic: &str,
        body: &str,
        origin: &str,
        buffered: bool,
        now: DateTime<Utc>,
    ) -> Result<String> {
        let id = keyed_id(origin, assignee, topic, body);
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let (existing,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM tasks WHERE origin_id=? AND kind='root'")
                .bind(origin)
                .fetch_one(&mut *transaction)
                .await?;
        if existing > 0 {
            transaction.rollback().await?;
            bail!("automatic generator already created its root task");
        }
        let cutoff = automatic_retry_cutoff_at(&mut *transaction, now).await?;
        let equivalent: Option<(String, String)> = sqlx::query_as(
            "SELECT source,status FROM tasks
             WHERE kind='root' AND topic=? AND body=?
             AND (
               status IN ('pending','claimed','waiting','deferred','buffered','backlog')
               OR (source='automatic' AND status IN ('failed','cancelled') AND completed_at>?)
             )
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(topic)
        .bind(body)
        .bind(cutoff)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some((source, status)) = equivalent {
            transaction.rollback().await?;
            if source == "automatic" && matches!(status.as_str(), "failed" | "cancelled") {
                bail!("equivalent automatic task is in retry cooldown after {status}");
            }
            bail!("equivalent task is already active");
        }
        let status = if buffered { "buffered" } else { "pending" };
        sqlx::query(
            "INSERT INTO tasks(
             id,parent_id,origin_id,kind,source,creator,assignee,topic,body,status,created_at)
             VALUES(?,NULL,?,'root','automatic',?,?,?,?,?,?)",
        )
        .bind(&id)
        .bind(origin)
        .bind(creator)
        .bind(assignee)
        .bind(topic)
        .bind(body)
        .bind(status)
        .bind(now.to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(id)
    }
}
