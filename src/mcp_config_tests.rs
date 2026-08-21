use tempfile::tempdir;

use super::*;

#[test]
fn session_config_keeps_external_servers_separate_from_embedded_harness_tools() {
    let directory = tempdir().unwrap();
    let profile = directory
        .path()
        .join(".cairn-harness")
        .join("copilot-home")
        .join("editor");
    std::fs::create_dir_all(&profile).unwrap();
    std::fs::write(
        profile.join("mcp-config.json"),
        r#"{"mcpServers":{"cairn":{"type":"local","command":"cairn","args":["mcp"],"env":{"CAIRN_DB_PATH":"machine.db","CAIRN_LIBSQL_URL":"remote","CAIRN_LIBSQL_TOKEN":"secret"}}}}"#,
    )
    .unwrap();
    let base = directory.path().join("base.json");
    std::fs::write(
        &base,
        r#"{"mcpServers":{"cairn":{"type":"local","command":"cairn","args":["mcp"],"env":{"CAIRN_DB_PATH":"base.db","CAIRN_LIBSQL_URL":"remote-base"}},"review":{"type":"local","command":"review","args":["mcp"]}}}"#,
    )
    .unwrap();
    let config = CopilotConfig {
        additional_mcp_config: Some(base),
        ..CopilotConfig::default()
    };
    let worker = WorkerSpec {
        id: "editor".into(),
        role: "editor".into(),
        description: "Edit".into(),
        prompt: "Edit.".into(),
        model: "gpt-5.4-mini".into(),
        leader: "author".into(),
        leader_task_limit: 3,
        idea_agents: vec!["scout".into()],
        delegate_agents: Vec::new(),
    };

    let file = write(directory.path(), &worker, &config, "runtime-1").unwrap();
    let document: Value = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
    let servers = document["mcpServers"].as_object().unwrap();

    assert_eq!(servers.len(), 3);
    let cairn = &servers["cairn"];
    assert_eq!(
        cairn["env"]["CAIRN_DB_PATH"],
        crate::cairn_scope::database(directory.path())
            .display()
            .to_string()
    );
    assert!(cairn["env"].get("CAIRN_LIBSQL_URL").is_none());
    assert!(cairn["env"].get("CAIRN_LIBSQL_TOKEN").is_none());
    assert!(servers.contains_key("review"));
    let harness = &servers["cairn-harness"];
    assert_eq!(harness["args"], json!(["mcp"]));
    assert_eq!(harness["env"]["CAIRN_HARNESS_AGENT"], "editor");
    assert_eq!(harness["env"]["CAIRN_HARNESS_LEADER"], "author");
    assert_eq!(harness["env"]["CAIRN_HARNESS_IDEA_AGENTS"], "scout");
    assert_eq!(harness["env"]["CAIRN_HARNESS_RUNTIME_ID"], "runtime-1");
    assert_eq!(
        harness["env"]["CAIRN_HARNESS_DB"],
        directory
            .path()
            .join(".cairn-harness")
            .join("harness.db")
            .display()
            .to_string()
    );
}

#[test]
fn harness_tool_grant_is_narrowed_to_the_role() {
    let worker = |id: &str, leader: &str, delegates: Vec<String>, ideas: Vec<String>| WorkerSpec {
        id: id.into(),
        role: id.into(),
        description: "Role".into(),
        prompt: "Do.".into(),
        model: "gpt-5.4-mini".into(),
        leader: leader.into(),
        leader_task_limit: 3,
        idea_agents: ideas,
        delegate_agents: delegates,
    };

    assert_eq!(
        harness_tools(&worker("writer", "lead", Vec::new(), Vec::new())),
        vec!["message_send", "team_status"]
    );
    assert_eq!(
        harness_tools(&worker("lead", "lead", Vec::new(), Vec::new())),
        vec![
            "message_send",
            "task_create",
            "task_delegate",
            "team_status"
        ]
    );
    assert_eq!(
        harness_tools(&worker("second", "lead", vec!["second".into()], Vec::new())),
        vec![
            "message_send",
            "task_create",
            "task_delegate",
            "team_status"
        ]
    );
    assert_eq!(
        harness_tools(&worker("scout", "lead", Vec::new(), vec!["scout".into()])),
        vec!["message_send", "task_create", "team_status"]
    );
}
