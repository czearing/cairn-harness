use std::collections::HashSet;

use anyhow::{Context, Result, bail};

use crate::config::ProjectConfig;

impl ProjectConfig {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.producer_retry_cooldown_seconds == 0 {
            bail!("producer retry cooldown must be greater than zero");
        }
        if self.max_active_tasks.is_some_and(|limit| limit == 0) {
            bail!("maximum active tasks must be greater than zero");
        }
        if self.roles.is_empty() {
            if self.leader.is_some()
                || self.leader_task_limit.is_some()
                || !self.idea_agents.is_empty()
                || !self.delegate_agents.is_empty()
                || self.producer.is_some()
                || self.producer_limit.is_some()
                || self.producer_prompt.is_some()
            {
                bail!("agentless projects cannot name a leader or producer");
            }
            return Ok(());
        }
        let names: HashSet<_> = self.roles.iter().map(|role| role.name.as_str()).collect();
        if names.len() != self.roles.len() {
            bail!("role names must be unique");
        }
        self.roles
            .iter()
            .find(|role| role.name == self.leader())
            .context("leader must name a configured role")?;
        if self.leader_task_limit.is_some_and(|limit| limit == 0) {
            bail!("leader task limit must be greater than zero");
        }
        let idea_agents = self.idea_agents();
        let idea_names: HashSet<_> = idea_agents.iter().map(|idea| idea.agent.as_str()).collect();
        if idea_names.len() != idea_agents.len() {
            bail!("idea agents must be unique");
        }
        for idea in &idea_agents {
            self.roles
                .iter()
                .find(|role| role.name == idea.agent)
                .context("idea agent must name a configured role")?;
            if idea.task_limit == 0 {
                bail!("idea agent task limit must be greater than zero");
            }
        }
        let delegate_names: HashSet<_> = self
            .delegate_agents
            .iter()
            .map(|agent| agent.as_str())
            .collect();
        if delegate_names.len() != self.delegate_agents.len() {
            bail!("delegate agents must be unique");
        }
        for agent in &self.delegate_agents {
            self.roles
                .iter()
                .find(|role| role.name == agent.as_str())
                .context("delegate agent must name a configured role")?;
            if agent.as_str() == self.leader() {
                bail!("the project leader already delegates and cannot be listed separately");
            }
        }
        if let Some(producer) = &self.producer {
            self.roles
                .iter()
                .find(|role| role.name == producer.as_str())
                .context("producer must name a configured role")?;
        }
        if self.producer_limit.is_some_and(|limit| limit == 0) {
            bail!("producer limit must be greater than zero");
        }
        if self.producer_limit.is_some() && self.producer.is_none() {
            bail!("producer limit requires a producer");
        }
        if self.producer_prompt.is_some() && self.producer.is_none() {
            bail!("producer prompt requires a producer");
        }
        for role in &self.roles {
            if role.description.is_empty() || role.prompt.is_empty() {
                bail!("every role needs a description and prompt");
            }
            if role
                .template
                .as_deref()
                .is_some_and(|template| template.trim().is_empty())
            {
                bail!("role template cannot be empty");
            }
            if role.replica_eligible && role.template.is_none() {
                bail!("replica eligibility requires a role template");
            }
            let capabilities: HashSet<_> = role
                .capabilities
                .iter()
                .map(|capability| capability.trim())
                .collect();
            if capabilities.len() != role.capabilities.len() || capabilities.contains("") {
                bail!("role capabilities must be unique and non-empty");
            }
        }
        for role in &self.roles {
            if let Some(template) = role.template.as_deref()
                && names.contains(template)
                && !self.roles.iter().any(|canonical| {
                    canonical.name == template
                        && canonical.replica_eligible
                        && canonical.template.as_deref() == Some(template)
                })
            {
                bail!("role template cannot conflict with an agent name");
            }
            if role.replica_eligible && idea_names.contains(role.name.as_str()) {
                bail!("idea agents cannot be delegation replicas");
            }
        }
        Ok(())
    }
}
