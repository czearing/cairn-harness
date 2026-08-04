use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::Result;

use crate::{
    models::{AgentOutput, Assignment},
    release, turn,
    worker::WorkerContext,
};

pub(crate) async fn handle_failure(
    ctx: &WorkerContext,
    task: &Assignment,
    error: &str,
) -> Result<()> {
    if task.attempts < ctx.policy.max_attempts {
        if !ctx.store.retry_claim(task, error).await?.applied() {
            return Ok(());
        }
        let _ = ctx.store.set_state_after_claim(task, "idle").await?;
        ctx.store
            .record_runtime_event(
                "task_retry",
                "warning",
                Some(&ctx.worker.id),
                Some(&task.id),
                None,
                error,
            )
            .await?;
    } else {
        if !ctx
            .store
            .finish_claim(task, "failed", Some(error))
            .await?
            .applied()
        {
            return Ok(());
        }
        let _ = ctx.store.set_state_after_claim(task, "failed").await?;
        ctx.store
            .record_runtime_event(
                "task_failed",
                "error",
                Some(&ctx.worker.id),
                Some(&task.id),
                None,
                error,
            )
            .await?;
    }

    tracing::error!(agent = %ctx.worker.id, %error, "agent run failed");
    Ok(())
}

pub(crate) async fn accept_committed(
    ctx: &WorkerContext,
    task: &Assignment,
    session_id: &str,
    prompt: &str,
    result: &Result<AgentOutput>,
    started_at: &str,
    completed_at: &str,
) -> Result<bool> {
    if !ctx.store.generation_is_current(task).await?
        || ctx.store.task_status(&task.id).await? != "completed"
    {
        return Ok(false);
    }
    let committed_result = ctx.store.task_result(&task.id).await?;
    let mut output = match result {
        Ok(output) => output.clone(),
        Err(error) => AgentOutput {
            summary: format!("{error:#}"),
            deliverable: None,
            tools: Vec::new(),
            complete: false,
        },
    };
    output.complete = true;
    output.summary = format!("Completed: {}", task.topic);
    output.deliverable = Some(committed_result);
    turn::record(
        ctx,
        task,
        session_id,
        prompt,
        &output,
        "completed",
        started_at,
        completed_at,
    )
    .await?;
    release::publish(&ctx.config, &ctx.store, task).await?;
    if !ctx.store.is_agent_paused(&ctx.worker.id).await? {
        let _ = ctx.store.set_state_after_claim(task, "idle").await?;
    }
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn accept_delegated_failure(
    ctx: &WorkerContext,
    task: &Assignment,
    session_id: &str,
    prompt: &str,
    result: &Result<AgentOutput>,
    started_at: &str,
    completed_at: &str,
) -> Result<bool> {
    if result.is_ok() {
        return Ok(false);
    }
    let status = ctx.store.task_status(&task.id).await?;
    let open = ctx.store.has_open_children(&task.id).await?;
    let delegated = open || (status == "pending" && ctx.store.has_children(&task.id).await?);
    if !delegated {
        return Ok(false);
    }
    let output = AgentOutput {
        summary: ctx.store.delegation_summary(&task.id).await?,
        deliverable: None,
        tools: Vec::new(),
        complete: false,
    };
    turn::record(
        ctx,
        task,
        session_id,
        prompt,
        &output,
        "waiting",
        started_at,
        completed_at,
    )
    .await?;
    if open {
        if !ctx.store.wait_for_children_claim(task).await?.applied() {
            return Ok(true);
        }
    }
    let _ = ctx.store.set_state_after_claim(task, "idle").await?;
    Ok(true)
}

pub(crate) async fn handle_run_error(
    ctx: &WorkerContext,
    task: &Assignment,
    session_id: &str,
    prompt: &str,
    error: &anyhow::Error,
    started_at: &str,
    completed_at: &str,
) -> Result<()> {
    let detail = format!("{error:#}");
    let turn_status = failure_turn_status(task, ctx.policy.max_attempts);
    let output = AgentOutput {
        summary: detail.clone(),
        deliverable: None,
        tools: Vec::new(),
        complete: false,
    };
    turn::record(
        ctx,
        task,
        session_id,
        prompt,
        &output,
        turn_status,
        started_at,
        completed_at,
    )
    .await?;
    handle_failure(ctx, task, &detail).await
}

pub(crate) fn failure_turn_status(task: &Assignment, max_attempts: u32) -> &'static str {
    if task.attempts < max_attempts {
        "retrying"
    } else {
        "failed"
    }
}

pub(crate) fn take_budget(budget: &AtomicUsize) -> bool {
    budget
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
            value.checked_sub(1)
        })
        .is_ok()
}
