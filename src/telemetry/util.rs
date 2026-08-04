use chrono::{DateTime, Utc};
pub fn key(parts: &[&str]) -> String {
    let mut input = String::new();
    for part in parts {
        input.push_str(part);
        input.push('\0');
    }
    blake3::hash(input.as_bytes()).to_hex()[..16].to_string()
}

pub fn short_id(parts: &[&str]) -> String {
    key(parts)[..8].to_string()
}

pub fn compact(value: &str, limit: usize) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let redacted = redact(&collapsed);
    if redacted.chars().count() <= limit {
        return redacted;
    }
    let mut output = redacted
        .chars()
        .take(limit.saturating_sub(1))
        .collect::<String>();
    output.push('…');
    output
}

pub fn redact(value: &str) -> String {
    let mut redacted = Vec::new();
    let mut hide_next = false;
    for word in value.split_whitespace() {
        let lower = word.to_ascii_lowercase();
        let secret = hide_next
            || lower.contains("token=")
            || lower.contains("password=")
            || lower.contains("secret=")
            || lower.starts_with("ghp_");
        redacted.push(if secret { "[redacted]" } else { word });
        hide_next = lower == "bearer";
        if hide_next {
            redacted.pop();
            redacted.push("[redacted]");
        }
    }
    redacted.join(" ")
}

pub fn duration_ms(start: &str, end: &str) -> Option<i64> {
    let start = DateTime::parse_from_rfc3339(start).ok()?;
    let end = DateTime::parse_from_rfc3339(end).ok()?;
    Some((end - start).num_milliseconds().max(0))
}

pub fn age_ms(start: &str) -> Option<i64> {
    let start = DateTime::parse_from_rfc3339(start).ok()?;
    Some(
        (Utc::now() - start.with_timezone(&Utc))
            .num_milliseconds()
            .max(0),
    )
}

pub fn estimate_tokens(bytes: usize) -> i64 {
    bytes.div_ceil(4) as i64
}

pub fn human_duration(milliseconds: i64) -> String {
    let seconds = milliseconds.max(0) / 1_000;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    if hours > 0 {
        format!("{}h {:02}m", hours, minutes % 60)
    } else if minutes > 0 {
        format!("{}m {:02}s", minutes, seconds % 60)
    } else {
        format!("{seconds}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_secret_values() {
        let value = compact("failed token=abc password=hunter2 bearer xyz detail", 200);
        assert!(!value.contains("abc"));
        assert!(!value.contains("hunter2"));
        assert!(!value.contains("bearer"));
        assert!(!value.contains("xyz"));
        assert!(value.contains("[redacted]"));
    }
}
