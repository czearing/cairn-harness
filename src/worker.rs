pub(crate) use crate::worker_context::WorkerContext;
use crate::{
    models::{Assignment, RunRequest},
    prompt, turn,
    worker_config::{live_config, refresh_config},
    worker_lease::{LeaseRun, run_with_lease},
    worker_result::finish_result,
    worker_runtime::{accept_committed, accept_delegated_failure, take_budget},
};
use std::time::Duration;
use tokio::sync::watch;
use tokio::time::sleep;
use {anyhow::Result, chrono::Utc};
pub(crate) async fn run(mut ctx: WorkerContext) -> Result<()> {
    let poll = Duration::from_millis(ctx.policy.poll_interval_ms);
    let mut config_mtime = None;
    loop {
        if *ctx.shutdown.borrow() {
            return Ok(());
        }
        refresh_config(&mut ctx, &mut config_mtime)?;
        if let Some(message) = ctx.store.claim(&ctx.worker.id).await? {
            process(&ctx, message).await?;
        } else {
            tokio::select! {
                _ = sleep(poll) => {}
                changed = ctx.shutdown.changed() => {
                    if changed.is_err() || *ctx.shutdown.borrow() {
                        return Ok(());
                    }
                }
            }
        }
    }
}

pub(crate) async fn process(ctx: &WorkerContext, task: Assignment) -> Result<()> {
    let _active = crate::worker_active::ActiveGuard::new(ctx.active.clone());
    if !take_budget(&ctx.budget) {
        if ctx.store.defer_unstarted_generation(&task).await?.applied() {
            let _ = ctx
                .store
                .set_state_after_claim(&task, "budget-exhausted")
                .await?;
        }
        return Ok(());
    }
    let permit = ctx.gate.clone().acquire_owned().await?;
    let (config, worker) = match live_config(ctx) {
        Ok(live) => live,
        Err(error) => {
            if !ctx.store.defer_unstarted_generation(&task).await?.applied() {
                return Ok(());
            }
            return Err(error);
        }
    };
    if !ctx.store.set_working_for_claim(&task).await?.applied() {
        return Ok(());
    }
    let state = ctx.store.agent(&worker.id).await?;
    let children = ctx.store.terminal_children(&task.id).await?;
    let runtime_context = ctx.store.runtime_context(&task, config.leader()).await?;
    let composed = prompt::build(&config, &worker, &task, &children, &runtime_context);
    let requested_session_id = state.session_id;
    let prior_context = if task.is_dashboard_message() {
        Some(ctx.store.agent_context(&worker.id).await?)
    } else {
        None
    };
    let (cancel, cancellation) = watch::channel(false);
    let delivered = crate::models::DeliveredPrompt::default();
    let fallback_prompt = composed.full();
    let request = RunRequest {
        project_root: config.root.clone(),
        worker,
        session_id: requested_session_id,
        composed,
        prior_context,
        delivered: delivered.clone(),
        cancellation,
    };
    let started_at = Utc::now().to_rfc3339();
    let lease_run = match run_with_lease(ctx, &task, request, cancel).await {
        Ok(lease_run) => lease_run,
        Err(error) => LeaseRun {
            result: Err(error),
            pause_interrupted: false,
            context_interrupted: false,
        },
    };
    drop(permit);
    // turns.prompt must hold the bytes the agent actually received, which is no longer
    // the composed prompt once unchanged sections are withheld from a live session.
    let prompt = delivered.get().unwrap_or(fallback_prompt);
    if lease_run.context_interrupted {
        let _ = ctx.store.set_state_after_claim(&task, "idle").await?;
        return Ok(());
    }
    let pause_interrupted = lease_run.pause_interrupted
        || ctx
            .store
            .should_interrupt_for_pause(&task.id, &ctx.worker.id)
            .await?;
    let result = lease_run.result;
    if ctx
        .store
        .should_interrupt_for_context(&task.id, &ctx.worker.id)
        .await?
    {
        let _ = ctx.store.set_state_after_claim(&task, "idle").await?;
        return Ok(());
    }
    if !ctx.store.generation_is_current(&task).await? {
        return Ok(());
    }
    let session_id = ctx.store.agent(&ctx.worker.id).await?.session_id;
    let completed_at = Utc::now().to_rfc3339();
    if accept_committed(
        ctx,
        &task,
        &session_id,
        &prompt,
        &result,
        &started_at,
        &completed_at,
    )
    .await?
    {
        return Ok(());
    }
    if !ctx.store.claim_is_current(&task).await? && ctx.store.is_cancelled(&task.id).await? {
        let _ = ctx.store.set_state_after_claim(&task, "idle").await?;
        return Ok(());
    }
    if ctx.store.is_cancelled(&task.id).await? {
        let _ = ctx.store.set_state_after_claim(&task, "idle").await?;
        return Ok(());
    }
    if pause_interrupted {
        if ctx.store.is_agent_paused(&ctx.worker.id).await? {
            let _ = ctx.store.set_state_after_claim(&task, "paused").await?;
        }
        return Ok(());
    }
    if ctx.store.is_agent_paused(&ctx.worker.id).await? {
        if let Ok(output) = &result {
            turn::record(
                ctx,
                &task,
                &session_id,
                &prompt,
                output,
                "paused",
                &started_at,
                &completed_at,
            )
            .await?;
        }
        let _ = ctx.store.set_state_after_claim(&task, "paused").await?;
        return Ok(());
    }
    if accept_delegated_failure(
        ctx,
        &task,
        &session_id,
        &prompt,
        &result,
        &started_at,
        &completed_at,
    )
    .await?
    {
        return Ok(());
    }
    finish_result(
        ctx,
        &task,
        &session_id,
        &prompt,
        result,
        &started_at,
        &completed_at,
    )
    .await?;
    Ok(())
}
