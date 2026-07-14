use anyhow::{Context, Result, bail};

use crate::models::AgentOutput;

pub const BEGIN: &str = "CAIRN_ENVELOPE_BEGIN";
pub const END: &str = "CAIRN_ENVELOPE_END";

pub fn parse_output(text: &str) -> Result<AgentOutput> {
    let Some(marker) = text.find(BEGIN) else {
        let deliverable = text.trim();
        if deliverable.is_empty() {
            bail!("empty agent output");
        }
        return Ok(AgentOutput {
            summary: "Completed deliverable.".into(),
            deliverable: Some(deliverable.into()),
            messages: Vec::new(),
            tools: Vec::new(),
            complete: true,
        });
    };
    let start = marker + BEGIN.len();
    let tail = &text[start..];
    let end = tail.find(END).context("missing envelope end marker")?;
    let payload = tail[..end].trim();
    if payload.is_empty() {
        bail!("empty agent envelope");
    }
    let output: AgentOutput = match serde_json::from_str(payload)
        .or_else(|_| serde_json::from_str(&escape_string_controls(payload)))
    {
        Ok(output) => output,
        Err(_error) if has_no_messages(payload) => AgentOutput {
            summary: "Completed deliverable.".into(),
            deliverable: Some(salvage_deliverable(payload)),
            messages: Vec::new(),
            tools: Vec::new(),
            complete: true,
        },
        Err(error) => return Err(error).context("invalid agent envelope JSON"),
    };
    if !output.is_valid() {
        bail!("agent output contains an em dash");
    }

    fn has_no_messages(payload: &str) -> bool {
        let compact: String = payload
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect();
        compact.contains("\"messages\":[]")
    }

    fn salvage_deliverable(payload: &str) -> String {
        let Some(start) = payload.find("\"deliverable\"") else {
            return payload.trim().into();
        };
        let value = &payload[start + "\"deliverable\"".len()..];
        let value = value
            .trim_start_matches(|character: char| character == ':' || character.is_whitespace())
            .trim_start_matches('"');
        let end = value
            .rfind("\"messages\"")
            .and_then(|index| value[..index].rfind(','))
            .unwrap_or(value.len());
        value[..end]
            .trim()
            .trim_end_matches('"')
            .replace("\\n", "\n")
    }

    fn escape_string_controls(payload: &str) -> String {
        let mut output = String::with_capacity(payload.len());
        let mut in_string = false;
        let mut escaped = false;
        for character in payload.chars() {
            if in_string && !escaped {
                match character {
                    '\n' => {
                        output.push_str("\\n");
                        continue;
                    }
                    '\r' => {
                        output.push_str("\\r");
                        continue;
                    }
                    '\t' => {
                        output.push_str("\\t");
                        continue;
                    }
                    _ => {}
                }
            }
            output.push(character);
            if character == '"' && !escaped {
                in_string = !in_string;
            }
            escaped = character == '\\' && !escaped;
            if character != '\\' {
                escaped = false;
            }
        }
        output
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_marked_json() {
        let text = format!(
            "noise\n{BEGIN}\n{{\"summary\":\"done\",\"deliverable\":null,\"messages\":[],\"complete\":true}}\n{END}"
        );
        let output = parse_output(&text).unwrap();
        assert_eq!(output.summary, "done");
        assert!(output.complete);
    }

    #[test]
    fn accepts_plain_deliverable() {
        let output = parse_output("final text").unwrap();
        assert_eq!(output.deliverable.as_deref(), Some("final text"));
    }

    #[test]
    fn parses_raw_multiline_strings() {
        let text = format!(
            "{BEGIN}\n{{\"summary\":\"done\",\"deliverable\":\"line one\nline two\",\"messages\":[],\"complete\":true}}\n{END}"
        );
        let output = parse_output(&text).unwrap();
        assert_eq!(output.deliverable.as_deref(), Some("line one\nline two"));
    }

    #[test]
    fn accepts_waiting_envelope_without_messages() {
        let text = format!(
            "{BEGIN}\n{{\"summary\":\"Waiting for review.\",\"deliverable\":null,\"messages\":[],\"complete\":false}}\n{END}"
        );
        let output = parse_output(&text).unwrap();
        assert!(output.is_waiting());
    }

    #[test]
    fn salvages_terminal_prose_with_quotes() {
        let text = format!(
            "{BEGIN}\n{{\"summary\":\"done\",\"deliverable\":\"She said \"go\".\",\"messages\":[],\"complete\":true}}\n{END}"
        );
        let output = parse_output(&text).unwrap();
        assert!(output.deliverable.unwrap().contains("She said \"go\"."));
    }
}
