use anyhow::Result;

use crate::{
    models::{AgentOutput, Assignment},
    turn,
    worker::WorkerContext,
    worker_runtime::{failure_turn_status, handle_failure, handle_run_error},
};

pub(crate) async fn finish_result(
    ctx: &WorkerContext,
    task: &Assignment,
    session_id: &str,
    prompt: &str,
    result: Result<AgentOutput>,
    started_at: &str,
    completed_at: &str,
) -> Result<()> {
    match result {
        Ok(mut output) => {
            let status = ctx.store.task_status(&task.id).await?;
            let generated = task.kind == "generator" && ctx.store.generated_task(&task.id).await?;
            let message = task.is_message();
            let open_children = ctx.store.has_open_children(&task.id).await?;
            let delegated =
                open_children || (status == "pending" && ctx.store.has_children(&task.id).await?);
            let host_completed =
                status != "completed" && !generated && !message && !delegated && output.complete;
            let turn_status = if status == "completed" || generated || message {
                "completed"
            } else if delegated {
                output.summary = ctx.store.delegation_summary(&task.id).await?;
                output.deliverable = None;
                output.complete = false;
                "waiting"
            } else if host_completed {
                "completed"
            } else {
                let error = "agent returned without a committed task transition";
                output.summary = if output.summary.trim().is_empty() {
                    error.into()
                } else {
                    format!("{}\n\nAttempt error: {error}", output.summary.trim())
                };
                failure_turn_status(&task, ctx.policy.max_attempts)
            };
            turn::record(
                ctx,
                &task,
                &session_id,
                &prompt,
                &output,
                turn_status,
                &started_at,
                &completed_at,
            )
            .await?;
            if generated {
                if !ctx
                    .store
                    .finish_claim(&task, "completed", None)
                    .await?
                    .applied()
                {
                    return Ok(());
                }
            } else if open_children {
                if !ctx.store.wait_for_children_claim(&task).await?.applied() {
                    return Ok(());
                }
            } else if message {
                if !ctx
                    .store
                    .complete_claim(
                        &task,
                        output.deliverable.as_deref().unwrap_or(&output.summary),
                    )
                    .await?
                    .applied()
                {
                    return Ok(());
                }
            } else if host_completed {
                if !ctx
                    .store
                    .complete_claim(
                        &task,
                        output.deliverable.as_deref().unwrap_or(&output.summary),
                    )
                    .await?
                    .applied()
                {
                    return Ok(());
                }
            } else if status != "completed" && !delegated {
                handle_failure(
                    ctx,
                    &task,
                    "agent returned without a committed task transition",
                )
                .await?;
                return Ok(());
            }
            let _ = ctx.store.set_state_after_claim(&task, "idle").await?;
        }
        Err(error) => {
            handle_run_error(
                ctx,
                &task,
                &session_id,
                &prompt,
                &error,
                &started_at,
                &completed_at,
            )
            .await?;
        }
    }
    Ok(())
}
