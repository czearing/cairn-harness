use super::{collect_tasks::pr_review_cycle, service_levels::stats};

#[test]
fn latency_stats_report_percentiles_and_breaches() {
    let value = stats(vec![1_000, 2_000, 3_000, 20_000], 10_000);
    assert_eq!(value.samples, 4);
    assert_eq!(value.p50_ms, Some(2_000));
    assert_eq!(value.p95_ms, Some(20_000));
    assert_eq!(value.max_ms, Some(20_000));
    assert_eq!(value.breaches, 1);
}

#[test]
fn service_levels_include_runner_and_direct_pr_review_tasks() {
    assert!(
        pr_review_cycle("Review Azure DevOps pull request #42: Fix\nSource commit: abc").is_some()
    );
    assert!(pr_review_cycle(
        "Review this PR https://office.visualstudio.com/OC/_git/office-bohemia/pullrequest/5511308"
    )
    .is_some());
    assert!(pr_review_cycle("Review Azure DevOps pull request #42: Fix").is_none());
    assert!(
        pr_review_cycle("Review Azure DevOps pull request #bad: Fix\nSource commit: abc").is_none()
    );
}
