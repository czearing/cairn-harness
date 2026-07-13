use anyhow::Result;

use crate::orchestrator::Harness;

impl Harness {
    pub async fn replenish(&self) -> Result<bool> {
        let Some(producer) = &self.config.producer else {
            return Ok(false);
        };
        if self.store.open_message_count().await? != 0 {
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
        self.store
            .enqueue("harness", producer, "create-idea", &body)
            .await?;
        Ok(true)
    }
}
