use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

use crate::store::Store;

impl Store {
    pub async fn ingest_todo(
        &self,
        path: &str,
        content_hash: &str,
        recipient: &str,
        topic: &str,
        body: &str,
    ) -> Result<bool> {
        let existing: Option<(String,)> =
            sqlx::query_as("SELECT content_hash FROM todo_files WHERE path=?")
                .bind(path)
                .fetch_optional(&self.pool)
                .await?;
        if existing.is_some_and(|row| row.0 == content_hash) {
            return Ok(false);
        }
        let mut transaction = self.pool.begin().await?;
        let message_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO messages(id,sender,recipient,topic,body,status,created_at)
             VALUES(?, 'todo-folder', ?, ?, ?, 'pending', ?)",
        )
        .bind(&message_id)
        .bind(recipient)
        .bind(topic)
        .bind(body)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO todo_files(path,content_hash,message_id,ingested_at)
             VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET
             content_hash=excluded.content_hash,message_id=excluded.message_id,
             ingested_at=excluded.ingested_at",
        )
        .bind(path)
        .bind(content_hash)
        .bind(message_id)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn ingested_todo_count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM todo_files")
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }
}
