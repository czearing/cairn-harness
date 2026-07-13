use std::{
    env,
    path::{Path, PathBuf},
};

use tokio::process::Command;

pub fn new(executable: &Path) -> Command {
    let parts = argv(executable);
    let mut command = Command::new(&parts[0]);
    command.args(&parts[1..]);
    command
}

pub fn argv(executable: &Path) -> Vec<String> {
    let resolved = resolve(executable);
    #[cfg(windows)]
    if let Some(parts) = npm_copilot_argv(&resolved) {
        return parts;
    }
    #[cfg(windows)]
    if resolved
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ps1"))
    {
        return vec![
            "powershell".into(),
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-File".into(),
            resolved.display().to_string(),
        ];
    }
    vec![resolved.display().to_string()]
}

#[cfg(windows)]
fn npm_copilot_argv(script: &Path) -> Option<Vec<String>> {
    let name = script.file_name()?.to_string_lossy();
    if !name.eq_ignore_ascii_case("copilot.ps1")
        && !name.eq_ignore_ascii_case("copilot.cmd")
        && !name.eq_ignore_ascii_case("copilot")
    {
        return None;
    }
    let directory = script.parent()?;
    let loader = directory.join("node_modules/@github/copilot/npm-loader.js");
    if !loader.is_file() {
        return None;
    }
    let bundled_node = directory.join("node.exe");
    let node = if bundled_node.is_file() {
        bundled_node.display().to_string()
    } else {
        "node".into()
    };
    Some(vec![node, loader.display().to_string()])
}

fn resolve(executable: &Path) -> PathBuf {
    if executable.components().count() > 1 || executable.extension().is_some() {
        return executable.to_owned();
    }
    let Some(path) = env::var_os("PATH") else {
        return executable.to_owned();
    };
    for directory in env::split_paths(&path) {
        for suffix in suffixes() {
            let candidate = directory.join(format!("{}{suffix}", executable.display()));
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    executable.to_owned()
}

#[cfg(windows)]
fn suffixes() -> &'static [&'static str] {
    &[".exe", ".cmd", ".bat", ".ps1", ""]
}

#[cfg(not(windows))]
fn suffixes() -> &'static [&'static str] {
    &[""]
}
