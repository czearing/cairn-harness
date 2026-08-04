use anyhow::Result;
use clap::Subcommand;

#[derive(Subcommand)]
pub enum Command {
    Complete {
        #[arg(long)]
        result: String,
    },
    Delegate {
        #[arg(long)]
        to: String,
        #[arg(long)]
        topic: String,
        #[arg(long)]
        body: String,
        #[arg(long)]
        capability: Option<String>,
    },
    Message {
        #[arg(long)]
        to: String,
        #[arg(long)]
        topic: String,
        #[arg(long)]
        body: String,
    },
}

pub async fn run(command: &Command) -> Result<()> {
    let (name, arguments) = match command {
        Command::Complete { result } => ("task_complete", serde_json::json!({"result":result})),
        Command::Delegate {
            to,
            topic,
            body,
            capability,
        } => (
            "task_delegate",
            serde_json::json!({
                "to":to,
                "topic":topic,
                "body":body,
                "capability":capability
            }),
        ),
        Command::Message { to, topic, body } => (
            "message_send",
            serde_json::json!({"to":to,"topic":topic,"body":body}),
        ),
    };
    println!(
        "{}",
        cairn_harness::mcp_server::invoke_from_environment(name, arguments).await?
    );
    Ok(())
}
