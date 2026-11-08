use super::*;
use serde_json::json;

#[test]
fn todo_write_keeps_order_and_status() {
    let input = json!({"todos": [
        {"content": "a", "status": "completed", "activeForm": "A"},
        {"content": "b", "status": "in_progress", "activeForm": "B"},
        {"content": "c", "status": "pending", "activeForm": "C"},
    ]});
    let Some(Plan::Todos { todos }) = Plan::from_tool("TodoWrite", &input) else {
        panic!("expected todos");
    };
    let got: Vec<_> = todos
        .iter()
        .map(|t| (t.content.as_str(), t.status))
        .collect();
    assert_eq!(
        got,
        vec![
            ("a", TodoStatus::Completed),
            ("b", TodoStatus::InProgress),
            ("c", TodoStatus::Pending),
        ]
    );
}

#[test]
fn unknown_status_drops_only_that_todo() {
    let input = json!({"todos": [
        {"content": "a", "status": "weird"},
        {"content": "b", "status": "pending"},
        {"content": "no status"},
    ]});
    let Some(Plan::Todos { todos }) = Plan::from_tool("TodoWrite", &input) else {
        panic!("expected todos");
    };
    assert_eq!(todos.len(), 1);
    assert_eq!(todos[0].content, "b");
}

#[test]
fn limits_are_enforced() {
    let many: Vec<_> = (0..150)
        .map(|_| json!({"content": "é".repeat(600), "status": "pending"}))
        .collect();
    let Some(Plan::Todos { todos }) = Plan::from_tool("TodoWrite", &json!({"todos": many})) else {
        panic!("expected todos");
    };
    assert_eq!(todos.len(), 100);
    assert_eq!(todos[0].content.chars().count(), 500);

    let long = json!({"plan": "x".repeat(100_050)});
    let Some(Plan::Text { markdown }) = Plan::from_tool("ExitPlanMode", &long) else {
        panic!("expected text");
    };
    assert_eq!(markdown.chars().count(), 100_000);
}

#[test]
fn exit_plan_mode_gives_text() {
    let plan = Plan::from_tool("ExitPlanMode", &json!({"plan": "# Bước\n- một"}));
    assert_eq!(
        plan,
        Some(Plan::Text {
            markdown: "# Bước\n- một".into()
        })
    );
}

#[test]
fn other_tools_and_bad_input_give_none() {
    assert_eq!(Plan::from_tool("Bash", &json!({"command": "ls"})), None);
    assert_eq!(Plan::from_tool("TodoWrite", &json!({})), None);
    assert_eq!(Plan::from_tool("TodoWrite", &json!({"todos": "x"})), None);
    assert_eq!(Plan::from_tool("ExitPlanMode", &json!({"plan": 3})), None);
}

#[test]
fn json_contract_is_camel_case_tagged() {
    let plan = Plan::Todos {
        todos: vec![Todo {
            content: "a".into(),
            status: TodoStatus::InProgress,
        }],
    };
    let value: Value = serde_json::from_str(&plan.to_json()).unwrap();
    assert_eq!(
        value,
        json!({"kind": "todos", "todos": [{"content": "a", "status": "in_progress"}]})
    );
    let text = Plan::Text {
        markdown: "m".into(),
    };
    let value: Value = serde_json::from_str(&text.to_json()).unwrap();
    assert_eq!(value, json!({"kind": "text", "markdown": "m"}));
}

#[test]
fn empty_todos_and_empty_plan_are_kept_as_is() {
    assert_eq!(
        Plan::from_tool("TodoWrite", &json!({"todos": []})),
        Some(Plan::Todos { todos: vec![] })
    );
    assert_eq!(
        Plan::from_tool("ExitPlanMode", &json!({"plan": ""})),
        Some(Plan::Text {
            markdown: String::new()
        })
    );
}

#[test]
fn tool_name_is_case_sensitive_and_limits_hit_exact_boundary() {
    assert_eq!(Plan::from_tool("todowrite", &json!({"todos": []})), None);
    let exact = json!({"plan": "é".repeat(100_000)});
    let Some(Plan::Text { markdown }) = Plan::from_tool("ExitPlanMode", &exact) else {
        panic!("expected text");
    };
    assert_eq!(markdown.chars().count(), 100_000);
}

#[test]
fn stored_plan_keeps_each_kind_until_replaced() {
    let mut stored = StoredPlan::default();
    stored.apply(Plan::Todos {
        todos: vec![Todo {
            content: "a".into(),
            status: TodoStatus::Pending,
        }],
    });
    stored.apply(Plan::Text {
        markdown: "m1".into(),
    });
    stored.apply(Plan::Text {
        markdown: "m2".into(),
    });
    assert_eq!(stored.todos.len(), 1);
    assert_eq!(stored.markdown.as_deref(), Some("m2"));

    let value: Value = serde_json::from_str(&stored.to_json()).unwrap();
    assert_eq!(
        value,
        json!({"todos": [{"content": "a", "status": "pending"}], "markdown": "m2"})
    );
    assert_eq!(StoredPlan::from_json(&stored.to_json()), Some(stored));
    assert_eq!(StoredPlan::from_json("not json"), None);
}
