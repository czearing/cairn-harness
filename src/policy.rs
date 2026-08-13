#[derive(Clone, Debug)]
pub struct RuntimePolicy {
    pub max_concurrency: usize,
    pub max_runs_per_start: usize,
    pub max_attempts: u32,
    pub claim_lease_ms: u64,
    pub poll_interval_ms: u64,
}

impl RuntimePolicy {
    pub fn for_workers(workers: usize) -> Self {
        Self {
            max_concurrency: workers,
            max_runs_per_start: workers.saturating_mul(8).max(8),
            max_attempts: 3,
            claim_lease_ms: 60_000,
            // Each idle worker's poll tick issues a BEGIN IMMEDIATE claim transaction against a
            // single-writer SQLite file. At 50ms, 3+ concurrent workers on one project produced
            // sustained lock contention (busy_timeout retries) that showed up as 400%+ sustained
            // CPU and multi-second "slow statement" warnings even with no actual work to claim.
            // 200ms cuts claim-attempt frequency 4x with no perceptible effect on task pickup
            // latency (agent turns themselves run for seconds to minutes).
            poll_interval_ms: 200,
        }
    }
}
