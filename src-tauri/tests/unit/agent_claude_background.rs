use super::*;

const STARTED: &str = r#"{"type":"system","subtype":"task_started","task_id":"bg6iuh7hi","run_id":"r","tool_use_id":"toolu_01","description":"sleep","is_backgrounded":true,"task_type":"local_bash"}"#;

#[test]
fn the_measured_system_lines_become_changes() {
    assert_eq!(
        change(STARTED),
        Some(BackgroundChange::Started {
            id: "toolu_01".into(),
            handle: "bg6iuh7hi".into(),
            label: "sleep".into()
        })
    );
    assert_eq!(
        change(
            r#"{"type":"system","subtype":"task_updated","task_id":"bg6iuh7hi","patch":{"status":"killed","end_time":1}}"#
        ),
        Some(BackgroundChange::Finished {
            handle: "bg6iuh7hi".into(),
            state: TaskState::Stopped
        })
    );
    assert_eq!(
        change(
            r#"{"type":"system","subtype":"task_notification","task_id":"bg6iuh7hi","status":"stopped","output_file":"/x","summary":"s"}"#
        ),
        Some(BackgroundChange::Finished {
            handle: "bg6iuh7hi".into(),
            state: TaskState::Stopped
        })
    );
    assert_eq!(
        change(
            r#"{"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"bg6iuh7hi","run_id":"r","task_type":"local_bash","description":"d"}]}"#
        ),
        Some(BackgroundChange::Running {
            handles: vec!["bg6iuh7hi".into()]
        })
    );
    assert_eq!(
        change(r#"{"type":"system","subtype":"background_tasks_changed","tasks":[]}"#),
        Some(BackgroundChange::Running {
            handles: Vec::new()
        })
    );
}

#[test]
fn other_lines_and_foreground_tasks_change_nothing() {
    assert_eq!(change(&STARTED.replace("true", "false")), None);
    assert_eq!(change(&STARTED.replace("local_bash", "local_agent")), None);
    assert_eq!(
        change(
            r#"{"type":"system","subtype":"task_updated","task_id":"b","patch":{"status":"weird"}}"#
        ),
        None
    );
    assert_eq!(
        change(r#"{"type":"system","subtype":"init","note":"task"}"#),
        None
    );
    // A `Bash` call alone starts nothing.
    assert_eq!(
        change(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"run_in_background":true}}]}}"#
        ),
        None
    );
}
