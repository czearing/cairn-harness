use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

use crate::{models::Message, store::Store};

impl Store {
    pub async fn enqueue(&self, from: &str, to: &str, topic: &str, body: &str) -> Result<()> {
        self.enqueue_keyed(&Uuid::new_v4().to_string(), from, to, topic, body)
            .await
    }

    pub async fn enqueue_keyed(
        &self,
        id: &str,
        from: &str,
        to: &str,
        topic: &str,
        body: &str,
    ) -> Result<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO messages(id,sender,recipient,topic,body,status,created_at)
             VALUES(?,?,?,?,?,'pending',?)",
        )
        .bind(id)
        .bind(from)
        .bind(to)
        .bind(topic)
        .bind(body)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn claim(&self, agent: &str) -> Result<Option<Message>> {
        let row: Option<(String, String, String, String, String, u32)> = sqlx::query_as(
            "UPDATE messages SET status='claimed',claimed_at=?,attempts=attempts+1,error=NULL
             WHERE id=(SELECT id FROM messages WHERE recipient=? AND status='pending'
             ORDER BY CASE WHEN sender IN ('dashboard','human') THEN 0 ELSE 1 END, created_at LIMIT 1)
             RETURNING id,sender,recipient,topic,body,attempts",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(agent)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| Message {
            id: r.0,
            sender: r.1,
            recipient: r.2,
            topic: r.3,
            body: r.4,
            attempts: r.5,
        }))
    }

    pub async fn renew_claim(&self, id: &str, agent: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE messages SET claimed_at=? WHERE id=? AND status='claimed'")
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        sqlx::query("UPDATE agents SET updated_at=? WHERE agent_id=?")
            .bind(now)
            .bind(agent)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn finish(&self, id: &str, status: &str, error: Option<&str>) -> Result<()> {
        sqlx::query("UPDATE messages SET status=?,error=?,completed_at=? WHERE id=?")
            .bind(status)
            .bind(error)
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn is_cancelled(&self, id: &str) -> Result<bool> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM messages WHERE id=? AND status='cancelled'")
                .bind(id)
                .fetch_one(&self.pool)
                .await?;
        Ok(count > 0)
    }

    pub async fn retry(&self, id: &str, error: &str) -> Result<()> {
        sqlx::query("UPDATE messages SET status='pending',claimed_at=NULL,error=? WHERE id=?")
            .bind(error)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn recover(&self, before: &str) -> Result<u64> {
        let result = sqlx::query(
            "UPDATE messages SET status='pending',claimed_at=NULL
             WHERE status='claimed' AND claimed_at < ?",
        )
        .bind(before)
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE agents SET status='idle',current_topic=NULL
             WHERE status='working' AND updated_at < ?",
        )
        .bind(before)
        .execute(&self.pool)
        .await?;
        sqlx::query("UPDATE messages SET status='pending' WHERE status='deferred'")
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn dead_letter(
        &self,
        sender: &str,
        target: &str,
        topic: &str,
        body: &str,
        error: &str,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO dead_letters(id,sender,target,topic,body,error,created_at)
             VALUES(?,?,?,?,?,?,?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(sender)
        .bind(target)
        .bind(topic)
        .bind(body)
        .bind(error)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn message_count(&self, status: &str) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages WHERE status=?")
            .bind(status)
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }

    pub async fn open_message_count(&self) -> Result<i64> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM messages WHERE status IN ('pending','claimed')")
                .fetch_one(&self.pool)
                .await?;
        Ok(count)
    }

    pub async fn completed_message_count(&self) -> Result<i64> {
        self.message_count("completed").await
    }

    pub async fn dead_letter_count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM dead_letters")
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn claims_direct_user_messages_before_internal_backlog() {
        let root = tempdir().unwrap();
        let store = Store::open(&root.path().join("harness.db")).await.unwrap();
        store
            .enqueue("ui-lead", "reviewer", "review", "older internal work")
            .await
            .unwrap();
        store
            .enqueue("dashboard", "reviewer", "dashboard-message", "user request")
            .await
            .unwrap();

        let message = store.claim("reviewer").await.unwrap().unwrap();

        assert_eq!(message.sender, "dashboard");
        assert_eq!(message.body, "user request");
    }

    #[tokio::test]
    async fn reports_cancelled_claims_for_late_output_suppression() {
        let root = tempdir().unwrap();
        let store = Store::open(&root.path().join("harness.db")).await.unwrap();
        store
            .enqueue_keyed("task:child", "lead", "builder", "work", "build")
            .await
            .unwrap();
        sqlx::query("UPDATE messages SET status='cancelled' WHERE id='task:child'")
            .execute(&store.pool)
            .await
            .unwrap();

        assert!(store.is_cancelled("task:child").await.unwrap());
    }
}
