use std::collections::HashMap;

use anyhow::{Result, bail};

use crate::models::WorkerSpec;

pub type Directory = HashMap<String, Vec<String>>;

pub fn build(workers: &[WorkerSpec]) -> Directory {
    let mut directory = HashMap::new();
    directory.insert("*".into(), workers.iter().map(|w| w.id.clone()).collect());
    for worker in workers {
        directory
            .entry(worker.role.clone())
            .or_insert_with(Vec::new)
            .push(worker.id.clone());
        directory.insert(worker.id.clone(), vec![worker.id.clone()]);
    }
    directory
}

pub fn resolve(directory: &Directory, target: &str) -> Result<Vec<String>> {
    let recipients = directory
        .get(target)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("unknown agent or role: {target}"))?;
    if recipients.is_empty() {
        bail!("target has no agents: {target}");
    }
    Ok(recipients)
}
