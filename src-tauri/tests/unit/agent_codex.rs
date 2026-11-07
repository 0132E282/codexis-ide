use super::*;

#[test]
fn codex_lines_map_to_events() {
    let thread = r#"{"type":"thread.started","thread_id":"t1"}"#;
    let message = r#"{"type":"item.completed","item":{"type":"agent_message","text":"Hi"}}"#;
    let notice = r#"{"type":"item.completed","item":{"type":"error","message":"noise"}}"#;
    let failed = r#"{"type":"turn.failed","error":{"message":"bad model"}}"#;

    assert_eq!(
        CodexAgent.parse_line(thread),
        vec![Event::Session("t1".into())]
    );
    assert_eq!(
        CodexAgent.parse_line(message),
        vec![Event::Text("Hi".into())]
    );
    assert!(CodexAgent.parse_line(notice).is_empty());
    assert_eq!(
        CodexAgent.parse_line(failed),
        vec![Event::Error("bad model".into())]
    );
    assert!(CodexAgent.parse_line("not json").is_empty());
}

#[test]
fn codex_turn_completed_gives_context_assumed_format() {
    let done = r#"{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":20}}"#;
    let events = CodexAgent.parse_line(done);
    let [Event::Context(json)] = events.as_slice() else {
        panic!("expected one context event: {events:?}");
    };
    let context: serde_json::Value = serde_json::from_str(json).unwrap();

    assert_eq!(context["used"], 1000);
    assert_eq!(context["cacheRead"], 400);
    assert!(context["percent"].is_null());
    assert!(CodexAgent
        .parse_line(r#"{"type":"turn.completed"}"#)
        .is_empty());
}

#[test]
fn codex_arguments_follow_the_documented_order() {
    let dirs = vec!["/a".to_string(), "/b".to_string()];
    let args = CodexAgent.turn_args(&TurnOptions {
        session: Some("s"),
        model: Some("gpt-5"),
        mode: Some("plan"),
        add_dirs: &dirs,
    });

    assert_eq!(
        args,
        [
            "exec",
            "--add-dir",
            "/a",
            "--add-dir",
            "/b",
            "-m",
            "gpt-5",
            "resume",
            "s",
            "--json",
            "--skip-git-repo-check",
            "-"
        ]
    );
}
