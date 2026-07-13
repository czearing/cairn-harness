use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use anyhow::Result;
use tokio::{
    sync::{Semaphore, watch},
    time::{interval, sleep},
};

use crate::{
    config::ProjectConfig,
    directory::{Directory, resolve},
    models::{AgentOutput, Message, RunRequest, WorkerSpec},
    prompt,
    runner::AgentRunner,
    store::Store,
};

pub(crate) struct WorkerContext {
    pub config: ProjectConfig,
    pub worker: WorkerSpec,
    pub store: Store,
    pub runner: Arc<dyn AgentRunner>,
    pub directory: Arc<Directory>,
    pub gate: Arc<Semaphore>,
    pub active: Arc<AtomicUsize>,
    pub budget: Arc<AtomicUsize>,
    pub shutdown: watch::Receiver<bool>,
}

pub(crate) async fn run(mut ctx: WorkerContext) -> Result<()> {
    let poll = Duration::from_millis(ctx.config.team.poll_interval_ms);
    loop {
        if *ctx.shutdown.borrow() {
            return Ok(());
        }
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

async fn process(ctx: &WorkerContext, message: Message) -> Result<()> {
    let _active = ActiveGuard::new(ctx.active.clone());
    if !take_budget(&ctx.budget) {
        ctx.store.finish(&message.id, "deferred", None).await?;
        ctx.store
            .set_state(&ctx.worker.id, "budget-exhausted", None)
            .await?;
        return Ok(());
    }
    ctx.store
        .set_state(&ctx.worker.id, "working", Some(&message.topic))
        .await?;
    let state = ctx.store.agent(&ctx.worker.id).await?;
    let states = ctx.store.states().await?;
    let request = RunRequest {
        project_root: ctx.config.root.clone(),
        worker: ctx.worker.clone(),
        session_id: state.session_id,
        prompt: prompt::build(&ctx.config, &ctx.worker, &states, &message),
    };
    let permit = ctx.gate.clone().acquire_owned().await?;
    let result = run_with_lease(ctx, &message.id, request).await;
    drop(permit);
    match result {
        Ok(output) if output.is_actionable() => {
            dispatch(ctx, &output).await?;
            ctx.store.finish(&message.id, "completed", None).await?;
            ctx.store.set_state(&ctx.worker.id, "idle", None).await?;
        }
        Ok(_) => handle_failure(ctx, &message, "agent returned no next action").await?,
        Err(error) => handle_failure(ctx, &message, &error.to_string()).await?,
    }
    Ok(())
}

async fn run_with_lease(
    ctx: &WorkerContext,
    message_id: &str,
    request: RunRequest,
) -> Result<AgentOutput> {
    let run = ctx.runner.run(request);
    tokio::pin!(run);
    let heartbeat = Duration::from_millis((ctx.config.team.claim_lease_ms / 3).max(100));
    let mut ticks = interval(heartbeat);
    ticks.tick().await;
    loop {
        tokio::select! {
            result = &mut run => return result,
            _ = ticks.tick() => {
                ctx.store.renew_claim(message_id, &ctx.worker.id).await?;
            }
        }
    }
}

async fn dispatch(ctx: &WorkerContext, output: &AgentOutput) -> Result<()> {
    for message in &output.messages {
        match resolve(&ctx.directory, &message.to) {
            Ok(recipients) => {
                for recipient in recipients {
                    ctx.store
                        .enqueue(&ctx.worker.id, &recipient, &message.topic, &message.body)
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

async fn handle_failure(ctx: &WorkerContext, message: &Message, error: &str) -> Result<()> {
    if message.attempts < ctx.config.team.max_attempts {
        ctx.store.retry(&message.id, error).await?;
        ctx.store.set_state(&ctx.worker.id, "idle", None).await?;
    } else {
        ctx.store.finish(&message.id, "failed", Some(error)).await?;
        ctx.store.set_state(&ctx.worker.id, "failed", None).await?;
    }
    tracing::error!(agent = %ctx.worker.id, %error, "agent run failed");
    Ok(())
}

fn take_budget(budget: &AtomicUsize) -> bool {
    budget
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
            value.checked_sub(1)
        })
        .is_ok()
}

struct ActiveGuard(Arc<AtomicUsize>);

impl ActiveGuard {
    fn new(active: Arc<AtomicUsize>) -> Self {
        active.fetch_add(1, Ordering::SeqCst);
        Self(active)
    }
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
