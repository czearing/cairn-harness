use anyhow::Result;

use crate::{directory::resolve, models::AgentOutput, worker::WorkerContext};

pub async fn dispatch(ctx: &WorkerContext, source_id: &str, output: &AgentOutput) -> Result<()> {
    for (index, message) in output.messages.iter().enumerate() {
        let body = match &output.deliverable {
            Some(deliverable) => format!("{}\n\nDeliverable:\n{}", message.body, deliverable),
            None => message.body.clone(),
        };
        match resolve(&ctx.directory, &message.to) {
            Ok(recipients) => {
                for recipient in recipients {
                    ctx.store
                        .enqueue_keyed(
                            &format!("{source_id}:{index}:{recipient}"),
                            &ctx.worker.id,
                            &recipient,
                            &message.topic,
                            &body,
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
                        &body,
                        &error.to_string(),
                    )
                    .await?;
                tracing::warn!(agent = %ctx.worker.id, target = %message.to, %error, "message dead-lettered");
            }
        }
    }
    Ok(())
}
