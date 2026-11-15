use super::*;

fn options<'a>(session: Option<&'a str>, model: Option<&'a str>) -> TurnOptions<'a> {
    TurnOptions {
        session,
        model,
        mode: None,
        add_dirs: &[],
        blocked_dirs: &[],
        fork: false,
    }
}

#[test]
fn arguments_read_the_prompt_from_stdin_and_pick_an_agent_or_a_session() {
    let agent = OpenClawAgent;

    assert_eq!(
        agent.turn_args(&options(None, Some("openai/gpt-x"))),
        [
            "agent",
            "--json",
            "--message-file",
            "-",
            "--agent",
            "main",
            "--model",
            "openai/gpt-x"
        ]
    );
    assert_eq!(
        agent.turn_args(&options(Some("s1"), None)),
        [
            "agent",
            "--json",
            "--message-file",
            "-",
            "--session-id",
            "s1"
        ]
    );
    assert!(agent.prompt_args("hi").is_empty());
}

#[test]
fn the_document_gives_the_session_and_the_answer() {
    let output = r#"warning: gateway fallback
{"ok":true,"sessionId":"s9","payloads":[{"text":"One"},{"text":"Two"}]}"#;

    assert_eq!(
        OpenClawAgent.parse_output(output),
        vec![
            Event::Session("s9".to_string()),
            Event::Text("One\n\nTwo".to_string())
        ]
    );
}

#[test]
fn a_failed_run_is_an_error_and_plain_output_is_the_answer() {
    let failed = r#"{"ok":false,"error":{"type":"cli_error","message":"no gateway"}}"#;

    assert_eq!(
        OpenClawAgent.parse_output(failed),
        vec![Event::Error("no gateway".to_string())]
    );
    assert_eq!(
        OpenClawAgent.parse_output("just text\n"),
        vec![Event::Text("just text".to_string())]
    );
    assert!(OpenClawAgent.parse_output("").is_empty());
}
