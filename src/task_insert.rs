use chrono::Utc;
use uuid::Uuid;

use crate::{store::Store, task_policy::MANUAL_LEADER_WORK_ITEM_ROOT, task_query::keyed_id};
use anyhow::Result;

impl Store {
    pub async fn create_root(
        &self,
        creator: &str,
        assignee: &str,
        topic: &str,
        body: &str,
        source: &str,
        origin: Option<&str>,
    ) -> Result<String> {
        let id = origin
            .map(|value| keyed_id(value, assignee, topic, body))
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        self.insert_task(
            &id, None, origin, "root", source, creator, assignee, topic, body,
        )
        .await?;
        Ok(id)
    }

    pub async fn create_message(
        &self,
        creator: &str,
        assignee: &str,
        topic: &str,
        body: &str,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        self.insert_task(
            &id, None, None, "root", "manual", creator, assignee, topic, body,
        )
        .await?;
        Ok(id)
    }

    pub async fn create_generator(&self, assignee: &str, body: &str) -> Result<String> {
        self.insert_generator(assignee, body, "automatic").await
    }

    pub async fn create_buffer_generator(&self, assignee: &str, body: &str) -> Result<String> {
        self.insert_generator(assignee, body, "automatic-buffer")
            .await
    }

    async fn insert_generator(&self, assignee: &str, body: &str, source: &str) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        self.insert_task(
            &id,
            None,
            None,
            "generator",
            source,
            "harness",
            assignee,
            "create-work-item",
            body,
        )
        .await?;
        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn insert_task(
        &self,
        id: &str,
        parent: Option<&str>,
        origin: Option<&str>,
        kind: &str,
        source: &str,
        creator: &str,
        assignee: &str,
        topic: &str,
        body: &str,
    ) -> Result<()> {
        let (leader,): (String,) =
            sqlx::query_as("SELECT leader FROM root_task_policy WHERE singleton=1")
                .fetch_one(&self.pool)
                .await?;
        if kind != "root"
            || source != "manual"
            || parent.is_some()
            || topic != "work-item"
            || assignee != leader
        {
            sqlx::query(
                "INSERT OR IGNORE INTO tasks(
                 id,parent_id,origin_id,kind,source,creator,assignee,topic,body,status,created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,'pending',?)",
            )
            .bind(id)
            .bind(parent)
            .bind(origin)
            .bind(kind)
            .bind(source)
            .bind(creator)
            .bind(assignee)
            .bind(topic)
            .bind(body)
            .bind(Utc::now().to_rfc3339())
            .execute(&self.pool)
            .await?;
            return Ok(());
        }
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let (limit, active): (i64, i64) = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT root_task_policy.max_active_tasks,
               (SELECT COUNT(*) FROM tasks WHERE {MANUAL_LEADER_WORK_ITEM_ROOT}
                AND status IN ('pending','claimed','waiting','deferred'))
             FROM root_task_policy WHERE singleton=1"
        )))
        .fetch_one(&mut *transaction)
        .await?;
        let status = if limit > 0 && active >= limit {
            "backlog"
        } else {
            "pending"
        };
        sqlx::query(
            "INSERT OR IGNORE INTO tasks(
             id,parent_id,origin_id,kind,source,creator,assignee,topic,body,status,created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(id)
        .bind(parent)
        .bind(origin)
        .bind(kind)
        .bind(source)
        .bind(creator)
        .bind(assignee)
        .bind(topic)
        .bind(body)
        .bind(status)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }
}
