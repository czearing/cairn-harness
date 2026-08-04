use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use anyhow::Result;
use chrono::Utc;
use serde::Serialize;

use crate::protocol;

const WRITE_INTERVAL: Duration = Duration::from_millis(75);

pub struct LiveResponse {
    file: PathBuf,
    session_id: String,
    last_write: Option<Instant>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveResponseDocument<'a> {
    session_id: &'a str,
    body: &'a str,
    updated_at: String,
}

impl LiveResponse {
    pub fn new(root: &Path, agent: &str, session_id: &str) -> Self {
        Self {
            file: root
                .join(".cairn-harness")
                .join("live-responses")
                .join(format!("{agent}.json")),
            session_id: session_id.into(),
            last_write: None,
        }
    }

    pub fn publish(&mut self, response: &str) -> Result<()> {
        self.write(response, false)
    }

    pub fn flush(&mut self, response: &str) -> Result<()> {
        self.write(response, true)
    }

    fn write(&mut self, response: &str, force: bool) -> Result<()> {
        let body = visible_text(response);
        if body.is_empty() {
            return self.clear();
        }
        if !force
            && self
                .last_write
                .is_some_and(|last| last.elapsed() < WRITE_INTERVAL)
        {
            return Ok(());
        }
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let document = LiveResponseDocument {
            session_id: &self.session_id,
            body: &body,
            updated_at: Utc::now().to_rfc3339(),
        };
        std::fs::write(&self.file, serde_json::to_vec(&document)?)?;
        self.last_write = Some(Instant::now());
        Ok(())
    }

    pub fn clear(&mut self) -> Result<()> {
        self.last_write = None;
        match std::fs::remove_file(&self.file) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

fn visible_text(response: &str) -> String {
    response
        .split(protocol::BEGIN)
        .next()
        .unwrap_or_default()
        .replace("HARNESS_SESSION_READY", "")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn publishes_visible_text_and_clears_it() {
        let root = tempdir().unwrap();
        let mut response = LiveResponse::new(root.path(), "writer", "session-one");

        response
            .publish("Drafting the answer.\nCAIRN_ENVELOPE_BEGIN\n{\"summary\":\"done\"}")
            .unwrap();

        let file = root
            .path()
            .join(".cairn-harness/live-responses/writer.json");
        let document: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(document["body"], "Drafting the answer.");
        assert_eq!(document["sessionId"], "session-one");

        response.clear().unwrap();
        assert!(!file.exists());
    }
}
