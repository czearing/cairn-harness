use serde_json::json;
use tempfile::tempdir;

use super::*;

#[test]
fn workers_in_one_project_share_one_local_cairn_database() {
    let project = tempdir().unwrap();

    let first = database(project.path());
    let second = database(project.path());

    assert_eq!(first, second);
    assert!(first.starts_with(project.path()));
}

#[test]
fn separate_local_projects_use_separate_cairn_databases() {
    let first = tempdir().unwrap();
    let second = tempdir().unwrap();

    assert_ne!(database(first.path()), database(second.path()));
}

#[test]
fn project_process_environment_disables_remote_storage() {
    let project = tempdir().unwrap();
    let environment = process_environment(project.path());

    assert_eq!(
        environment[0],
        format!("CAIRN_DB_PATH={}", database(project.path()).display())
    );
    assert_eq!(environment[1], "CAIRN_LIBSQL_URL=");
    assert_eq!(environment[2], "CAIRN_LIBSQL_TOKEN=");
}

#[test]
fn project_scope_replaces_machine_and_remote_storage() {
    let project = tempdir().unwrap();
    let mut document = json!({
        "mcpServers": {
            "cairn": {
                "type": "local",
                "command": "cairn",
                "args": ["mcp"],
                "env": {
                    "CAIRN_DB_PATH": "machine.db",
                    "CAIRN_LIBSQL_URL": "remote",
                    "CAIRN_LIBSQL_TOKEN": "secret",
                    "CAIRN_EMBED_PROVIDER": "local"
                }
            }
        }
    });

    scope_document(&mut document, project.path()).unwrap();

    let environment = document["mcpServers"]["cairn"]["env"].as_object().unwrap();
    assert_eq!(
        environment["CAIRN_DB_PATH"],
        database(project.path()).display().to_string()
    );
    assert!(!environment.contains_key("CAIRN_LIBSQL_URL"));
    assert!(!environment.contains_key("CAIRN_LIBSQL_TOKEN"));
    assert_eq!(environment["CAIRN_EMBED_PROVIDER"], "local");
}
