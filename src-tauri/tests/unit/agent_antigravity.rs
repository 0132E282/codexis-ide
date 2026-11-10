use super::*;

#[test]
fn lines_map_to_events() {
    let agent = AntigravityAgent;
    let init = r#"{"event":"init","conversation_id":"c1","init":{}}"#;
    let delta = r#"{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":"Hi"}}"#;
    let user = r#"{"event":"step_update","step_update":{"step_type":"user_input","state":"DONE"}}"#;
    let ok = r#"{"event":"result","result":{"status":"SUCCESS","response":"Hi"}}"#;
    let failed = r#"{"event":"result","result":{"status":"ERROR","response":"bad model"}}"#;

    assert_eq!(
        agent.parse_line(init),
        vec![Event::Session("c1".to_string())]
    );
    assert_eq!(
        agent.parse_line(delta),
        vec![Event::Delta("Hi".to_string())]
    );
    assert!(agent.parse_line(user).is_empty());
    assert!(agent.parse_line(ok).is_empty());
    assert_eq!(
        agent.parse_line(failed),
        vec![Event::Error("bad model".to_string())]
    );
    assert!(agent.parse_line("not json").is_empty());
}

#[test]
fn arguments_carry_model_session_and_attached_prompt() {
    let agent = AntigravityAgent;
    let options = TurnOptions {
        session: Some("c1"),
        model: Some("gemini-3.8-flash-low"),
        mode: None,
        add_dirs: &[],
        fork: false,
    };

    assert_eq!(
        agent.turn_args(&options),
        [
            "--output-format",
            "stream-json",
            "--model",
            "gemini-3.8-flash-low",
            "--conversation",
            "c1"
        ]
    );
    assert_eq!(agent.prompt_args("-x hi"), ["--print=-x hi"]);
}
