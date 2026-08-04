#[cfg(windows)]
use std::collections::HashSet;
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
    let suffixes = suffixes();
    for directory in env::split_paths(&path) {
        for suffix in &suffixes {
            let candidate = directory.join(format!("{}{suffix}", executable.display()));
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    executable.to_owned()
}

#[cfg(windows)]
fn suffixes() -> Vec<String> {
    const FALLBACK: &[&str] = &[".COM", ".EXE", ".BAT", ".CMD", ".PS1"];
    let mut suffixes = env::var_os("PATHEXT")
        .and_then(|value| value.into_string().ok())
        .map(|value| parse_pathext(&value))
        .filter(|suffixes| !suffixes.is_empty())
        .unwrap_or_else(|| FALLBACK.iter().map(|suffix| (*suffix).into()).collect());
    suffixes.push(String::new());
    suffixes
}

#[cfg(windows)]
fn parse_pathext(value: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    value
        .split(';')
        .filter_map(|entry| {
            let entry = entry.trim();
            let extension = entry.strip_prefix('.').unwrap_or(entry);
            if extension.is_empty()
                || extension.starts_with('.')
                || extension.ends_with('.')
                || extension.chars().any(|character| {
                    character.is_control()
                        || matches!(
                            character,
                            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                        )
                })
            {
                return None;
            }
            let key = extension.to_lowercase();
            seen.insert(key).then(|| format!(".{extension}"))
        })
        .collect()
}

#[cfg(not(windows))]
fn suffixes() -> Vec<String> {
    vec![String::new()]
}

#[cfg(all(test, windows))]
mod tests {
    use std::{
        ffi::OsString,
        path::{Path, PathBuf},
    };

    use tempfile::tempdir;

    use super::{argv, resolve, suffixes};

    #[test]
    fn pathext_order_supports_custom_extensions_and_case_insensitive_deduplication() {
        let temp = tempdir().unwrap();
        touch(&temp.path().join("tool.COM"));
        touch(&temp.path().join("tool.C++"));
        let _environment = Environment::set(temp.path(), Some("C++;.COM;.c++"));

        assert_eq!(suffixes(), [".C++", ".COM", ""]);
        assert_eq!(resolve(Path::new("tool")), temp.path().join("tool.C++"));
        assert_eq!(
            argv(Path::new("tool")),
            [display(temp.path().join("tool.C++"))]
        );
    }

    #[test]
    fn absent_or_unusable_pathext_uses_deterministic_fallback_with_com() {
        let temp = tempdir().unwrap();
        touch(&temp.path().join("tool.COM"));

        {
            let _environment = Environment::set(temp.path(), None);
            assert_eq!(resolve(Path::new("tool")), temp.path().join("tool.COM"));
        }
        {
            let _environment = Environment::set(temp.path(), Some(" ; . ; bad/ext ; *** "));
            assert_eq!(resolve(Path::new("tool")), temp.path().join("tool.COM"));
        }
    }

    #[test]
    fn explicit_paths_and_extensions_are_not_rewritten() {
        let temp = tempdir().unwrap();
        touch(&temp.path().join("tool.EXE"));
        let _environment = Environment::set(temp.path(), Some(".EXE"));
        let explicit_path = PathBuf::from("nested").join("tool");

        assert_eq!(resolve(&explicit_path), explicit_path);
        assert_eq!(resolve(Path::new("tool.EXE")), PathBuf::from("tool.EXE"));
    }

    #[test]
    fn resolved_scripts_preserve_loader_and_powershell_argument_boundaries() {
        let temp = tempdir().unwrap();
        let loader = temp
            .path()
            .join("node_modules/@github/copilot/npm-loader.js");
        std::fs::create_dir_all(loader.parent().unwrap()).unwrap();
        touch(&loader);
        touch(&temp.path().join("copilot.cmd"));
        touch(&temp.path().join("copilot.ps1"));
        touch(&temp.path().join("node.exe"));
        touch(&temp.path().join("helper.ps1"));
        let _environment = Environment::set(temp.path(), Some("CMD;.ps1"));

        let loader_argv = [
            display(temp.path().join("node.exe")),
            display(loader.clone()),
        ];
        assert_eq!(argv(Path::new("copilot")), loader_argv);
        assert_eq!(argv(&temp.path().join("copilot.ps1")), loader_argv);
        assert_eq!(
            argv(Path::new("helper")),
            vec![
                "powershell".into(),
                "-NoProfile".into(),
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-File".into(),
                display(temp.path().join("helper.ps1")),
            ]
        );
    }

    fn touch(path: &Path) {
        std::fs::write(path, "").unwrap();
    }

    fn display(path: PathBuf) -> String {
        path.display().to_string()
    }

    struct Environment {
        path: Option<OsString>,
        pathext: Option<OsString>,
    }

    impl Environment {
        fn set(path: &Path, pathext: Option<&str>) -> Self {
            let environment = Self {
                path: std::env::var_os("PATH"),
                pathext: std::env::var_os("PATHEXT"),
            };
            unsafe {
                std::env::set_var("PATH", path);
                match pathext {
                    Some(value) => std::env::set_var("PATHEXT", value),
                    None => std::env::remove_var("PATHEXT"),
                }
            }
            environment
        }
    }

    impl Drop for Environment {
        fn drop(&mut self) {
            unsafe {
                restore("PATH", self.path.take());
                restore("PATHEXT", self.pathext.take());
            }
        }
    }

    unsafe fn restore(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }
}
