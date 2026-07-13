use anyhow::{Context, Result, bail};

use crate::models::AgentOutput;

pub const BEGIN: &str = "CAIRN_ENVELOPE_BEGIN";
pub const END: &str = "CAIRN_ENVELOPE_END";

pub fn parse_output(text: &str) -> Result<AgentOutput> {
    let start = text.find(BEGIN).context("missing envelope start marker")? + BEGIN.len();
    let tail = &text[start..];
    let end = tail.find(END).context("missing envelope end marker")?;
    let payload = tail[..end].trim();
    if payload.is_empty() {
        bail!("empty agent envelope");
    }
    let output: AgentOutput =
        serde_json::from_str(payload).context("invalid agent envelope JSON")?;
    if !output.is_actionable() {
        bail!("incomplete agent output must send at least one message");
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_marked_json() {
        let text = format!(
            "noise\n{BEGIN}\n{{\"summary\":\"done\",\"messages\":[],\"complete\":true}}\n{END}"
        );
        let output = parse_output(&text).unwrap();
        assert_eq!(output.summary, "done");
        assert!(output.complete);
    }

    #[test]
    fn rejects_unmarked_output() {
        assert!(parse_output("{}").is_err());
    }
}
