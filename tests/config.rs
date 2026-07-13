use tempfile::tempdir;

use cairn_harness::config::ProjectConfig;

#[test]
fn expands_roles_into_bounded_workers() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        r#"{
          "name":"test","root":".",
          "team":{"max_agents":3,"max_concurrency":2,"roles":[
            {"name":"pm","contract":"lead"},
            {"name":"coder","instances":2,"contract":"build"}
          ]}
        }"#,
    )
    .unwrap();
    let config = ProjectConfig::load(&path).unwrap();
    let ids: Vec<_> = config
        .workers()
        .into_iter()
        .map(|worker| worker.id)
        .collect();
    assert_eq!(ids, ["pm", "coder-1", "coder-2"]);
}

#[test]
fn rejects_more_workers_than_allowed() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        r#"{
          "name":"test","root":".",
          "team":{"max_agents":1,"max_concurrency":1,"roles":[
            {"name":"coder","instances":2,"contract":"build"}
          ]}
        }"#,
    )
    .unwrap();
    assert!(ProjectConfig::load(&path).is_err());
}
