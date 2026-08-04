use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};

const SKILL: &str = include_str!("../skills/cairn-harness/SKILL.md");

pub fn install() -> Result<Vec<PathBuf>> {
    install_into(&home()?)
}

fn install_into(home: &Path) -> Result<Vec<PathBuf>> {
    let mut installed = Vec::new();
    for client in [".copilot", ".claude"] {
        let directory = home.join(client).join("skills").join("cairn-harness");
        if directory.is_symlink() {
            bail!("refusing to replace linked skill: {}", directory.display());
        }
        fs::create_dir_all(&directory)?;
        let file = directory.join("SKILL.md");
        fs::write(&file, SKILL)?;
        installed.push(file);
    }
    Ok(installed)
}

fn home() -> Result<PathBuf> {
    std::env::var_os("HARNESS_HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .context("home directory unavailable")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_the_same_team_skill_for_both_clients() {
        let home = tempfile::tempdir().unwrap();

        let installed = install_into(home.path()).unwrap();

        assert_eq!(installed.len(), 2);
        for file in installed {
            let content = fs::read_to_string(file).unwrap();
            assert!(content.contains("name: cairn-harness"));
            assert!(content.contains("/work-items"));
            assert!(content.contains("/messages"));
            assert!(content.contains("make-leader"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_replace_a_linked_skill() {
        use std::os::unix::fs::symlink;

        let home = tempfile::tempdir().unwrap();
        let target = home.path().join("target");
        fs::create_dir(&target).unwrap();
        let directory = home
            .path()
            .join(".copilot")
            .join("skills")
            .join("cairn-harness");
        fs::create_dir_all(directory.parent().unwrap()).unwrap();
        symlink(target, &directory).unwrap();

        assert!(install_into(home.path()).is_err());
    }
}
