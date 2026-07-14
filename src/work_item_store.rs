use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

use crate::store::Store;

impl Store {
    pub async fn add_work_item(
        &self,
        path: &str,
        hash: &str,
        leader: &str,
        body: &str,
    ) -> Result<bool> {
        let id = Uuid::new_v4().to_string();
        let message_id = format!("work-item:{hash}");
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool.begin().await?;
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO work_items(
             id,path,content_hash,message_id,status,created_at)
             VALUES(?,?,?,?,'in-progress',?)",
        )
        .bind(&id)
        .bind(path)
        .bind(hash)
        .bind(&message_id)
        .bind(&now)
        .execute(&mut *transaction)
        .await?
        .rows_affected()
            == 1;
        if inserted {
            sqlx::query(
                "INSERT OR IGNORE INTO messages(
                 id,sender,recipient,topic,body,status,created_at)
                 VALUES(?, 'work-items', ?, 'work-item', ?, 'pending', ?)",
            )
            .bind(&message_id)
            .bind(leader)
            .bind(body)
            .bind(now)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(inserted)
    }

    pub async fn open_work_count(&self) -> Result<i64> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM work_items WHERE status='in-progress'")
                .fetch_one(&self.pool)
                .await?;
        Ok(count)
    }

    pub async fn complete_work(&self, message_id: &str) -> Result<Option<String>> {
        let row: Option<(String, String)> = sqlx::query_as(
            "UPDATE work_items SET status='done',completed_at=?
             WHERE id=(SELECT id FROM work_items
             WHERE status='in-progress' AND (?=message_id OR ? LIKE message_id || ':%')
             ORDER BY length(message_id) DESC LIMIT 1) RETURNING id,path",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(message_id)
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|value| value.1))
    }

    pub async fn set_work_path(&self, message_id: &str, path: &str) -> Result<()> {
        sqlx::query("UPDATE work_items SET path=? WHERE message_id=?")
            .bind(path)
            .bind(message_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
