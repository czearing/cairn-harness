use cairn_harness::config::ProjectConfig;

pub fn config(root: &std::path::Path) -> ProjectConfig {
    let path = root.join("project.json");
    std::fs::write(&path, include_str!("../../project.example.json")).unwrap();
    ProjectConfig::load(&path).unwrap()
}
