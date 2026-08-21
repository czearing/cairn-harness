use std::io::Write;

use tempfile::NamedTempFile;

use super::*;

#[test]
fn waits_for_marker_and_allowed_agent_stop() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"CAIRN_ENVELOPE_END"}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"block"}}}}}}"#
    )
    .unwrap();
    let path = file.path().to_path_buf();
    assert!(read_turn(&path, 0, "CAIRN_ENVELOPE_END").unwrap().is_none());
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();
    let events = read_turn(&path, 0, "CAIRN_ENVELOPE_END").unwrap().unwrap();
    assert_eq!(events.text, "CAIRN_ENVELOPE_END");
}

#[test]
fn ignores_allowed_stop_without_requested_marker() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();
    assert!(
        read_turn(&file.path().to_path_buf(), 0, "HARNESS_SESSION_READY")
            .unwrap()
            .is_none()
    );
    assert!(
        read_events(&file.path().to_path_buf(), 0, None)
            .unwrap()
            .is_some()
    );
}

#[test]
fn terminal_output_returns_a_blocked_stop_for_same_session_continuation() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"final poem"}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    assert!(
        read_events(&file.path().to_path_buf(), 0, None)
            .unwrap()
            .is_none()
    );
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"block","reason":"Finish the implementation."}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    let events = read_events(&file.path().to_path_buf(), 0, None)
        .unwrap()
        .unwrap();
    assert_eq!(events.text, "final poem");
    assert!(matches!(
        events.stop,
        TurnStop::Blocked(reason) if reason == "Finish the implementation."
    ));
}

#[test]
fn ignores_subagent_stop_when_waiting_for_the_parent_terminal_hook() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"subagentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    assert!(
        read_events(&file.path().to_path_buf(), 0, None)
            .unwrap()
            .is_none()
    );
}

#[test]
fn returns_session_errors_without_waiting_for_an_envelope() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"session.error","data":{{"message":"Missing namespace for function_call"}}}}"#
    )
    .unwrap();
    file.flush().unwrap();
    let error = read_turn(&file.path().to_path_buf(), 0, "CAIRN_ENVELOPE_END").unwrap_err();
    assert!(error.to_string().contains("Missing namespace"));
}

