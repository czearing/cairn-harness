use std::time::{Duration, SystemTime};

use tempfile::tempdir;

use super::{is_session_id, prune_at};

const SESSION_A: &str = "0cfadcc6-3aca-4292-86a3-e9041d981ada";
const SESSION_B: &str = "8625dd8e-69c2-4fb5-82f5-cce024543da4";
const RETENTION: Duration = Duration::from_secs(6 * 60 * 60);

fn session(home: &std::path::Path, id: &str) -> std::path::PathBuf {
    let path = home.join("session-state").join(id);
    std::fs::create_dir_all(path.join("files").join("target")).unwrap();
    std::fs::write(path.join("events.jsonl"), "{}").unwrap();
    std::fs::write(path.join("files").join("target").join("build"), vec![0; 512]).unwrap();
    path
}

fn age(path: &std::path::Path, elapsed: Duration) {
    let when = SystemTime::now() - elapsed;
    let file = std::fs::File::options()
        .write(true)
        .open(path.join("events.jsonl"))
        .unwrap();
    file.set_modified(when).unwrap();
}

#[test]
fn removes_unreachable_session_workspaces_and_reports_reclaimed_bytes() {
    let temp = tempdir().unwrap();
    let stale = session(temp.path(), SESSION_A);
    age(&stale, Duration::from_secs(24 * 60 * 60));

    let reclaimed = prune_at(temp.path(), SESSION_B, SystemTime::now(), RETENTION).unwrap();

    assert!(!stale.exists(), "an unreachable session must be removed");
    assert!(
        reclaimed >= 512,
        "the build artifacts it held must be counted as reclaimed, got {reclaimed}"
    );
}

#[test]
fn never_removes_the_session_that_is_about_to_be_resumed() {
    let temp = tempdir().unwrap();
    let current = session(temp.path(), SESSION_B);
    age(&current, Duration::from_secs(30 * 24 * 60 * 60));

    prune_at(temp.path(), SESSION_B, SystemTime::now(), RETENTION).unwrap();

    assert!(
        current.exists(),
        "the resumable session must survive regardless of age"
    );
}

#[test]
fn keeps_sessions_inside_the_retention_window() {
    let temp = tempdir().unwrap();
    let recent = session(temp.path(), SESSION_A);
    age(&recent, Duration::from_secs(60));

    prune_at(temp.path(), SESSION_B, SystemTime::now(), RETENTION).unwrap();

    assert!(
        recent.exists(),
        "a session still inside the retention window must survive"
    );
}

#[test]
fn leaves_directories_that_are_not_sessions_alone() {
    let temp = tempdir().unwrap();
    let other = temp.path().join("session-state").join("files");
    std::fs::create_dir_all(&other).unwrap();
    std::fs::write(other.join("shared"), "keep").unwrap();
    let file = std::fs::File::options()
        .write(true)
        .open(other.join("shared"))
        .unwrap();
    file.set_modified(SystemTime::now() - Duration::from_secs(24 * 60 * 60))
        .unwrap();

    prune_at(temp.path(), SESSION_B, SystemTime::now(), RETENTION).unwrap();

    assert!(
        other.exists(),
        "only session-shaped directories may ever be removed"
    );
}

#[test]
fn tolerates_a_missing_session_directory() {
    let temp = tempdir().unwrap();

    let reclaimed = prune_at(temp.path(), SESSION_B, SystemTime::now(), RETENTION).unwrap();

    assert_eq!(reclaimed, 0);
}

#[test]
fn recognises_only_session_shaped_names() {
    assert!(is_session_id(SESSION_A));
    assert!(!is_session_id("files"));
    assert!(!is_session_id("0cfadcc6-3aca-4292-86a3-e9041d981ad"));
    assert!(!is_session_id("zzzzzzzz-3aca-4292-86a3-e9041d981ada"));
}
