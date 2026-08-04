use std::collections::{HashMap, HashSet};

use anyhow::{Result, bail};

use crate::models::WorkerSpec;

#[derive(Clone, Debug, Default)]
pub struct Directory {
    agents: HashSet<String>,
    roles: HashMap<String, Vec<String>>,
    all: Vec<String>,
}

pub fn build(workers: &[WorkerSpec]) -> Directory {
    let mut directory = Directory::default();
    for worker in workers {
        directory.agents.insert(worker.id.clone());
        push_unique(&mut directory.all, &worker.id);
        push_unique(
            directory.roles.entry(worker.role.clone()).or_default(),
            &worker.id,
        );
    }
    directory.all.sort();
    for agents in directory.roles.values_mut() {
        agents.sort();
    }
    directory
}

pub fn resolve(directory: &Directory, target: &str) -> Result<Vec<String>> {
    // Exact IDs win over both role names and the special wildcard target.
    let recipients = if directory.agents.contains(target) {
        Some(vec![target.to_owned()])
    } else if target == "*" {
        Some(directory.all.clone())
    } else {
        directory.roles.get(target).cloned()
    }
    .ok_or_else(|| anyhow::anyhow!("unknown agent or role: {target}"))?;

    if recipients.is_empty() {
        bail!("target has no agents: {target}");
    }
    Ok(recipients)
}

fn push_unique(recipients: &mut Vec<String>, agent: &str) {
    if !recipients.iter().any(|recipient| recipient == agent) {
        recipients.push(agent.to_owned());
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::{Directory, build, resolve};
    use crate::models::WorkerSpec;

    #[test]
    fn directory_exact_agent_wins_over_role_collision() {
        let directory = build(&[
            worker("reviewer", "writer"),
            worker("writer", "editor"),
            worker("author", "writer"),
        ]);

        assert_eq!(resolve(&directory, "writer").unwrap(), vec!["writer"]);
    }

    #[test]
    fn directory_role_returns_each_member_once() {
        let directory = build(&[
            worker("writer", "editor"),
            worker("reviewer", "writing"),
            worker("author", "writing"),
        ]);

        assert_eq!(
            resolve(&directory, "writing").unwrap(),
            vec!["author", "reviewer"]
        );
    }

    #[test]
    fn directory_wildcard_returns_each_worker_once_when_role_is_wildcard() {
        let directory = build(&[
            worker("writer", "*"),
            worker("reviewer", "review"),
            worker("author", "*"),
        ]);

        assert_eq!(
            resolve(&directory, "*").unwrap(),
            vec!["author", "reviewer", "writer"]
        );
    }

    #[test]
    fn directory_exact_wildcard_id_wins_over_wildcard_broadcast() {
        let directory = build(&[worker("*", "operator"), worker("writer", "*")]);

        assert_eq!(resolve(&directory, "*").unwrap(), vec!["*"]);
    }

    #[test]
    fn directory_resolution_is_independent_of_worker_order() {
        let workers = vec![
            worker("writer", "editor"),
            worker("reviewer", "writer"),
            worker("author", "writing"),
            worker("critic", "writing"),
            worker("operator", "*"),
        ];
        let mut reversed = workers.clone();
        reversed.reverse();
        let forward = build(&workers);
        let backward = build(&reversed);

        assert_eq!(
            resolve(&forward, "writer").unwrap(),
            resolve(&backward, "writer").unwrap()
        );
        assert_eq!(
            resolve(&forward, "writing").unwrap(),
            resolve(&backward, "writing").unwrap()
        );
        assert_eq!(
            resolve(&forward, "*").unwrap(),
            resolve(&backward, "*").unwrap()
        );
    }

    #[test]
    fn directory_unknown_target_preserves_error() {
        let error = resolve(&build(&[worker("writer", "editor")]), "missing").unwrap_err();

        assert_eq!(error.to_string(), "unknown agent or role: missing");
    }

    #[test]
    fn directory_empty_role_preserves_error() {
        let directory = Directory {
            agents: HashSet::new(),
            roles: HashMap::from([("empty".into(), Vec::new())]),
            all: Vec::new(),
        };

        let error = resolve(&directory, "empty").unwrap_err();
        assert_eq!(error.to_string(), "target has no agents: empty");
    }

    fn worker(id: &str, role: &str) -> WorkerSpec {
        WorkerSpec {
            id: id.into(),
            role: role.into(),
            description: String::new(),
            prompt: String::new(),
            model: "gpt-5.4-mini".into(),
            leader: String::new(),
            leader_task_limit: 3,
            idea_agents: Vec::new(),
        }
    }
}
