use anyhow::Result;

use crate::{
    models::{AgentOutput, Message},
    transcript_store::TurnRecord,
    worker::WorkerContext,
};

#[allow(clippy::too_many_arguments)]
pub async fn record(
    ctx: &WorkerContext,
    message: &Message,
    session_id: &str,
    prompt: &str,
    output: &AgentOutput,
    status: &str,
    started_at: &str,
    completed_at: &str,
) -> Result<()> {
    ctx.store
        .record_turn(TurnRecord {
            message,
            worker: &ctx.worker,
            session_id,
            prompt,
            output,
            status,
            started_at,
            completed_at,
        })
        .await
}
