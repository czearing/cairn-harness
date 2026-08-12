use anyhow::Result;
use serde_json::json;

use crate::store::Store;

impl Store {
    /// On-demand, read-only team status: every registered agent's current
    /// workload and any other active root tasks. Unlike `runtime_context`,
    /// this is not gated to the leader's root-task turn, so any agent can
    /// call it explicitly (via the `team_status` MCP tool) to check what the
    /// rest of the team is doing before deciding what to do next.
    pub async fn team_status(&self) -> Result<String> {
        let agents = self.team_snapshot().await?;
        let roots = self.active_roots_snapshot(None).await?;
        Ok(json!({
            "team": agents,
            "other_active_roots": roots
        })
        .to_string())
    }

    pub(crate) async fn team_snapshot(&self) -> Result<Vec<serde_json::Value>> {
        let agents: Vec<(String, String, Option<String>, i64, i64)> = sqlx::query_as(
            "SELECT agent.agent_id,agent.status,agent.current_topic,
               (SELECT COUNT(*) FROM tasks task
                WHERE task.assignee=agent.agent_id AND task.status='pending'),
               (SELECT COUNT(*) FROM tasks task
                WHERE task.assignee=agent.agent_id AND task.status='buffered')
             FROM agents agent ORDER BY agent.agent_id",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(agents
            .into_iter()
            .map(|(id, status, topic, pending, buffered)| {
                json!({
                    "id": id,
                    "status": status,
                    "current_topic": topic,
                    "pending": pending,
                    "buffered": buffered
                })
            })
            .collect())
    }

    pub(crate) async fn active_roots_snapshot(
        &self,
        exclude_id: Option<&str>,
    ) -> Result<Vec<serde_json::Value>> {
        let roots: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT id,status,body FROM tasks
             WHERE kind='root' AND parent_id IS NULL AND id<>?
             AND status IN ('pending','claimed','waiting','deferred','backlog')
             ORDER BY created_at LIMIT 12",
        )
        .bind(exclude_id.unwrap_or(""))
        .fetch_all(&self.pool)
        .await?;
        Ok(roots
            .into_iter()
            .map(|(id, status, body)| {
                json!({ "id": id, "status": status, "body": truncate(&body, 240) })
            })
            .collect())
    }
}

fn truncate(value: &str, limit: usize) -> String {
    let mut output: String = value.chars().take(limit).collect();
    if value.chars().count() > limit {
        output.push_str("...");
    }
    output
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::models::WorkerSpec;

    #[tokio::test]
    async fn team_status_reports_every_agent_and_active_roots_on_demand() {
        let root = tempdir().unwrap();
        let store = Store::open(&root.path().join("harness.db")).await.unwrap();
        for agent in ["lead", "worker"] {
            store
                .register(&WorkerSpec {
                    id: agent.into(),
                    role: agent.into(),
                    description: format!("{agent} agent"),
                    prompt: "Work.".into(),
                    model: "gpt-5.4-mini".into(),
                    leader: "lead".into(),
                    leader_task_limit: 3,
                    idea_agents: Vec::new(),
                    delegate_agents: Vec::new(),
                })
                .await
                .unwrap();
        }
        store
            .create_root("dashboard", "lead", "work-item", "Active work", "manual", None)
            .await
            .unwrap();
        store
            .set_state("worker", "working", Some("implementation"))
            .await
            .unwrap();

        let status: serde_json::Value =
            serde_json::from_str(&store.team_status().await.unwrap()).unwrap();

        assert!(status["team"].as_array().unwrap().iter().any(|agent| {
            agent["id"] == "worker"
                && agent["status"] == "working"
                && agent["current_topic"] == "implementation"
        }));
        assert!(
            status["other_active_roots"]
                .as_array()
                .unwrap()
                .iter()
                .any(|task| task["body"] == "Active work")
        );
    }
}
