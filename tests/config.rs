use tempfile::tempdir;

use cairn_harness::config::ProjectConfig;

#[test]
fn roles_are_the_complete_team() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        r#"{
          "name":"test","root":".","leader":"pm","roles":[
            {"name":"pm","description":"Lead","prompt":"Define work."},
            {"name":"coder","description":"Coder","prompt":"Build work."}
          ]
        }"#,
    )
    .unwrap();
    let config = ProjectConfig::load(&path).unwrap();
    let ids: Vec<_> = config
        .workers()
        .into_iter()
        .map(|worker| worker.id)
        .collect();
    assert_eq!(ids, ["pm", "coder"]);
}

#[test]
fn rejects_duplicate_role_names() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("project.json");
    std::fs::write(
        &path,
        r#"{
          "name":"test","root":".","roles":[
            {"name":"coder","description":"One","prompt":"Build."},
            {"name":"coder","description":"Two","prompt":"Test."}
          ]
        }"#,
    )
    .unwrap();
    assert!(ProjectConfig::load(&path).is_err());
}
