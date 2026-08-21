use std::{collections::HashSet, fs, time::SystemTime};

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::{
    config::{ProjectConfig, RoleConfig},
    models::WorkerSpec,
    worker::WorkerContext,
};

/// Caches the live-config file's last observed mtime so the hot poll loop can
/// skip the read+parse when nothing on disk has changed.
///
/// `refresh_config` runs on every worker poll tick (as often as every
/// `poll_interval_ms`, forever, per worker), so re-reading and re-parsing the
/// whole live-config JSON file unconditionally is wasted work in the
/// overwhelmingly common case where the file is untouched between edits. A
/// cheap `fs::metadata` stat call is used to detect real changes before
/// paying for the full read + JSON parse.
pub(crate) fn refresh_config(
    ctx: &mut WorkerContext,
    last_seen: &mut Option<SystemTime>,
) -> Result<()> {
    let Some(path) = ctx.config_path.clone() else {
        return Ok(());
    };
    if let Some(roles) = read_live_roles_if_changed(&path, last_seen)? {
        ctx.config.roles = roles;
        ctx.worker = current_worker(&ctx.config, &ctx.worker.id)?;
    }
    Ok(())
}

/// Returns the freshly parsed roles only when the file's mtime differs from
/// `last_seen`, updating `last_seen` in that case. Returns `Ok(None)` when the
/// file is unchanged, so the caller can skip applying anything.
fn read_live_roles_if_changed(
    path: &std::path::Path,
    last_seen: &mut Option<SystemTime>,
) -> Result<Option<Vec<RoleConfig>>> {
    let modified = fs::metadata(path)
        .with_context(|| format!("could not stat live agent config at {}", path.display()))?
        .modified()
        .with_context(|| format!("could not read modified time for {}", path.display()))?;
    if *last_seen == Some(modified) {
        return Ok(None);
    }
    let roles = read_live_roles(path)?;
    *last_seen = Some(modified);
    Ok(Some(roles))
}

pub(crate) fn live_config(ctx: &WorkerContext) -> Result<(ProjectConfig, WorkerSpec)> {
    let Some(path) = &ctx.config_path else {
        return Ok((ctx.config.clone(), ctx.worker.clone()));
    };
    let mut config = ctx.config.clone();
    config.roles = read_live_roles(path)?;
    let worker = current_worker(&config, &ctx.worker.id)?;
    Ok((config, worker))
}

fn read_live_roles(path: &std::path::Path) -> Result<Vec<RoleConfig>> {
    #[derive(Deserialize)]
    struct LiveAgentConfig {
        roles: Vec<RoleConfig>,
    }
    let text = fs::read_to_string(path)
        .with_context(|| format!("could not reload live agent config from {}", path.display()))?;
    let live: LiveAgentConfig = serde_json::from_str(&text)
        .with_context(|| format!("could not parse live agent config from {}", path.display()))?;
    let names: HashSet<_> = live.roles.iter().map(|role| role.name.as_str()).collect();
    anyhow::ensure!(
        names.len() == live.roles.len(),
        "live agent config contains duplicate roles"
    );
    Ok(live.roles)
}

fn current_worker(config: &ProjectConfig, worker_id: &str) -> Result<WorkerSpec> {
    config
        .workers()
        .into_iter()
        .find(|worker| worker.id == worker_id)
        .with_context(|| format!("live agent config no longer contains {worker_id}"))
}

#[cfg(test)]
mod tests {
    use std::fs::OpenOptions;

    use super::*;

    fn write_roles(path: &std::path::Path, description: &str) {
        fs::write(
            path,
            format!(
                r#"{{"roles":[{{"name":"worker","description":{},"prompt":"p"}}]}}"#,
                serde_json::to_string(description).unwrap(),
            ),
        )
        .unwrap();
    }

    #[test]
    fn read_live_roles_if_changed_skips_reparsing_when_mtime_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("live.json");
        write_roles(&path, "first");

        let mut last_seen = None;
        let first = read_live_roles_if_changed(&path, &mut last_seen)
            .unwrap()
            .expect("first read must return the parsed roles");
        assert_eq!(first[0].description, "first");
        assert!(last_seen.is_some());

        // Corrupt the file contents without changing its recorded mtime. If
        // the cache didn't skip the reparse here, this invalid JSON would
        // fail to parse and this call would return an `Err`, not `Ok(None)`.
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        fs::write(&path, "not valid json").unwrap();
        OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(modified)
            .unwrap();

        let cached = read_live_roles_if_changed(&path, &mut last_seen).unwrap();
        assert!(cached.is_none(), "unchanged mtime must skip the reparse");

        // A genuine content (and therefore mtime) change must still be
        // picked up on the next call.
        write_roles(&path, "second");
        let updated = read_live_roles_if_changed(&path, &mut last_seen)
            .unwrap()
            .expect("changed mtime must trigger a fresh reparse");
        assert_eq!(updated[0].description, "second");
    }
}
