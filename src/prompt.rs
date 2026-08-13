use std::fmt::Write;

use crate::{
    config::ProjectConfig,
    models::{Assignment, ChildResult, WorkerSpec},
};

const AUTONOMOUS_COMPLETION: &str = "Finish this assignment completely in this turn. You hold full decision authority: never ask a question, request approval, offer Caleb options, or wait on his input, and never end the turn with in-scope work you identified left undone, deferred, or offered as optional. Resolve every ambiguity by choosing the strongest option and stating the choice you made. If an obstacle stops you, exhaust every alternative approach before accepting it, then report it as a finished investigation with exact evidence rather than as a question or a request for direction.";

pub fn build(
    config: &ProjectConfig,
    worker: &WorkerSpec,
    task: &Assignment,
    children: &[ChildResult],
    runtime_context: &str,
) -> String {
    let mut prompt = String::new();
    let leader_conversation = task.is_dashboard_message() && worker.id == config.leader();
    if leader_conversation {
        writeln!(
            prompt,
            "<system_reminder>\nDirect conversation mode. Answer Caleb conversationally. Do not treat this message as project work, run the repository workflow, or use tools unless he explicitly asks for implementation or task creation. When he asks for work, load the required Cairn Harness skill, confirm GET /api/projects with PowerShell, then POST one complete task to /api/projects/{{projectId}}/work-items. Do not stop after loading the skill and do not depend on the deferred task_create tool. Never use sql, todos, todo_deps, or inbox_entries as a work queue, and never claim work is queued unless the work-items POST succeeded. Never expose private chain-of-thought; share concise rationale, visible progress, and outcomes.\n</system_reminder>"
        )
        .unwrap();
    }
    writeln!(prompt, "Role: {}. {}", worker.description, worker.prompt).unwrap();
    // Search guidance is operational advice for an agent doing repository work. A generator
    // turn only files a task, and anything Harness writes here has been observed getting
    // copied verbatim into the body the agent files, so it is withheld from that turn.
    if task.kind != "generator" {
        writeln!(
            prompt,
            "Use repository-native search tools. Start from changed files, referenced symbols, and exact import targets. Never recursively scan a drive, user profile, or workspace parent. Never scan a dependency tree, build output, or an entire monorepo; constrain each search to exact source or package directories, use narrow globs, and split broad queries."
        )
        .unwrap();
    }
    let peers: Vec<_> = config
        .workers()
        .into_iter()
        .filter(|peer| peer.id != worker.id)
        .map(|peer| format!("{}={}", peer.id, peer.description))
        .collect();
    if !peers.is_empty() {
        writeln!(prompt, "Peers: {}", peers.join("; ")).unwrap();
    }
    writeln!(
        prompt,
        "{} from {} [{}]\n{}",
        task.kind, task.creator, task.topic, task.body
    )
    .unwrap();
    if !runtime_context.is_empty() {
        writeln!(prompt, "Runtime context JSON:\n{runtime_context}").unwrap();
    }
    if !children.is_empty() {
        writeln!(prompt, "Child results:").unwrap();
        for child in children {
            writeln!(
                prompt,
                "{} / {} / {}:\n{}",
                child.assignee, child.topic, child.status, child.result
            )
            .unwrap();
        }
    }
    if leader_conversation {
        writeln!(
            prompt,
            "This is a direct message from Caleb. Reply directly and naturally. Do not delegate, create work, or inspect the repository unless his message explicitly requests it. For explicit work, finish skill loading and use the supported Harness GET /api/projects plus POST /work-items flow exactly once; never substitute sql, session todos, or an unavailable deferred tool. The host closes this conversation turn."
        )
        .unwrap();
    } else if task.kind == "generator" {
        writeln!(
            prompt,
            "Call task_create once, setting 'to' to the peer agent id that should receive the work. Your role instructions above are the only authority on what you do this turn and on exactly what the task body contains."
        )
        .unwrap();
    } else if task.is_peer_message() {
        writeln!(
            prompt,
            "Peer note. Do not delegate or acknowledge. Use message_send only if its sender needs new information; the host closes this note."
        )
        .unwrap();
    } else if worker.id == config.leader()
        || worker.delegate_agents.iter().any(|delegate| delegate == &worker.id)
    {
        writeln!(
            prompt,
            "Delegate only disjoint work by role with task_delegate and include the complete requirement and acceptance checks. Call team_status any time you need a fresh read on who is idle, busy, or backlogged before delegating. Never call Task, read_agent, write_agent, or list_agents; Harness resumes you when children finish, so do not poll or duplicate their work. When doing work yourself, return the complete result once in your final assistant response."
        )
        .unwrap();
        writeln!(prompt, "{AUTONOMOUS_COMPLETION}").unwrap();
    } else {
        writeln!(
            prompt,
            "Do this assignment yourself and return the complete result once in your final assistant response. Never call Task, read_agent, write_agent, or list_agents; do not delegate, poll, duplicate, relay, or leave a long-lived server running. Call team_status only if you need to confirm current workload; it is informational and does not contact anyone."
        )
        .unwrap();
        writeln!(prompt, "{AUTONOMOUS_COMPLETION}").unwrap();
    }
    prompt
}

