use super::*;

fn state_of(tasks: &BackgroundTasks, id: &str) -> TaskState {
    tasks
        .snapshot()
        .into_iter()
        .find(|task| task.id == id)
        .expect("task exists")
        .state
}

#[test]
fn lifecycle_running_to_done_and_failed() {
    let tasks = BackgroundTasks::new();
    assert!(tasks.start("a", TaskKind::Shell, "npm run dev"));
    assert!(tasks.start("b", TaskKind::Subagent, "explore"));
    assert_eq!(state_of(&tasks, "a"), TaskState::Running);
    assert!(tasks.finish("a", TaskState::Done));
    assert!(tasks.finish("b", TaskState::Failed));
    assert_eq!(state_of(&tasks, "a"), TaskState::Done);
    assert_eq!(state_of(&tasks, "b"), TaskState::Failed);
    assert!(!tasks.finish("a", TaskState::Failed));
    assert_eq!(state_of(&tasks, "a"), TaskState::Done);
}

#[test]
fn stop_marks_stopped_and_reports_errors() {
    let tasks = BackgroundTasks::new();
    tasks.start("a", TaskKind::Shell, "sleep 100");
    assert_eq!(tasks.stop("a"), Ok(()));
    assert_eq!(state_of(&tasks, "a"), TaskState::Stopped);
    assert_eq!(tasks.stop("a"), Err(ERROR_STOP_FAILED));
    assert_eq!(tasks.stop("zzz"), Err(ERROR_NOT_FOUND));
}

#[test]
fn clear_finished_keeps_running() {
    let tasks = BackgroundTasks::new();
    tasks.start("run", TaskKind::Shell, "x");
    tasks.start("done", TaskKind::Shell, "y");
    tasks.start("stopped", TaskKind::Shell, "z");
    tasks.finish("done", TaskState::Done);
    tasks.stop("stopped").unwrap();
    assert_eq!(tasks.clear_finished(), 2);
    let remaining = tasks.snapshot();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, "run");
}

#[test]
fn over_limit_drops_oldest_finished() {
    let tasks = BackgroundTasks::new();
    for index in 0..MAX_TASKS {
        tasks.start(&format!("t{index}"), TaskKind::Shell, "x");
    }
    // Toàn bộ đang chạy: việc mới bị bỏ.
    assert!(!tasks.start("extra", TaskKind::Shell, "x"));
    tasks.finish("t3", TaskState::Done);
    tasks.finish("t7", TaskState::Done);
    assert!(tasks.start("extra", TaskKind::Shell, "x"));
    let ids: Vec<String> = tasks.snapshot().into_iter().map(|task| task.id).collect();
    assert_eq!(ids.len(), MAX_TASKS);
    assert!(!ids.contains(&"t3".to_string()));
    assert!(ids.contains(&"t7".to_string()));
    assert!(ids.contains(&"extra".to_string()));
}

#[test]
fn truncates_label_and_output_tail() {
    let tasks = BackgroundTasks::new();
    tasks.start("a", TaskKind::Shell, &"é".repeat(500));
    let output = format!("{}{}", "a".repeat(3_000), "END");
    tasks.set_output("a", &output);
    let task = tasks.snapshot().remove(0);
    assert_eq!(task.label.chars().count(), MAX_LABEL_CHARS);
    assert_eq!(task.output_tail.chars().count(), MAX_OUTPUT_TAIL_CHARS);
    assert!(task.output_tail.ends_with("END"));
}

#[test]
fn duplicate_start_ignored_and_attach_lookup() {
    let tasks = BackgroundTasks::new();
    assert!(tasks.start("a", TaskKind::Shell, "x"));
    assert!(!tasks.start("a", TaskKind::Shell, "other"));
    assert!(tasks.attach("a", "bg1"));
    assert!(!tasks.attach("nope", "bg2"));
    assert_eq!(tasks.find_by_handle("bg1").as_deref(), Some("a"));
    assert_eq!(tasks.find_by_handle("bg9"), None);
}

#[test]
fn snapshot_json_is_camel_case_without_handle() {
    let tasks = BackgroundTasks::new();
    tasks.start("a", TaskKind::Subagent, "explore");
    tasks.attach("a", "secret-handle");
    let value: serde_json::Value = serde_json::from_str(&tasks.snapshot_json()).unwrap();
    let task = &value["tasks"][0];
    assert_eq!(task["kind"], "subagent");
    assert_eq!(task["state"], "running");
    assert!(task["startedAt"].is_i64());
    assert_eq!(task["outputTail"], "");
    assert!(task.get("handle").is_none());
}

