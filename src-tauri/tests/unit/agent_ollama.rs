use super::*;

#[test]
fn ollama_runs_the_selected_model_without_session_flags() {
    let options = TurnOptions {
        session: Some("ignored"),
        model: Some("qwen3:8b"),
        mode: Some("plan"),
        add_dirs: &["/ignored".to_string()],
        fork: true,
    };

    assert_eq!(
        OllamaAgent.turn_args(&options),
        ["run".to_string(), "qwen3:8b".to_string()]
    );
}

#[test]
fn ollama_output_lines_are_text_events() {
    assert_eq!(
        OllamaAgent.parse_line("local answer"),
        [Event::Text("local answer".to_string())]
    );
    assert!(OllamaAgent.parse_line("").is_empty());
}
