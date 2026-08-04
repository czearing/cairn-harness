use std::{path::PathBuf, time::Duration};

use anyhow::Result;
use cairn_harness::open;
use clap::{Parser, Subcommand};

mod agent_tool_cli;

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
    #[command(hide = true)]
    Mcp,
    #[command(hide = true)]
    AgentTool {
        #[command(subcommand)]
        command: agent_tool_cli::Command,
    },
    Install,
    Init,
    Ingest,
    Replenish,
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
    Step,
    Watch {
        #[arg(long)]
        releases: Option<i64>,
    },
    Status,
    Transcript {
        #[arg(long)]
        full: bool,
        #[arg(long)]
        json: bool,
    },
    Telemetry {
        #[command(subcommand)]
        command: Option<TelemetryCommand>,
        #[arg(long, default_value_t = 24, global = true)]
        hours: u32,
        #[arg(long, global = true)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum TelemetryCommand {
    Inspect { id: String },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    if matches!(cli.command, Command::Mcp) {
        return cairn_harness::mcp_server::run().await;
    }
    if let Command::AgentTool { command } = &cli.command {
        return agent_tool_cli::run(command).await;
    }
    if matches!(cli.command, Command::Install) {
        for file in cairn_harness::skill::install()? {
            println!("installed {}", file.display());
        }
        return Ok(());
    }
    let harness = open(&cli.config).await?;
    match cli.command {
        Command::Mcp => unreachable!(),
        Command::AgentTool { .. } => unreachable!(),
        Command::Install => unreachable!(),
        Command::Init => {
            harness.bootstrap().await?;
            println!("initialized {}", harness.config().name);
        }
        Command::Ingest => {
            harness.bootstrap().await?;
            println!("ingested {} task(s)", harness.ingest_work().await?);
        }
        Command::Replenish => {
            harness.bootstrap().await?;
            println!("seeded={}", harness.replenish().await?);
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
        Command::Step => {
            harness.run_steps(1, Duration::from_millis(100)).await?;
        }
        Command::Watch { releases } => {
            if let Some(target) = releases {
                harness.watch_until(target).await?;
            } else {
                harness.watch().await?;
            }
        }
        Command::Status => {
            harness.bootstrap().await?;
            println!(
                "{}",
                serde_json::to_string_pretty(&harness.status().await?)?
            );
        }
        Command::Transcript { full, json } => {
            harness.bootstrap().await?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&harness.store().transcript().await?)?
                );
            } else {
                print!("{}", harness.transcript(full).await?);
            }
        }
        Command::Telemetry {
            command,
            hours,
            json,
        } => {
            let id = command.map(|TelemetryCommand::Inspect { id }| id);
            cairn_harness::telemetry::print(
                harness.config(),
                harness.store(),
                hours,
                id.as_deref(),
                json,
            )
            .await?;
        }
    }
    Ok(())
}
