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
#[path = "../../tests/unit/agent_claude_background.rs"]
mod tests;
