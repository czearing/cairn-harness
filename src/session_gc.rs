use std::path::Path;
use std::time::{Duration, SystemTime};

use anyhow::Result;

/// The harness stores exactly one resumable session per agent, so every other session workspace is
/// already unreachable. They are still kept this long so a previous process that is shutting down
/// is never disturbed.
const RETENTION: Duration = Duration::from_secs(6 * 60 * 60);

/// Removes session workspaces the agent can no longer resume and reports the reclaimed bytes.
///
/// Agents build inside their own session workspace, so these directories accumulate whole
/// `target/` trees that nothing ever deletes.
pub fn prune(copilot_home: &Path, keep_session_id: &str) -> Result<u64> {
    prune_at(copilot_home, keep_session_id, SystemTime::now(), RETENTION)
}

fn prune_at(
    copilot_home: &Path,
    keep_session_id: &str,
    now: SystemTime,
    retention: Duration,
) -> Result<u64> {
    let sessions = copilot_home.join("session-state");
    let Ok(entries) = std::fs::read_dir(&sessions) else {
        return Ok(0);
    };
    let mut reclaimed = 0;
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        // Only ever consider session directories, and never the one about to be resumed.
        if name == keep_session_id || !is_session_id(&name) {
            continue;
        }
        let path = entry.path();
        if !is_expired(&path, now, retention) {
            continue;
        }
        let size = directory_size(&path);
        match std::fs::remove_dir_all(&path) {
            Ok(()) => reclaimed += size,
            Err(error) => {
                tracing::warn!(session = %name, %error, "could not remove an unreachable session workspace")
            }
        }
    }
    Ok(reclaimed)
}

/// A session appends to `events.jsonl` on every turn, so that file is the accurate activity
/// signal; the directory's own timestamp is only a fallback for a session that never recorded one.
fn is_expired(path: &Path, now: SystemTime, retention: Duration) -> bool {
    let events = path.join("events.jsonl");
    let touched = std::fs::metadata(&events)
        .or_else(|_| std::fs::metadata(path))
        .and_then(|data| data.modified());
    touched.is_ok_and(|touched| {
        now.duration_since(touched)
            .is_ok_and(|idle| idle >= retention)
    })
}

fn is_session_id(name: &str) -> bool {
    name.len() == 36
        && name.chars().enumerate().all(|(index, character)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                character == '-'
            } else {
                character.is_ascii_hexdigit()
            }
        })
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => directory_size(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map(|data| data.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

#[cfg(test)]
#[path = "session_gc_tests.rs"]
mod tests;