pub fn with_prior_context(prompt: &str, context: &str) -> String {
    if context.is_empty() {
        return prompt.to_string();
    }
    format!(
        "<conversation_history>\n{context}</conversation_history>\n\
         Continue from this complete durable history. Do not ask for details already present above.\n\
         {prompt}"
    )
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::{config::ProjectConfig, models::Assignment};

    #[test]
    fn leader_prompt_is_team_aware_and_names_only_typed_coordination() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let file = directory.path().join("project.json");
        std::fs::write(
            &file,
            format!(
                r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"reviewer","description":"Review","prompt":"Review."}}]}}"#,
                serde_json::to_string(&root).unwrap()
            ),
        )
        .unwrap();
        let config = ProjectConfig::load(&file).unwrap();
        let workers = config.workers();
        let prompt = build(
            &config,
            &workers[0],
            &Assignment {
                id: "opaque:root".into(),
                parent_id: None,
                kind: "message".into(),
                source: "manual".into(),
                creator: "human".into(),
                assignee: "lead".into(),
                topic: "goal".into(),
                body: "Build it.".into(),
                attempts: 1,
                claim_generation: 1,
            },
            &[],
            "",
        );

        assert!(prompt.contains("reviewer=Review"));
        assert!(prompt.contains("task_delegate"));
        assert!(prompt.contains("complete requirement and acceptance checks"));
        assert!(prompt.contains("Harness resumes you when children finish"));
        assert!(prompt.contains("Never call Task, read_agent, write_agent, or list_agents"));
        assert!(
            prompt.contains("Never recursively scan a drive, user profile, or workspace parent")
        );
        assert!(
            prompt
                .contains("Start from changed files, referenced symbols, and exact import targets")
        );
        assert!(prompt.contains("constrain each search to exact source or package directories"));
        assert!(prompt.contains("return the complete result once"));
        assert!(prompt.contains("never ask a question, request approval"));
        assert!(prompt.contains("left undone, deferred, or offered as optional"));
        assert!(!prompt.contains("task_complete"));
        assert!(!prompt.contains("Activity:"));
    }

    #[test]
    fn peer_message_prompt_prevents_acknowledgement_loops() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let file = directory.path().join("project.json");
        std::fs::write(
            &file,
            format!(
                r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"reviewer","description":"Review","prompt":"Review."}}]}}"#,
                serde_json::to_string(&root).unwrap()
            ),
        )
        .unwrap();
        let config = ProjectConfig::load(&file).unwrap();
        let workers = config.workers();
        let prompt = build(
            &config,
            &workers[1],
            &Assignment {
                id: "opaque:message".into(),
                parent_id: None,
                kind: "message".into(),
                source: "agent".into(),
                creator: "lead".into(),
                assignee: "reviewer".into(),
                topic: "status".into(),
                body: "Draft complete.".into(),
                attempts: 1,
                claim_generation: 1,
            },
            &[],
            "",
        );

        assert!(prompt.contains("Peer note"));
        assert!(prompt.contains("host closes this note"));
        assert!(!prompt.contains("task_complete"));
    }

    #[test]
    fn human_message_to_leader_is_actionable() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let file = directory.path().join("project.json");
        std::fs::write(
            &file,
            format!(
                r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"reviewer","description":"Review","prompt":"Review."}}]}}"#,
                serde_json::to_string(&root).unwrap()
            ),
        )
        .unwrap();
        let config = ProjectConfig::load(&file).unwrap();
        let workers = config.workers();
        let prompt = build(
            &config,
            &workers[0],
            &Assignment {
                id: "dashboard-message".into(),
                parent_id: None,
                kind: "message".into(),
                source: "message".into(),
                creator: "dashboard".into(),
                assignee: "lead".into(),
                topic: "dashboard-message".into(),
                body: "Fix the UI.".into(),
                attempts: 1,
                claim_generation: 1,
            },
            &[],
            "",
        );

        assert!(prompt.starts_with("<system_reminder>"));
        assert!(prompt.contains("Direct conversation mode"));
        assert!(prompt.contains("confirm GET /api/projects with PowerShell"));
        assert!(prompt.contains("POST one complete task"));
        assert!(prompt.contains("Do not stop after loading the skill"));
        assert!(prompt.contains("do not depend on the deferred task_create tool"));
        assert!(
            prompt.contains("Never use sql, todos, todo_deps, or inbox_entries as a work queue")
        );
        assert!(prompt.contains("never claim work is queued unless the work-items POST succeeded"));
        assert!(prompt.contains(
            "use the supported Harness GET /api/projects plus POST /work-items flow exactly once"
        ));
        assert!(
            prompt.contains("never substitute sql, session todos, or an unavailable deferred tool")
        );
        assert!(prompt.contains("Reply directly and naturally"));
        assert!(!prompt.contains("task_complete"));
        assert!(!prompt.contains("Peer note"));
    }

    #[test]
    fn human_message_to_specialist_is_a_direct_assignment() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let file = directory.path().join("project.json");
        std::fs::write(
            &file,
            format!(
                r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"livesite","description":"Monitor","prompt":"Validate alerts."}}]}}"#,
                serde_json::to_string(&root).unwrap()
            ),
        )
        .unwrap();
        let config = ProjectConfig::load(&file).unwrap();
        let workers = config.workers();
        let prompt = build(
            &config,
            &workers[1],
            &Assignment {
                id: "dashboard-message".into(),
                parent_id: None,
                kind: "message".into(),
                source: "message".into(),
                creator: "dashboard".into(),
                assignee: "livesite".into(),
                topic: "dashboard-message".into(),
                body: "Validate this build alert.".into(),
                attempts: 1,
                claim_generation: 1,
            },
            &[],
            "",
        );

        assert!(prompt.contains("Validate this build alert."));
        assert!(prompt.contains("Do this assignment yourself"));
        assert!(prompt.contains("Finish this assignment completely in this turn"));
        assert!(prompt.contains("never ask a question, request approval"));
        assert!(!prompt.contains("Direct conversation mode"));
        assert!(!prompt.contains("/work-items"));
    }

    #[test]
    fn peer_notes_do_not_carry_the_autonomy_mandate() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let file = directory.path().join("project.json");
        std::fs::write(
            &file,
            format!(
                r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}},{{"name":"reviewer","description":"Review","prompt":"Review."}}]}}"#,
                serde_json::to_string(&root).unwrap()
            ),
        )
        .unwrap();
        let config = ProjectConfig::load(&file).unwrap();
        let workers = config.workers();
        let prompt = build(
            &config,
            &workers[1],
            &Assignment {
                id: "opaque:message".into(),
                parent_id: None,
                kind: "message".into(),
                source: "agent".into(),
                creator: "lead".into(),
                assignee: "reviewer".into(),
                topic: "status".into(),
                body: "Draft complete.".into(),
                attempts: 1,
                claim_generation: 1,
            },
            &[],
            "",
        );

        assert!(prompt.contains("Peer note"));
        assert!(!prompt.contains("Finish this assignment completely in this turn"));
    }

    #[test]
    fn generator_prompt_supplies_only_the_filing_mechanic() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let file = directory.path().join("project.json");
        std::fs::write(
            &file,
            format!(
                r#"{{"name":"Test","root":{},"leader":"ideas","idea_agents":[{{"agent":"ideas","task_limit":4}}],"roles":[{{"name":"ideas","description":"Ideas","prompt":"File a work item containing ONLY the link to the md file."}},{{"name":"builder","description":"Build","prompt":"Build."}}]}}"#,
                serde_json::to_string(&root).unwrap()
            ),
        )
        .unwrap();
        let config = ProjectConfig::load(&file).unwrap();
        let workers = config.workers();
        let prompt = build(
            &config,
            &workers[0],
            &Assignment {
                id: "opaque:generator".into(),
                parent_id: None,
                kind: "generator".into(),
                source: "automatic".into(),
                creator: "harness".into(),
                assignee: "ideas".into(),
                topic: "next idea".into(),
                body: "Create the next task.".into(),
                attempts: 1,
                claim_generation: 1,
            },
            &[],
            "",
        );

        // Harness contributes the routing mechanic and the peer list, nothing else.
        assert!(prompt.contains("Call task_create once"));
        assert!(prompt.contains("setting 'to' to the peer agent id"));
        assert!(prompt.contains("only authority on what you do this turn"));
        assert!(prompt.contains("builder=Build"));
        // The agent's own role reaches it verbatim and is never overridden.
        assert!(prompt.contains("File a work item containing ONLY the link to the md file."));
        // No harness-authored prose may dictate the message the agent sends, or recast the
        // agent as a pure delegator that must not do its own role's work.
        assert!(!prompt.contains("The task body must be"));
        assert!(!prompt.contains("immediately actionable procedure"));
        assert!(!prompt.contains("execute right now in their very next turn"));
        assert!(!prompt.contains("You are the delegator"));
        assert!(!prompt.contains("do not personally execute the work yourself"));
        assert!(!prompt.contains("team_status first"));
        assert!(!prompt.contains("Do not execute or delegate it"));
        // Observed verbatim in filed bodies: harness search guidance must not reach this turn.
        assert!(!prompt.contains("Start from changed files, referenced symbols"));
        assert!(!prompt.contains("Never recursively scan a drive"));
    }

    #[test]
    fn preserves_complete_task_context_without_a_size_limit() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("workspace");
        std::fs::create_dir(&root).unwrap();
        let file = directory.path().join("project.json");
        std::fs::write(
            &file,
            format!(
                r#"{{"name":"Test","root":{},"leader":"lead","roles":[{{"name":"lead","description":"Lead","prompt":"Lead."}}]}}"#,
                serde_json::to_string(&root).unwrap()
            ),
        )
        .unwrap();
        let config = ProjectConfig::load(&file).unwrap();
        let body = format!("begin:{}:end", "complete-context-".repeat(32_768));
        let prompt = build(
            &config,
            &config.workers()[0],
            &Assignment {
                id: "large-root".into(),
                parent_id: None,
                kind: "root".into(),
                source: "manual".into(),
                creator: "human".into(),
                assignee: "lead".into(),
                topic: "large context".into(),
                body: body.clone(),
                attempts: 1,
                claim_generation: 1,
            },
            &[],
            "",
        );

        assert!(prompt.contains(&body));
        assert!(prompt.ends_with('\n'));
    }

    #[test]
    fn preserves_complete_prior_context_without_a_size_limit() {
        let context = format!("begin:{}:end", "prior-context-".repeat(32_768));
        let prompt = with_prior_context("Current follow-up.", &context);

        assert!(prompt.contains(&context));
        assert!(prompt.ends_with("Current follow-up."));
    }
}
