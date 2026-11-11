use super::*;

#[test]
fn ollama_runs_the_claude_cli_with_the_selected_model() {
    let options = TurnOptions {
        session: None,
        model: Some("qwen3:8b"),
        mode: None,
        add_dirs: &[],
        fork: false,
    };
    let args = OllamaAgent.turn_args(&options);

    assert_eq!(OllamaAgent.program(), "claude");
    assert!(args.windows(2).any(|pair| pair == ["--model", "qwen3:8b"]));
}

#[test]
fn ollama_points_the_cli_at_the_local_server() {
    let environment = OllamaAgent.turn_environment(Vec::new(), false);

    assert!(environment.contains(&("ANTHROPIC_BASE_URL", OLLAMA_URL.to_string())));
    assert!(environment.contains(&("ANTHROPIC_AUTH_TOKEN", "ollama".to_string())));
}
