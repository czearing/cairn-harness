use std::path::{Path, PathBuf};

use crate::models::WorkerSpec;

pub fn profile(root: &Path, worker: &WorkerSpec) -> PathBuf {
    root.join(".cairn-harness")
        .join("copilot-home")
        .join(&worker.id)
}
