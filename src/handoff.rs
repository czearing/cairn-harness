use anyhow::Result;

use crate::{directory::resolve, models::AgentOutput, worker::WorkerContext};

pub async fn dispatch(ctx: &WorkerContext, source_id: &str, output: &AgentOutput) -> Result<()> {
    for (index, message) in output.messages.iter().enumerate() {
        match resolve(&ctx.directory, &message.to) {
            Ok(recipients) => {
                for recipient in recipients {
                    ctx.store
                        .enqueue_keyed(
                            &format!("{source_id}:{index}:{recipient}"),
                            &ctx.worker.id,
                            &recipient,
                            &message.topic,
                            &message.body,
                        )
                        .await?;
                }
            }
            Err(error) => {
                ctx.store
                    .dead_letter(
                        &ctx.worker.id,
                        &message.to,
                        &message.topic,
                        &message.body,
                        &error.to_string(),
                    )
                    .await?;
                tracing::warn!(agent = %ctx.worker.id, target = %message.to, %error, "message dead-lettered");
            }
        }
    }
    Ok(())
}
