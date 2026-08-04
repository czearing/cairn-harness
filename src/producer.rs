use anyhow::Result;

use crate::orchestrator::Harness;

impl Harness {
    pub async fn replenish(&self) -> Result<bool> {
        let idea_agents = self.config.idea_agents();
        if idea_agents.is_empty() {
            return Ok(false);
        }
        self.store
            .set_producer_retry_cooldown(self.config.producer_retry_cooldown_seconds)
            .await?;
        let mut history = self.store.recent_release_topics(8).await?;
        for topic in self.store.automatic_root_topics().await? {
            if !history.contains(&topic) {
                history.push(topic);
            }
        }
        let terminal = self.store.recent_terminal_automatic_topics(4).await?;
        let mut created = false;
        for idea in idea_agents {
            if self.store.automatic_root_count_for(&idea.agent).await? >= idea.task_limit as i64
                || self.store.pending_generator_count_for(&idea.agent).await? > 0
            {
                continue;
            }
            let body = producer_body(&idea.prompt, &history, &terminal);
            self.store.create_generator(&idea.agent, &body).await?;
            created = true;
        }

        fn producer_body(instruction: &str, history: &[String], terminal: &[String]) -> String {
            let existing = history
                .iter()
                .take(4)
                .map(|topic| topic.chars().take(48).collect::<String>())
                .collect::<Vec<_>>();
            let mut body = instruction.to_string();
            if !existing.is_empty() {
                body.push_str(&format!("\nExisting topics: {}", existing.join("; ")));
            }
            if !terminal.is_empty() {
                let terminal = terminal
                    .iter()
                    .map(|outcome| outcome.chars().take(64).collect::<String>())
                    .collect::<Vec<_>>();
                body.push_str(&format!(
                    "\nRecent terminal automatic topics (do not retry yet): {}",
                    terminal.join("; ")
                ));
            }
            body
        }
        Ok(created)
    }
}

#[cfg(test)]
#[path = "producer_tests.rs"]
mod tests;
