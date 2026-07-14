use anyhow::Result;

use crate::orchestrator::Harness;

impl Harness {
    pub async fn replenish(&self) -> Result<bool> {
        let Some(producer) = &self.config.producer else {
            return Ok(false);
        };
        if let Some(limit) = self.config.producer_limit
            && self.store.automatic_seed_count().await? >= limit as i64
        {
            return Ok(false);
        }
        if self.store.open_message_count().await? != 0 || self.store.open_work_count().await? != 0 {
            return Ok(false);
        }
        let history = self.store.recent_releases(8).await?;
        let body = if history.is_empty() {
            "Create the first unique idea.".into()
        } else {
            format!(
                "Create a new idea unlike these releases:\n\n{}",
                history.join("\n\n")
            )
        };
        let topic = if self.config.work_path().is_some() {
            "create-work-item"
        } else {
            "create-idea"
        };
        self.store
            .enqueue("harness", producer, topic, &body)
            .await?;
        Ok(true)
    }
}
