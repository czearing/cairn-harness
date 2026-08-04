use std::fs;

use anyhow::Result;
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::{
    config::ProjectConfig,
    store::Store,
    telemetry::model::{VersionIdentity, WorkerIdentity},
};

pub fn identity() -> VersionIdentity {
    let dirty = env!("HARNESS_GIT_DIRTY") == "1";
    let git_sha = env!("HARNESS_GIT_SHA").to_owned();
    VersionIdentity {
        package_version: env!("CARGO_PKG_VERSION").into(),
        display: format!(
            "{}+{}{}",
            env!("CARGO_PKG_VERSION"),
            git_sha,
            if dirty { ".dirty" } else { "" }
        ),
        git_sha,
        dirty,
        executable_sha256: executable_hash(),
        worker: None,
    }
}

pub async fn record_start(store: &Store) -> Result<()> {
    let value = identity();
    let command = std::env::args()
        .find(|arg| matches!(arg.as_str(), "watch" | "run" | "step"))
        .unwrap_or_else(|| "command".into());
    let detail = serde_json::json!({
        "packageVersion": value.package_version,
        "display": value.display,
        "gitSha": value.git_sha,
        "dirty": value.dirty,
        "executableSha256": value.executable_sha256,
        "pid": std::process::id(),
        "startedAt": chrono::Utc::now().to_rfc3339(),
        "command": command,
    });
    store
        .record_runtime_event(
            "harness_started",
            "info",
            None,
            None,
            None,
            &detail.to_string(),
        )
        .await
}

pub async fn running_identity(_config: &ProjectConfig, store: &Store) -> Result<VersionIdentity> {
    let row = sqlx::query(
        "SELECT detail FROM runtime_events
         WHERE event_type='harness_started' ORDER BY sequence DESC LIMIT 1",
    )
    .fetch_optional(&store.pool)
    .await?;
    let Some(row) = row else {
        return Ok(identity());
    };
    let detail: String = row.try_get("detail")?;
    let value: serde_json::Value = serde_json::from_str(&detail)?;
    Ok(VersionIdentity {
        package_version: text(&value, "packageVersion"),
        display: text(&value, "display"),
        git_sha: text(&value, "gitSha"),
        dirty: value["dirty"].as_bool().unwrap_or(false),
        executable_sha256: text(&value, "executableSha256"),
        worker: Some(WorkerIdentity {
            pid: value["pid"].as_u64().unwrap_or(0) as u32,
            started_at: text(&value, "startedAt"),
            command: text(&value, "command"),
        }),
    })
}

fn text(value: &serde_json::Value, key: &str) -> String {
    value[key].as_str().unwrap_or("unknown").into()
}

fn executable_hash() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| fs::read(path).ok())
        .map(|bytes| sha256(&bytes))
        .unwrap_or_else(|| "unknown".into())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_contains_build_and_binary() {
        let value = identity();
        assert!(value.display.starts_with(env!("CARGO_PKG_VERSION")));
        assert_eq!(value.executable_sha256.len(), 64);
    }

    #[test]
    fn executable_fingerprint_is_sha256() {
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
