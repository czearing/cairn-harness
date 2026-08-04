mod collect_db;
mod collect_runtime;
mod collect_sessions;
mod collect_system;
mod collect_tasks;
mod detect;
mod finding;
pub mod format;
pub mod model;
mod outcome_metrics;
mod quality_metrics;
mod rules;
mod service_levels;
#[cfg(test)]
mod service_levels_tests;
mod session_events;
mod session_metrics;
mod store;
mod util;
pub mod version;

use anyhow::{Result, bail};
use chrono::{Duration, Utc};

use crate::{config::ProjectConfig, store::Store};

use model::{Finding, OutcomeMetrics, QualityMetrics, Report};

pub async fn report(config: &ProjectConfig, store: &Store, hours: u32) -> Result<Report> {
    if hours == 0 || hours > 24 * 30 {
        bail!("hours must be between 1 and 720");
    }
    let cutoff_time = Utc::now() - Duration::hours(hours as i64);
    let cutoff = cutoff_time.to_rfc3339();
    let mut events = collect_db::collect(config, store, &cutoff).await?;
    events.extend(collect_sessions::collect(config, cutoff_time)?);
    events.extend(collect_system::collect(config).await?);
    let running_version = version::running_identity(config, store).await?;
    let current_version = version::identity();
    if running_version.worker.is_some()
        && running_version.executable_sha256 != current_version.executable_sha256
    {
        events.push(model::Event {
            event_key: util::key(&[
                "version_drift",
                &running_version.executable_sha256,
                &current_version.executable_sha256,
            ]),
            timestamp: Utc::now().to_rfc3339(),
            source: "version".into(),
            category: "availability".into(),
            code: "version_drift".into(),
            severity: "warning".into(),
            project: config.name.clone(),
            agent: None,
            task_id: None,
            session_id: None,
            duration_ms: None,
            input_tokens: None,
            output_tokens: None,
            cost_nano_aiu: None,
            value: None,
            detail: Some(format!(
                "running={} current={}",
                running_version.display, current_version.display
            )),
            pointer: None,
        });
    }
    for event in &events {
        store.record_telemetry_event(event).await?;
    }
    let active_since = running_version
        .worker
        .as_ref()
        .and_then(|worker| chrono::DateTime::parse_from_rfc3339(&worker.started_at).ok())
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or(cutoff_time)
        .max(cutoff_time)
        .max(Utc::now() - Duration::hours(6));
    let findings = detect::detect(&events, active_since);
    store.sync_telemetry_findings(&findings).await?;
    store.prune_telemetry().await?;
    let active = store.active_telemetry_findings().await?;
    let quality = QualityMetrics::from_events(&events);
    let outcomes = OutcomeMetrics::from_events(&events);
    let service_levels = service_levels::collect(store, &cutoff).await?;
    let summary = if active.is_empty() {
        detect::healthy_summary(hours, events.len())
    } else {
        format!(
            "findings={} events={} window={}h",
            active.len(),
            events.len(),
            hours
        )
    };
    Ok(Report {
        generated_at: Utc::now().to_rfc3339(),
        window_hours: hours,
        version: running_version,
        event_count: events.len(),
        quality,
        outcomes,
        service_levels,
        findings: active,
        summary,
    })
}

pub async fn inspect(
    config: &ProjectConfig,
    store: &Store,
    hours: u32,
    id: &str,
) -> Result<Finding> {
    let _ = report(config, store, hours).await?;
    store
        .telemetry_finding(id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("finding not found: {id}"))
}

pub async fn print(
    config: &ProjectConfig,
    store: &Store,
    hours: u32,
    id: Option<&str>,
    json: bool,
) -> Result<()> {
    if let Some(id) = id {
        let finding = inspect(config, store, hours, id).await?;
        if json {
            println!("{}", serde_json::to_string_pretty(&finding)?);
        } else {
            println!("{}", format::inspect(&finding));
        }
    } else {
        let report = report(config, store, hours).await?;
        if json {
            println!("{}", serde_json::to_string_pretty(&report)?);
        } else {
            println!("{}", format::report(&report));
        }
    }
    Ok(())
}
