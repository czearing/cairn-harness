use anyhow::Result;
use chrono::Utc;

use crate::store::Store;

pub(crate) struct ReleaseFinalization {
    pub task_id: String,
    pub content_hash: String,
    pub agent: String,
    pub topic: String,
    pub content: String,
    pub attempts: u32,
}

impl Store {
    pub async fn add_release(
        &self,
        hash: &str,
        agent: &str,
        topic: &str,
        content: &str,
        path: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO releases(
             content_hash,agent_id,topic,content,path,created_at)
             VALUES(?,?,?,?,?,?)",
        )
        .bind(hash)
        .bind(agent)
        .bind(topic)
        .bind(content)
        .bind(path)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn release_count(&self) -> Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM releases")
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }

    pub async fn recent_release_topics(&self, limit: i64) -> Result<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT topic FROM releases GROUP BY topic
                 ORDER BY MAX(created_at) DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|row| row.0).collect())
    }
}
