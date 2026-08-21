use std::fmt::Write;

use crate::{
    config::ProjectConfig,
    models::{Assignment, ChildResult, WorkerSpec},
};

/// A named block of prompt text that does not change from one turn to the next.
///
/// The persistent runner keeps a Copilot session alive across turns, so anything
/// the agent has already been told is still in its context. Re-sending an
/// unchanged section costs tokens without changing what the agent does on this
/// message, so each section is delivered only when its text differs from the
/// text last delivered on this session. Governing instructions that must keep
/// their recency position relative to the message stay in `body` and are always
/// sent.
#[derive(Clone, Debug)]
pub struct Section {
    pub key: &'static str,
    pub text: String,
}

/// A turn prompt split into re-sendable sections and the always-sent body.
#[derive(Clone, Debug, Default)]
pub struct Composed {
    pub sections: Vec<Section>,
    pub body: String,
    /// Identity of the assignment this body speaks for, when it has one.
    ///
    /// A preempted turn returns to `pending` and is claimed again, which rebuilds
    /// the same body and sends it into the session that is still holding it. The
    /// agent then answers the operator's message a second time. Identity is the
    /// discriminator rather than text alone because two different assignments may
    /// legitimately carry the same words, while a resumed one is the same row.
    pub body_key: Option<String>,
}

impl Composed {
    /// A prompt with no re-sendable sections; the whole text is sent every turn.
    pub fn body(text: impl Into<String>) -> Self {
        Self {
            sections: Vec::new(),
            body: text.into(),
            body_key: None,
        }
    }

    /// Every section plus the body: what a runner without a retained session sends.
    pub fn full(&self) -> String {
        self.render(|_| true)
    }

    /// The body preceded by whichever sections `send` accepts, in declared order.
    pub fn render(&self, send: impl FnMut(&Section) -> bool) -> String {
        self.render_body(send, &self.body)
    }

    /// `render`, with `body` substituted for the composed body.
    pub fn render_body(&self, mut send: impl FnMut(&Section) -> bool, body: &str) -> String {
        let mut text = String::new();
        for section in &self.sections {
            if send(section) {
                text.push_str(&section.text);
                text.push('\n');
            }
        }
        text.push_str(body);
        text
    }
}

/// The closing mandate carried by every real work assignment.
///
/// It sits last so it holds the recency position, which is the position an
/// instruction is actually followed from. That position is scarce, so it states
/// each duty once: stop only when the work is done, and treat an obstacle as
/// something to investigate rather than something to ask about. Earlier
/// revisions also told the agent to resolve ambiguity by picking the strongest
/// option and to leave nothing deferred or optional, which restated "no
/// questions" and "finish this turn" in different words and pulled against the
/// agents whose role prompt requires them to report doubt instead of acting on
/// it.
const AUTONOMOUS_COMPLETION: &str = "Finish this turn: no questions, no approval requests, nothing in scope deferred. If something blocks you, exhaust the alternatives and report what you proved.";

