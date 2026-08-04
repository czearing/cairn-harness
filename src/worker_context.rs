use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicUsize},
};

use tokio::sync::{Semaphore, watch};

use crate::{
    config::ProjectConfig, models::WorkerSpec, policy::RuntimePolicy, runner::AgentRunner,
    store::Store,
};

pub(crate) struct WorkerContext {
    pub config: ProjectConfig,
    pub config_path: Option<PathBuf>,
    pub worker: WorkerSpec,
    pub store: Store,
    pub runner: Arc<dyn AgentRunner>,
    pub gate: Arc<Semaphore>,
    pub active: Arc<AtomicUsize>,
    pub budget: Arc<AtomicUsize>,
    pub policy: RuntimePolicy,
    pub shutdown: watch::Receiver<bool>,
}