#[test]
fn blocks_terminal_output_while_a_sync_powershell_command_is_still_running() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_start","data":{{"toolCallId":"call-1","toolName":"powershell","arguments":{{"shellId":"install"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_complete","data":{{"toolCallId":"call-1","success":true,"result":{{"content":"<command with shellId: install is still running after 600 seconds>"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"Dependency restore is still running."}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    let events = read_events(&file.path().to_path_buf(), 0, None)
        .unwrap()
        .unwrap();
    assert!(matches!(
        events.stop,
        TurnStop::Blocked(reason) if reason.contains("install")
    ));
}

#[test]
fn allows_terminal_output_after_the_running_shell_is_read_to_completion() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_start","data":{{"toolCallId":"call-1","toolName":"powershell","arguments":{{"shellId":"install"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_complete","data":{{"toolCallId":"call-1","success":true,"result":{{"content":"<command with shellId: install is still running after 600 seconds>"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();
    let blocked = read_events(&file.path().to_path_buf(), 0, None)
        .unwrap()
        .unwrap();
    assert!(matches!(blocked.stop, TurnStop::Blocked(_)));

    writeln!(
        file,
        r#"{{"type":"tool.execution_start","data":{{"toolCallId":"call-2","toolName":"read_powershell","arguments":{{"shellId":"install"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_complete","data":{{"toolCallId":"call-2","success":true,"result":{{"content":"completed with exit code 0"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"Server ready."}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    let events = read_events(&file.path().to_path_buf(), 0, None)
        .unwrap()
        .unwrap();
    assert!(matches!(events.stop, TurnStop::Allowed));
}

#[test]
fn carries_running_shells_across_agent_turn_boundaries() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_start","data":{{"toolCallId":"call-1","toolName":"powershell","arguments":{{"shellId":"install"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_complete","data":{{"toolCallId":"call-1","success":true,"result":{{"content":"<command with shellId: install is still running after 600 seconds>"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    let first = read_events(&file.path().to_path_buf(), 0, None)
        .unwrap()
        .unwrap();
    assert!(matches!(first.stop, TurnStop::Blocked(_)));
    let next_start = file.as_file().metadata().unwrap().len();

    writeln!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"It is still running."}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    let second = read_events_with_shells(
        &file.path().to_path_buf(),
        next_start,
        None,
        &first.running_shells,
    )
    .unwrap()
    .unwrap();
    assert!(matches!(
        second.stop,
        TurnStop::Blocked(reason) if reason.contains("install")
    ));
}

#[test]
fn allows_detached_servers_to_survive_terminal_output() {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_start","data":{{"toolCallId":"call-1","toolName":"powershell","arguments":{{"shellId":"server"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"tool.execution_complete","data":{{"toolCallId":"call-1","success":true,"result":{{"content":"<command started in detached background with shellId: server>"}}}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    let events = read_events(&file.path().to_path_buf(), 0, None)
        .unwrap()
        .unwrap();
    assert!(matches!(events.stop, TurnStop::Allowed));
}

#[test]
fn absorbs_each_event_once_across_wakes() {
    let mut file = NamedTempFile::new().unwrap();
    let path = file.path().to_path_buf();
    writeln!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"one"}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    let mut scan = TurnScan::new(0, &HashSet::new());
    assert!(!scan.advance(&path, None).unwrap());
    let consumed = scan.offset;
    assert_eq!(consumed, file.as_file().metadata().unwrap().len());

    writeln!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"two"}}}}"#
    )
    .unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    assert!(scan.advance(&path, None).unwrap());
    assert!(scan.offset > consumed);
    assert_eq!(scan.into_events().text, "one\ntwo");
}

#[test]
fn a_wake_without_new_bytes_repeats_no_events() {
    let mut file = NamedTempFile::new().unwrap();
    let path = file.path().to_path_buf();
    writeln!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"only"}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    let mut scan = TurnScan::new(0, &HashSet::new());
    assert!(!scan.advance(&path, None).unwrap());
    assert!(!scan.advance(&path, None).unwrap());
    assert!(!scan.advance(&path, None).unwrap());

    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    assert!(scan.advance(&path, None).unwrap());
    assert_eq!(scan.into_events().text, "only");
}

#[test]
fn holds_back_a_half_written_line_until_it_is_terminated() {
    let mut file = NamedTempFile::new().unwrap();
    let path = file.path().to_path_buf();
    write!(
        file,
        r#"{{"type":"assistant.message","data":{{"content":"sp"#
    )
    .unwrap();
    file.flush().unwrap();

    let mut scan = TurnScan::new(0, &HashSet::new());
    assert!(!scan.advance(&path, None).unwrap());
    assert!(scan.output.is_empty());

    writeln!(file, r#"lit"}}}}"#).unwrap();
    writeln!(
        file,
        r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
    )
    .unwrap();
    file.flush().unwrap();

    assert!(scan.advance(&path, None).unwrap());
    assert_eq!(scan.into_events().text, "split");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_flood_of_notifications_still_returns_the_turn_promptly() {
    // A streaming agent raises a filesystem notification per append, which is what lets the
    // wait loop spin. Coalescing those wakes must not delay the turn itself.
    let root = tempfile::tempdir().unwrap();
    let mut signal = TurnSignal::new(root.path().to_path_buf(), "agent", "session").unwrap();
    let file = root
        .path()
        .join(".cairn-harness")
        .join("copilot-home")
        .join("agent")
        .join("session-state")
        .join("session")
        .join("events.jsonl");

    // Blocking file writes belong off the runtime; on a current-thread runtime they starve the
    // very loop under test and the assertion below would measure the writer, not the fix.
    let writer = tokio::task::spawn_blocking(move || {
        let mut handle = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
            .unwrap();
        for index in 0..500 {
            writeln!(
                handle,
                r#"{{"type":"assistant.message","data":{{"content":"{index}"}}}}"#
            )
            .unwrap();
            handle.flush().unwrap();
        }
        writeln!(
            handle,
            r#"{{"type":"hook.end","data":{{"hookType":"agentStop","output":{{"decision":"allow"}}}}}}"#
        )
        .unwrap();
        handle.flush().unwrap();
    });

    let events = tokio::time::timeout(Duration::from_secs(10), signal.wait_terminal_after(0))
        .await
        .expect("a flood of notifications must not stall the turn")
        .unwrap();
    writer.await.unwrap();

    assert!(
        events.text.contains("499"),
        "every appended event is absorbed"
    );
}
