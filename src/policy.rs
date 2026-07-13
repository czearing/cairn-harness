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
            poll_interval_ms: 50,
        }
    }
}
