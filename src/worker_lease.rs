use std::time::Duration;

use anyhow::Result;
use tokio::{
    sync::watch,
    time::{Interval, interval},
};

use crate::{
    models::{AgentOutput, Assignment, RunRequest},
    worker::WorkerContext,
};

pub(crate) struct LeaseRun {
    pub result: Result<AgentOutput>,
    pub pause_interrupted: bool,
    pub context_interrupted: bool,
}

pub(crate) async fn run_with_lease(
    ctx: &WorkerContext,
    task: &Assignment,
    request: RunRequest,
    cancel: watch::Sender<bool>,
) -> Result<LeaseRun> {
    let run = ctx.runner.run(request);
    tokio::pin!(run);
    let mut heartbeats = heartbeat(ctx);
    let mut cancellations = cancellation_poll(ctx);
    heartbeats.tick().await;
    cancellations.tick().await;
    loop {
        tokio::select! {
            result = &mut run => {
                return Ok(LeaseRun {
                    result,
                    pause_interrupted: false,
                    context_interrupted: false,
                });
            }
            _ = heartbeats.tick() => {
                if !ctx.store.renew_claim_generation(task).await?.applied() {
                    if ctx.runner.waits_for_terminal_stop()
                        && ctx.store.task_status(&task.id).await? == "completed"
                    {
                        return Ok(LeaseRun {
                            result: run.await,
                            pause_interrupted: false,
                            context_interrupted: false,
                        });
                    }
                    cancel.send_replace(true);
                    return Ok(LeaseRun {
                        result: run.await,
                        pause_interrupted: false,
                        context_interrupted: true,
                    });
                }
            }
            _ = cancellations.tick() => {
                if ctx.runner.waits_for_terminal_stop()
                    && ctx.store.task_status(&task.id).await? == "completed"
                {
                    continue;
                }
                if ctx.store.is_cancelled(&task.id).await? {
                    cancel.send_replace(true);
                    return Ok(LeaseRun {
                        result: run.await,
                        pause_interrupted: false,
                        context_interrupted: false,
                    });
                }
                if ctx.store.should_interrupt_for_context(&task.id, &ctx.worker.id).await? {
                    cancel.send_replace(true);
                    return Ok(LeaseRun {
                        result: run.await,
                        pause_interrupted: false,
                        context_interrupted: true,
                    });
                }
                if ctx.store.should_interrupt_for_pause(&task.id, &ctx.worker.id).await? {
                    cancel.send_replace(true);
                    return Ok(LeaseRun {
                        result: run.await,
                        pause_interrupted: true,
                        context_interrupted: false,
                    });
                }
            }
        }
    }
}

fn heartbeat(ctx: &WorkerContext) -> Interval {
    interval(Duration::from_millis(
        (ctx.policy.claim_lease_ms / 3).max(100),
    ))
}

fn cancellation_poll(ctx: &WorkerContext) -> Interval {
    interval(Duration::from_millis(
        ctx.policy.poll_interval_ms.clamp(25, 250),
    ))
}
