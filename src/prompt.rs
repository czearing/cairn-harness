use std::fmt::Write;

use crate::{
    config::ProjectConfig,
    models::{AgentState, Message, WorkerSpec},
    protocol::{BEGIN, END},
};

pub fn build(
    config: &ProjectConfig,
    worker: &WorkerSpec,
    states: &[AgentState],
    message: &Message,
) -> String {
    let mut prompt = String::new();
    writeln!(prompt, "# Cairn Harness Assignment").unwrap();
    writeln!(prompt, "Project: {}", config.name).unwrap();
    writeln!(prompt, "You are {} ({})", worker.id, worker.role).unwrap();
    writeln!(prompt, "Contract: {}", worker.contract).unwrap();
    writeln!(prompt, "Owned areas: {}", worker.owns.join(", ")).unwrap();
    writeln!(
        prompt,
        "Use the configured Cairn tools: search the brain before work and record durable findings."
    )
    .unwrap();
    writeln!(prompt, "\n## Team contracts").unwrap();
    for role in &config.team.roles {
        writeln!(
            prompt,
            "- {} x{} owns [{}]: {}",
            role.name,
            role.instances,
            role.owns.join(", "),
            role.contract
        )
        .unwrap();
    }
    writeln!(prompt, "\n## Current activity").unwrap();
    for state in states {
        writeln!(
            prompt,
            "- {} ({}) is {} on {}",
            state.agent_id,
            state.role,
            state.status,
            state.current_topic.as_deref().unwrap_or("nothing")
        )
        .unwrap();
    }
    writeln!(prompt, "\n## Inbox message").unwrap();
    writeln!(prompt, "From: {}", message.sender).unwrap();
    writeln!(prompt, "Topic: {}", message.topic).unwrap();
    writeln!(prompt, "Body:\n{}", message.body).unwrap();
    writeln!(
        prompt,
        "\nWork independently within your contract. Send messages whenever another role needs context, a decision, or work."
    )
    .unwrap();
    writeln!(
        prompt,
        "Finish with exactly one JSON envelope between these markers:\n{BEGIN}\n{{\"summary\":\"...\",\"messages\":[{{\"to\":\"role-or-agent\",\"topic\":\"...\",\"body\":\"...\"}}],\"complete\":false}}\n{END}"
    )
    .unwrap();
    prompt
}
