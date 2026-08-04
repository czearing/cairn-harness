use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

pub(crate) struct ActiveGuard(Arc<AtomicUsize>);

impl ActiveGuard {
    pub(crate) fn new(active: Arc<AtomicUsize>) -> Self {
        active.fetch_add(1, Ordering::SeqCst);
        Self(active)
    }
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
