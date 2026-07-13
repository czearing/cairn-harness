use std::{path::PathBuf, time::Duration};

use anyhow::Result;
use cairn_harness::open;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "cairn-harness", version, about)]
struct Cli {
    #[arg(short, long, default_value = "project.json")]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Init,
    Send {
        #[arg(long)]
        to: String,
        #[arg(long)]
        topic: String,
        #[arg(long)]
        body: String,
    },
    Run {
        #[arg(long, default_value_t = 1_000)]
        idle_exit_ms: u64,
    },
    Status,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    let harness = open(&cli.config).await?;
    match cli.command {
        Command::Init => {
            harness.bootstrap().await?;
            println!("initialized {}", harness.config().name);
        }
        Command::Send { to, topic, body } => {
            harness.bootstrap().await?;
            let count = harness.send("human", &to, &topic, &body).await?;
            println!("queued {count} message(s)");
        }
        Command::Run { idle_exit_ms } => {
            harness
                .run_until_idle(Duration::from_millis(idle_exit_ms))
                .await?;
        }
        Command::Status => {
            harness.bootstrap().await?;
            println!(
                "{}",
                serde_json::to_string_pretty(&harness.status().await?)?
            );
        }
    }
    Ok(())
}
