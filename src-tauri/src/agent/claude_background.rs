//! What the Claude CLI says about shell commands run in the background, as a [`BackgroundChange`].
//! Measured on claude 2.1.319 (`docs/system/background-tasks.md` 2.1): `system` lines `task_started`, `task_updated`, `task_notification` and `background_tasks_changed`; there is no process id, only a task id. A lone `Bash` tool call creates nothing: only `task_started` does.

use crate::background::{BackgroundChange, TaskState};

/// The `task_type` of a shell command run in the background.
const SHELL_TASK_TYPE: &str = "local_bash";

/// `killed` and `stopped` were measured; the others are assumed until the CLI is seen finishing a command by itself, and any other value is ignored.
fn state_of(status: &str) -> Option<TaskState> {
    match status {
        "killed" | "stopped" => Some(TaskState::Stopped),
        "completed" => Some(TaskState::Done),
        "failed" => Some(TaskState::Failed),
        _ => None,
    }
}

fn string(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// The change carried by one output line, if any.
pub fn change(line: &str) -> Option<BackgroundChange> {
    if !line.contains("\"task") && !line.contains("background_tasks_changed") {
        return None;
    }
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;

    if value["type"] != "system" {
        return None;
    }

    match value["subtype"].as_str()? {
        "task_started"
            if value["is_backgrounded"] == true && value["task_type"] == SHELL_TASK_TYPE =>
        {
            Some(BackgroundChange::Started {
                id: string(&value["tool_use_id"])?,
                handle: string(&value["task_id"])?,
                label: value["description"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            })
        }
        "task_updated" => Some(BackgroundChange::Finished {
            handle: string(&value["task_id"])?,
            state: state_of(value["patch"]["status"].as_str()?)?,
        }),
        "task_notification" => Some(BackgroundChange::Finished {
            handle: string(&value["task_id"])?,
            state: state_of(value["status"].as_str()?)?,
        }),
        "background_tasks_changed" => Some(BackgroundChange::Running {
            handles: value["tasks"]
                .as_array()?
                .iter()
                .filter(|task| task["task_type"] == SHELL_TASK_TYPE)
                .filter_map(|task| string(&task["task_id"]))
                .collect(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
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
}
