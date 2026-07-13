use std::fmt::Write;

use crate::models::TranscriptEntry;

pub fn markdown(entries: &[TranscriptEntry], full: bool) -> String {
    let mut text = String::from("# Cairn Harness Transcript\n\n");
    for entry in entries {
        writeln!(
            text,
            "## Turn {}: {} \n\n- Session: `{}`\n- From: `{}`\n- Topic: `{}`\n- Status: `{}`\n- Started: {}\n- Completed: {}\n",
            entry.sequence,
            entry.agent_id,
            entry.session_id,
            entry.inbound_sender,
            entry.inbound_topic,
            entry.status,
            entry.started_at,
            entry.completed_at
        )
        .unwrap();
        writeln!(text, "### Input\n\n{}\n", entry.inbound_body).unwrap();
        writeln!(text, "### Summary\n\n{}\n", entry.output.summary).unwrap();
        if !entry.output.tools.is_empty() {
            writeln!(text, "### Tools\n").unwrap();
            for tool in &entry.output.tools {
                writeln!(text, "- {tool}").unwrap();
            }
            text.push('\n');
        }
        if let Some(deliverable) = &entry.output.deliverable {
            writeln!(text, "### Deliverable\n\n{}\n", deliverable).unwrap();
        }
        if !entry.output.messages.is_empty() {
            writeln!(text, "### Handoffs\n").unwrap();
            for message in &entry.output.messages {
                writeln!(
                    text,
                    "- To `{}` / `{}`: {}",
                    message.to, message.topic, message.body
                )
                .unwrap();
            }
            text.push('\n');
        }
        if full {
            writeln!(text, "<details><summary>Full prompt</summary>\n\n```text").unwrap();
            writeln!(text, "{}", entry.prompt).unwrap();
            writeln!(text, "```\n</details>\n").unwrap();
        }
    }
    text
}
