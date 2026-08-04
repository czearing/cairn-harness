use crate::models::Assignment;

pub(crate) type TaskRow = (
    String,
    Option<String>,
    String,
    String,
    String,
    String,
    String,
    String,
    u32,
    i64,
);

pub(crate) fn keyed_id(parent: &str, assignee: &str, topic: &str, body: &str) -> String {
    let value = format!("{parent}\0{assignee}\0{topic}\0{body}");
    blake3::hash(value.as_bytes()).to_hex().to_string()
}

pub(crate) fn assignment(row: TaskRow) -> Assignment {
    Assignment {
        id: row.0,
        parent_id: row.1,
        kind: row.2,
        source: row.3,
        creator: row.4,
        assignee: row.5,
        topic: row.6,
        body: row.7,
        attempts: row.8,
        claim_generation: row.9,
    }
}

pub(crate) fn delegation_label(topic: &str, body: &str) -> String {
    let topic = topic.trim();
    let normalized = topic.to_ascii_lowercase().replace(['_', ' '], "-");
    if !topic.contains(['/', '.'])
        && !matches!(
            normalized.as_str(),
            "" | "task" | "todo" | "work-item" | "delegate" | "delegation"
        )
    {
        return truncate_label(&topic.replace(['-', '_'], " "));
    }
    body.lines()
        .map(|line| line.trim().trim_start_matches('#').trim())
        .find(|line| !line.is_empty() && !is_metadata_line(line))
        .map(|line| truncate_label(line.split(['.', '!', '?']).next().unwrap_or(line)))
        .unwrap_or_else(|| "delegated task".into())
}

fn is_metadata_line(line: &str) -> bool {
    line.split_once(':').is_some_and(|(key, _)| {
        !key.is_empty()
            && key.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
            })
    })
}

fn truncate_label(value: &str) -> String {
    value.chars().take(80).collect()
}

#[cfg(test)]
mod tests {
    use super::delegation_label;

    #[test]
    fn delegation_labels_prefer_descriptive_topics() {
        assert_eq!(
            delegation_label("release-notes", "Write the announcement."),
            "release notes"
        );
    }

    #[test]
    fn delegation_labels_fall_back_to_body_titles() {
        assert_eq!(
            delegation_label(
                "work-item",
                "owner: writer\n# Design checkout flow\nDetails."
            ),
            "Design checkout flow"
        );
    }

    #[test]
    fn delegation_labels_have_a_safe_generic_fallback() {
        assert_eq!(delegation_label("task", "owner: writer"), "delegated task");
    }
}
