use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::{
    config::{IdeaAgentConfig, ProjectConfig},
    models::WorkerSpec,
};

impl ProjectConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let text = fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let mut config: Self = serde_json::from_str(&text)?;
        config.migrate_legacy_model();
        let base = path.parent().unwrap_or_else(|| Path::new("."));
        config.paused = base.join(".cairn-paused").exists();
        if config.root.is_relative() {
            config.root = base.join(&config.root);
        }

        config.root = config
            .root
            .canonicalize()
            .with_context(|| format!("project root does not exist: {}", config.root.display()))?;
        config.validate()?;
        Ok(config)
    }

    pub fn workers(&self) -> Vec<WorkerSpec> {
        let default_model = Self::global_default_model();
        self.roles
            .iter()
            .map(|role| WorkerSpec {
                id: role.name.clone(),
                role: role.name.clone(),
                description: role.description.clone(),
                prompt: role.prompt.clone(),
                model: resolve_model(role.model.as_deref(), &default_model),
                leader: self.leader().to_string(),
                leader_task_limit: self.leader_task_limit.unwrap_or(3),
                idea_agents: self
                    .idea_agents()
                    .into_iter()
                    .map(|idea| idea.agent)
                    .collect(),
                delegate_agents: self.delegate_agents.clone(),
            })
            .collect()
    }

    fn migrate_legacy_model(&mut self) {
        let Some(model) = self.copilot.model.take() else {
            return;
        };
        for role in &mut self.roles {
            if role.model.is_none() {
                role.model = Some(model.clone());
            }
        }
    }

    pub fn leader(&self) -> &str {
        self.leader
            .as_deref()
            .or_else(|| self.roles.first().map(|role| role.name.as_str()))
            .unwrap_or("")
    }

    fn global_default_model() -> String {
        let Some(path) = std::env::var_os("HARNESS_GLOBAL_SETTINGS") else {
            return "gpt-5.4-mini".into();
        };
        let path = PathBuf::from(path);
        let Ok(text) = std::fs::read_to_string(&path) else {
            return "gpt-5.4-mini".into();
        };
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct GlobalSettings {
            default_model: String,
        }
        let model = serde_json::from_str::<GlobalSettings>(&text)
            .ok()
            .map(|settings| settings.default_model)
            .filter(|model| !model.trim().is_empty());
        if let Some(model) = model {
            return model;
        }
        tracing::error!(
            path = %path.display(),
            "global model settings are invalid; using the built-in default"
        );
        "gpt-5.4-mini".into()
    }

    /// Idea agents with their prompts resolved from the matching role, so an
    /// agent's prompt has a single source of truth and a stale stored copy can
    /// never be executed.
    pub fn idea_agents(&self) -> Vec<IdeaAgentConfig> {
        let mut agents = if self.idea_agents.is_empty() {
            self.producer
                .as_ref()
                .map(|agent| IdeaAgentConfig {
                    agent: agent.clone(),
                    task_limit: self.producer_limit.unwrap_or(1),
                    prompt: self.producer_prompt.clone().unwrap_or_default(),
                })
                .into_iter()
                .collect()
        } else {
            self.idea_agents.clone()
        };

        for idea in &mut agents {
            if let Some(role) = self.roles.iter().find(|role| role.name == idea.agent) {
                idea.prompt = role.prompt.clone();
            }
            if idea.prompt.trim().is_empty() {
                idea.prompt = "Create a new task for this project.".into();
            }
        }
        agents
    }

    pub fn database_path(&self) -> PathBuf {
        self.root.join(".cairn-harness").join("harness.db")
    }

    pub fn work_path(&self) -> Option<PathBuf> {
        self.work_dir.as_ref().map(|path| self.root.join(path))
    }
}

