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
    writeln!(prompt, "Project: {}", config.name).unwrap();
    writeln!(prompt, "Agent: {}", worker.id).unwrap();
    writeln!(prompt, "Activity:").unwrap();
    for state in states {
        writeln!(
            prompt,
            "{}: {} ({})",
            state.agent_id,
            state.status,
            state.current_topic.as_deref().unwrap_or("idle")
        )
        .unwrap();
    }
    writeln!(prompt, "From: {}", message.sender).unwrap();
    writeln!(prompt, "Topic: {}", message.topic).unwrap();
    writeln!(prompt, "Input:\n{}", message.body).unwrap();
    writeln!(
        prompt,
        "Return one JSON envelope. No em dashes.\n{BEGIN}\n{{\"summary\":\"...\",\"deliverable\":\"... or null\",\"messages\":[{{\"to\":\"agent\",\"topic\":\"...\",\"body\":\"...\"}}],\"complete\":true}}\n{END}"
    )
    .unwrap();
    prompt
}