pub fn build(
    config: &ProjectConfig,
    worker: &WorkerSpec,
    task: &Assignment,
    children: &[ChildResult],
    runtime_context: &str,
) -> Composed {
    let leader_conversation = task.is_dashboard_message() && worker.id == config.leader();
    let peers: Vec<_> = config
        .workers()
        .into_iter()
        .filter(|peer| peer.id != worker.id)
        .map(|peer| format!("{}={}", peer.id, peer.description))
        .collect();
    let mut sections = Vec::new();
    if leader_conversation {
        sections.push(Section {
            key: "mode",
            text: "<system_reminder>\nDirect conversation mode. Answer Caleb conversationally. Do not treat this message as project work, run the repository workflow, or use tools unless he explicitly asks for implementation or task creation. When he asks for work, load the required Cairn Harness skill, confirm GET /api/projects with PowerShell, then POST one complete task to /api/projects/{projectId}/work-items. Do not stop after loading the skill and do not depend on the deferred task_create tool. Never use sql, todos, todo_deps, or inbox_entries as a work queue, and never claim work is queued unless the work-items POST succeeded. Never expose private chain-of-thought; share concise rationale, visible progress, and outcomes.\n</system_reminder>".into(),
        });
    }
    sections.push(Section {
        key: "role",
        text: format!("Role: {}. {}", worker.description, worker.prompt),
    });
    // Search guidance is operational advice for an agent doing repository work. A generator
    // turn only files a task, and anything Harness writes here has been observed getting
    // copied verbatim into the body the agent files, so it is withheld from that turn.
    if task.kind != "generator" {
        sections.push(Section {
            key: "search",
            text: "Use repository-native search tools. Start from changed files, referenced symbols, and exact import targets. Never recursively scan a drive, user profile, or workspace parent. Never scan a dependency tree, build output, or an entire monorepo; constrain each search to exact source or package directories, use narrow globs, and split broad queries.".into(),
        });
    }
    if !peers.is_empty() {
        sections.push(Section {
            key: "peers",
            text: format!("Peers: {}", peers.join("; ")),
        });
    }
    if !runtime_context.is_empty() {
        sections.push(Section {
            key: "runtime",
            text: format!("Runtime context JSON:\n{runtime_context}"),
        });
    }
    let mut prompt = String::new();
    writeln!(
        prompt,
        "{} from {} [{}]\n{}",
        task.kind, task.creator, task.topic, task.body
    )
    .unwrap();
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
    } else if (worker.id == config.leader()
        || worker
            .delegate_agents
            .iter()
            .any(|delegate| delegate == &worker.id))
        && !peers.is_empty()
    {
        // The delegation rules are only reachable when there is somebody to delegate to.
        // A leader configured alone is given the self-work close instead, because naming
        // task_delegate and team_status to an agent with no peers is text that cannot
        // change what it does on this message.
        writeln!(
            prompt,
            "Delegate only disjoint work by role with task_delegate and include the complete requirement and acceptance checks. Call team_status any time you need a fresh read on who is idle, busy, or backlogged before delegating. Harness resumes you when children finish, so do not poll or duplicate their work. When doing work yourself, return the complete result once in your final assistant response."
        )
        .unwrap();
        writeln!(prompt, "{AUTONOMOUS_COMPLETION}").unwrap();
    } else {
        // A worker cannot delegate, poll, or relay: Task, read_agent, write_agent and
        // list_agents are denied at launch by acp_launch::DENIED_TOOLS, and task_create
        // and task_delegate are withheld from its grant by mcp_config::harness_tools. A
        // ban on an act the agent has no tool for cannot change what it does, so only
        // the duty the harness relies on is stated: the final response is read as the
        // result. How to use team_status belongs to that tool's own description.
        writeln!(
            prompt,
            "Do this assignment yourself and return the complete result in your final response."
        )
        .unwrap();
        writeln!(prompt, "{AUTONOMOUS_COMPLETION}").unwrap();
    }
    Composed {
        sections,
        body: prompt,
        body_key: Some(task.id.clone()),
    }
}

/// Sent in place of a body the live session has already received verbatim.
///
/// The turn still happens and still carries its per-turn context; only the
/// duplicate restatement of the assignment is withheld.
pub const RESUMED_BODY: &str = "Resume the assignment already in this conversation. It was interrupted, not restated. Continue from where you stopped and do not answer it a second time.";

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
        )
        .full();

        assert!(prompt.contains("reviewer=Review"));
        assert!(prompt.contains("task_delegate"));
        assert!(prompt.contains("complete requirement and acceptance checks"));
        assert!(prompt.contains("Harness resumes you when children finish"));
        assert!(!prompt.contains("Never call Task, read_agent, write_agent, or list_agents"));
        assert!(
            prompt.contains("Never recursively scan a drive, user profile, or workspace parent")
        );
        assert!(
            prompt
                .contains("Start from changed files, referenced symbols, and exact import targets")
        );
        assert!(prompt.contains("constrain each search to exact source or package directories"));
        assert!(prompt.contains("return the complete result once"));
        assert!(prompt.contains("no questions, no approval requests"));
        assert!(!prompt.contains("left undone, deferred, or offered as optional"));
        assert!(!prompt.contains("Resolve every ambiguity"));
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
        )
        .full();

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
        )
        .full();

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
        )
        .full();

        assert!(prompt.contains("Validate this build alert."));
        assert!(prompt.contains("Do this assignment yourself"));
        assert!(prompt.contains("Finish this turn"));
        assert!(prompt.contains("exhaust the alternatives"));
        assert!(!prompt.contains("Direct conversation mode"));
        assert!(!prompt.contains("/work-items"));

        // The closing mandate is the last thing the agent reads on every worker turn,
        // so it is kept to two sentences. Assert the ceiling and the absence of the
        // duties that are enforced elsewhere, or the next edit restores the paragraph
        // with every other test still green.
        let close = prompt.split("Do this assignment yourself").nth(1).unwrap();
        assert!(close.len() < 250, "closing mandate grew to {}", close.len());
        assert!(!prompt.contains("Do not delegate, poll, duplicate, relay"));
        assert!(!prompt.contains("long-lived server"));
        assert!(!prompt.contains("Call team_status only if"));
        assert!(!prompt.contains("full decision authority"));
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
        )
        .full();

        assert!(prompt.contains("Peer note"));
        assert!(!prompt.contains("Finish this turn"));
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
        )
        .full();

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
        )
        .full();

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