fn resolve_model(agent_override: Option<&str>, global_default: &str) -> String {
    agent_override.unwrap_or(global_default).to_string()
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn loads_agentless_project_scaffold() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"New project","root":{},"work_dir":"work-items","roles":[]}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        let project = ProjectConfig::load(&config).unwrap();

        assert!(project.workers().is_empty());
        assert_eq!(project.leader(), "");
        assert_eq!(project.producer_retry_cooldown_seconds, 86_400);
    }

    #[test]
    fn accepts_and_ignores_legacy_startup_timeout() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"New project","root":{},"roles":[],"copilot":{{"startup_timeout_ms":0}}}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        let project = ProjectConfig::load(&config).unwrap();
        assert_eq!(project.name, "New project");
    }

    #[test]
    fn rejects_zero_producer_retry_cooldown() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"New project","root":{},"roles":[],"producer_retry_cooldown_seconds":0}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        let error = ProjectConfig::load(&config).unwrap_err();

        assert_eq!(
            error.to_string(),
            "producer retry cooldown must be greater than zero"
        );
    }

    #[test]
    fn loads_project_root_capacity() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"Capacity","root":{},"max_active_tasks":2,"roles":[]}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        assert_eq!(
            ProjectConfig::load(&config).unwrap().max_active_tasks,
            Some(2)
        );
    }

    #[test]
    fn loads_one_leader_with_multiple_bounded_idea_agents() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"Ideas","root":{},"leader":"lead","leader_task_limit":2,"idea_agents":[{{"agent":"one","task_limit":3,"prompt":"Create one."}},{{"agent":"two","task_limit":4,"prompt":"Create two."}}],"roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"one","description":"One","prompt":"One."}},{{"name":"two","description":"Two","prompt":"Two."}}]}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        let project = ProjectConfig::load(&config).unwrap();

        assert_eq!(project.leader(), "lead");
        assert_eq!(project.leader_task_limit, Some(2));
        assert_eq!(project.idea_agents().len(), 2);
        assert_eq!(project.workers()[0].idea_agents, vec!["one", "two"]);
    }

    #[test]
    fn idea_agent_prompt_comes_from_the_role_not_a_stale_stored_copy() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"Ideas","root":{},"leader":"lead","idea_agents":[{{"agent":"one","task_limit":1,"prompt":"STALE COPY."}}],"roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"one","description":"One","prompt":"CURRENT ROLE PROMPT."}}]}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        let project = ProjectConfig::load(&config).unwrap();

        assert_eq!(project.idea_agents()[0].prompt, "CURRENT ROLE PROMPT.");
    }

    #[test]
    fn idea_agent_without_a_stored_prompt_still_resolves_from_its_role() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"Ideas","root":{},"leader":"lead","idea_agents":[{{"agent":"one","task_limit":1}}],"roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"one","description":"One","prompt":"ROLE PROMPT."}}]}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        let project = ProjectConfig::load(&config).unwrap();

        assert_eq!(project.idea_agents()[0].prompt, "ROLE PROMPT.");
    }

    #[test]
    fn loads_opt_in_role_templates_capabilities_and_replica_eligibility() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"Replicas","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"dev-three","template":"engineering","capabilities":["implementation","validation"],"replica_eligible":true,"description":"Engineer","prompt":"Work."}},{{"name":"dev-4","template":"engineering","capabilities":["implementation"],"replica_eligible":true,"description":"Engineer","prompt":"Work."}}]}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        let project = ProjectConfig::load(&config).unwrap();
        let replica = project
            .roles
            .iter()
            .find(|role| role.name == "dev-three")
            .unwrap();

        assert_eq!(replica.template.as_deref(), Some("engineering"));
        assert_eq!(replica.capabilities, ["implementation", "validation"]);
        assert!(replica.replica_eligible);
        assert_eq!(
            crate::policy::RuntimePolicy::for_workers(project.workers().len()).max_concurrency,
            3
        );
    }

    #[test]
    fn loads_canonical_agent_replica_group() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r##"{{"name":"Replicas","root":{},"configuration_revision":3,"agent_deletion_operations":[{{"id":"operation","idempotencyKey":"delete-dev-3","targetId":"dev-3","targetKind":"local","affectedIds":["dev-3"],"state":"cleanup_attention","revision":3,"error":"restart failed"}}],"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"dev","agent_kind":"source","source_agent":"dev","instance_ordinal":0,"template":"dev","replica_eligible":true,"description":"Engineer","prompt":"Work.","appearance":{{"color":"#123456","avatar":null}}}},{{"name":"dev-2","agent_kind":"local","source_agent":"dev","instance_ordinal":1,"template":"dev","replica_eligible":true,"description":"Engineer","prompt":"Work."}}]}}"##,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        let project = ProjectConfig::load(&config).unwrap();

        assert_eq!(project.roles[1].template.as_deref(), Some("dev"));
        assert_eq!(project.roles[1].agent_kind.as_deref(), Some("source"));
        assert_eq!(project.roles[1].source_agent.as_deref(), Some("dev"));
        assert_eq!(project.roles[1].instance_ordinal, Some(0));
        assert_eq!(
            project.roles[1]
                .appearance
                .as_ref()
                .and_then(|value| value.color.as_deref()),
            Some("#123456")
        );
        assert_eq!(project.roles[2].template.as_deref(), Some("dev"));
        assert_eq!(project.roles[2].agent_kind.as_deref(), Some("local"));
        assert_eq!(project.roles[2].source_agent.as_deref(), Some("dev"));
        assert_eq!(project.roles[2].instance_ordinal, Some(1));
        assert_eq!(project.configuration_revision, 3);
        assert!(!project.paused);
        assert_eq!(
            project.agent_deletion_operations[0].state,
            "cleanup_attention"
        );
    }

    #[test]
    fn rejects_ambiguous_or_incomplete_replica_configuration() {
        let directory = tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let config = directory.path().join("project.json");
        std::fs::write(
            &config,
            format!(
                r#"{{"name":"Replicas","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"worker","replica_eligible":true,"capabilities":["implementation","implementation"],"description":"Worker","prompt":"Work."}}]}}"#,
                serde_json::to_string(&workspace).unwrap()
            ),
        )
        .unwrap();

        assert_eq!(
            ProjectConfig::load(&config).unwrap_err().to_string(),
            "replica eligibility requires a role template"
        );
    }

    #[test]
    fn agent_model_override_wins_over_global_default() {
        assert_eq!(resolve_model(Some("gpt-5.5"), "gpt-5.4-mini"), "gpt-5.5");
        assert_eq!(resolve_model(None, "gpt-5.4-mini"), "gpt-5.4-mini");
    }
}
