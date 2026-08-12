use anyhow::{Context, Result, bail};
use serde_json::Value;

use crate::protocol::{BEGIN, parse_output};

pub(crate) fn validate_completion_result(result: &str) -> Result<()> {
    if !result.contains(BEGIN) {
        if declares_incomplete_work(result) {
            bail!("task completion rejected: result declares incomplete work");
        }
        return Ok(());
    }
    let output = parse_output(result).context("invalid task completion result")?;
    if !output.complete {
        bail!("task completion rejected: result declares complete=false");
    }
    let evidence = format!(
        "{}\n{}",
        output.summary,
        output.deliverable.as_deref().unwrap_or_default()
    );
    if declares_incomplete_work(&evidence) {
        bail!("task completion rejected: result declares incomplete work");
    }
    Ok(())
}

fn declares_incomplete_work(result: &str) -> bool {
    let normalized = result.trim().to_ascii_lowercase();
    [
        "blocked:",
        "incomplete:",
        "not completed:",
        "no implementation was accepted",
        "no implementation was completed",
        "implementation is still required",
        "work was not completed",
        "could not complete",
        "unable to complete",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

pub(crate) fn required<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value[name]
        .as_str()
        .filter(|text| !text.trim().is_empty())
        .with_context(|| format!("{name} is required"))
}

pub(crate) fn optional<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    value[name]
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
}
