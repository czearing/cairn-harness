use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

pub fn sync(destination: &Path, root: &Path) -> Result<()> {
    let home = home()?;
    sync_from(&PathBuf::from(home).join(".copilot"), destination, root)
}

pub fn hook_revision() -> Result<String> {
    let hook = std::fs::read(
        PathBuf::from(home()?)
            .join(".copilot")
            .join("hooks")
            .join("cairn.json"),
    )
    .context("required Cairn Copilot hook is unavailable")?;
    serde_json::from_slice::<serde_json::Value>(&hook)
        .context("required Cairn Copilot hook is invalid")?;
    Ok(blake3::hash(&hook).to_hex().to_string())
}

fn home() -> Result<std::ffi::OsString> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .context("home directory is unavailable")
}

fn sync_from(source: &Path, destination: &Path, root: &Path) -> Result<()> {
    for name in [
        "mcp-config.json",
        "config.json",
        "settings.json",
        "permissions-config.json",
    ] {
        let from = source.join(name);
        if from.is_file() {
            std::fs::copy(from, destination.join(name))?;
        }
    }
    let instructions = source.join("copilot-instructions.md");
    let copied_instructions = destination.join("copilot-instructions.md");
    if instructions.is_file() {
        std::fs::copy(instructions, copied_instructions)?;
    } else if copied_instructions.exists() {
        std::fs::remove_file(copied_instructions)?;
    }
    let cairn_hook = std::fs::read(source.join("hooks").join("cairn.json"))
        .context("required Cairn Copilot hook is unavailable")?;
    serde_json::from_slice::<serde_json::Value>(&cairn_hook)
        .context("required Cairn Copilot hook is invalid")?;
    sync_directory(&source.join("hooks"), &destination.join("hooks"))?;
    std::fs::write(destination.join("hooks").join("cairn.json"), cairn_hook)?;
    sync_directory(&source.join("skills"), &destination.join("skills"))?;
    crate::cairn_scope::scope_profile(&destination.join("mcp-config.json"), root)
}

fn sync_directory(source: &Path, destination: &Path) -> Result<()> {
    if destination.exists() {
        std::fs::remove_dir_all(destination)?;
    }
    std::fs::create_dir_all(destination)?;
    if !source.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            sync_directory(&from, &to)?;
        } else {
            std::fs::copy(from, to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn preserves_direct_session_hooks_skills_and_instructions() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        std::fs::create_dir_all(source.join("hooks")).unwrap();
        std::fs::create_dir_all(destination.join("hooks")).unwrap();
        std::fs::write(
            source.join("mcp-config.json"),
            r#"{"mcpServers":{"cairn":{"type":"local","command":"cairn","args":["mcp"],"env":{"CAIRN_DB_PATH":"machine.db"}}}}"#,
        )
        .unwrap();
        std::fs::write(
            source.join("hooks").join("cairn.json"),
            r#"{"version":1,"hooks":{"agentStop":[]}}"#,
        )
        .unwrap();
        std::fs::write(source.join("hooks").join("unsafe-parent.json"), "{}").unwrap();
        std::fs::write(
            source.join("copilot-instructions.md"),
            "Use complete context.",
        )
        .unwrap();
        std::fs::write(destination.join("hooks").join("stale.json"), "{}").unwrap();
        std::fs::create_dir_all(source.join("skills").join("machine-skill")).unwrap();
        std::fs::write(
            source.join("skills").join("machine-skill").join("SKILL.md"),
            "Preserved skill.",
        )
        .unwrap();
        std::fs::create_dir_all(destination.join("skills").join("stale-skill")).unwrap();

        sync_from(&source, &destination, temp.path()).unwrap();

        let hooks = destination.join("hooks");
        assert!(hooks.join("unsafe-parent.json").is_file());
        assert!(!hooks.join("stale.json").exists());
        assert!(
            destination
                .join("skills")
                .join("machine-skill")
                .join("SKILL.md")
                .is_file()
        );
        assert!(!destination.join("skills").join("stale-skill").exists());
        assert_eq!(
            std::fs::read_to_string(destination.join("copilot-instructions.md")).unwrap(),
            "Use complete context."
        );
        let profile: serde_json::Value =
            serde_json::from_slice(&std::fs::read(destination.join("mcp-config.json")).unwrap())
                .unwrap();
        assert_eq!(
            profile["mcpServers"]["cairn"]["env"]["CAIRN_DB_PATH"],
            crate::cairn_scope::database(temp.path())
                .display()
                .to_string()
        );
    }

    #[test]
    fn keeps_existing_hook_when_required_source_is_invalid() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        std::fs::create_dir_all(source.join("hooks")).unwrap();
        std::fs::create_dir_all(destination.join("hooks")).unwrap();
        std::fs::write(source.join("hooks").join("cairn.json"), "{ invalid").unwrap();
        std::fs::write(
            destination.join("hooks").join("cairn.json"),
            r#"{"version":1,"hooks":{"agentStop":[]}}"#,
        )
        .unwrap();

        let error = sync_from(&source, &destination, temp.path()).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("required Cairn Copilot hook is invalid")
        );
        assert!(destination.join("hooks").join("cairn.json").is_file());
    }
}
