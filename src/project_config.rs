use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};

use crate::{config::ProjectConfig, models::WorkerSpec};

impl ProjectConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let text = fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let mut config: Self = serde_json::from_str(&text)?;
        let base = path.parent().unwrap_or_else(|| Path::new("."));
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
        self.roles
            .iter()
            .map(|role| WorkerSpec {
                id: role.name.clone(),
                role: role.name.clone(),
                description: role.description.clone(),
                prompt: role.prompt.clone(),
            })
            .collect()
    }

    pub fn leader(&self) -> &str {
        self.leader.as_deref().unwrap_or(&self.roles[0].name)
    }

    pub fn database_path(&self) -> PathBuf {
        self.root.join(".cairn-harness").join("harness.db")
    }

    pub fn todo_path(&self) -> PathBuf {
        self.root.join(&self.todo_dir)
    }

    fn validate(&self) -> Result<()> {
        if self.roles.is_empty() {
            bail!("project must contain at least one role");
        }
        let names: HashSet<_> = self.roles.iter().map(|role| role.name.as_str()).collect();
        if names.len() != self.roles.len() {
            bail!("role names must be unique");
        }
        self.roles
            .iter()
            .find(|role| role.name == self.leader())
            .context("leader must name a configured role")?;
        if let Some(producer) = &self.producer {
            self.roles
                .iter()
                .find(|role| role.name == producer.as_str())
                .context("producer must name a configured role")?;
        }
        for role in &self.roles {
            if role.description.is_empty() || role.prompt.is_empty() {
                bail!("every role needs a description and prompt");
            }
        }
        Ok(())
    }
}