#[test]
fn changes_drive_the_table() {
    let tasks = BackgroundTasks::new();
    let started = BackgroundChange::Started {
        id: "toolu_1".into(),
        handle: "bg1".into(),
        label: "sleep 60".into(),
    };
    assert!(tasks.apply(&started));
    assert!(!tasks.apply(&started));
    assert_eq!(tasks.find_by_handle("bg1").as_deref(), Some("toolu_1"));
    // Sub-agent không có handle nên không bị danh sách của CLI đóng.
    tasks.start("toolu_2", TaskKind::Subagent, "explore");
    assert!(!tasks.apply(&BackgroundChange::Running {
        handles: vec!["bg1".into()]
    }));
    assert_eq!(tasks.stop_target("toolu_1"), Ok(Some("bg1".to_string())));
    assert_eq!(state_of(&tasks, "toolu_1"), TaskState::Running);
    assert!(tasks.apply(&BackgroundChange::Finished {
        handle: "bg1".into(),
        state: TaskState::Stopped
    }));
    assert_eq!(state_of(&tasks, "toolu_1"), TaskState::Stopped);
    assert!(!tasks.apply(&BackgroundChange::Finished {
        handle: "bg1".into(),
        state: TaskState::Done
    }));
    assert_eq!(tasks.stop_target("toolu_1"), Err(ERROR_STOP_FAILED));
    assert_eq!(tasks.stop_target("nope"), Err(ERROR_NOT_FOUND));
}

#[test]
fn a_shell_task_missing_from_the_cli_list_is_done() {
    let tasks = BackgroundTasks::new();
    tasks.apply(&BackgroundChange::Started {
        id: "toolu_1".into(),
        handle: "bg1".into(),
        label: "x".into(),
    });
    tasks.start("toolu_2", TaskKind::Subagent, "explore");
    assert!(tasks.apply(&BackgroundChange::Running {
        handles: Vec::new()
    }));
    assert_eq!(state_of(&tasks, "toolu_1"), TaskState::Done);
    assert_eq!(state_of(&tasks, "toolu_2"), TaskState::Running);
    assert!(tasks.stop_running_subagents());
    assert_eq!(state_of(&tasks, "toolu_2"), TaskState::Stopped);
}

#[test]
fn restore_marks_running_as_stopped() {
    let tasks = BackgroundTasks::new();
    tasks.start("a", TaskKind::Shell, "x");
    let fresh = BackgroundTasks::new();
    fresh.restore(tasks.snapshot());
    assert_eq!(state_of(&fresh, "a"), TaskState::Stopped);
    let other = BackgroundTasks::new();
    other.start("b", TaskKind::Shell, "y");
    assert!(other.stop_all_running());
    assert_eq!(state_of(&other, "b"), TaskState::Stopped);
}

#[test]
fn overlong_id_or_handle_is_dropped() {
    let tasks = BackgroundTasks::new();
    let long = "x".repeat(MAX_ID_CHARS + 1);

    assert!(!tasks.start(&long, TaskKind::Shell, "a"));
    assert!(tasks.start("a", TaskKind::Shell, "a"));
    assert!(!tasks.attach("a", &long));
    assert!(tasks.attach("a", &"y".repeat(MAX_ID_CHARS)));
    assert!(!tasks.apply(&BackgroundChange::Started {
        id: "b".into(),
        handle: long,
        label: "b".into(),
    }));
    assert_eq!(tasks.snapshot().len(), 1);
}

#[test]
fn restore_truncates_every_field_and_drops_overlong_ids() {
    let task = |id: &str| Task {
        id: id.to_string(),
        kind: TaskKind::Shell,
        label: "l".repeat(5_000),
        state: TaskState::Done,
        started_at: 0,
        output_tail: "o".repeat(50_000),
        handle: None,
    };
    let tasks = BackgroundTasks::new();

    tasks.restore(vec![task("ok"), task(&"i".repeat(MAX_ID_CHARS + 1))]);

    let restored = tasks.snapshot();

    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].label.chars().count(), MAX_LABEL_CHARS);
    assert_eq!(
        restored[0].output_tail.chars().count(),
        MAX_OUTPUT_TAIL_CHARS
    );
}

#[test]
fn remove_drops_one_task() {
    let tasks = BackgroundTasks::new();
    tasks.start("a", TaskKind::Subagent, "x");
    tasks.start("b", TaskKind::Shell, "y");
    assert!(tasks.remove("a"));
    assert!(!tasks.remove("a"));
    assert_eq!(tasks.snapshot().len(), 1);
}
