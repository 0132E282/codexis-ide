use super::*;

#[test]
fn ollama_models_are_read_from_the_name_column() {
    let output = "NAME             ID              SIZE      MODIFIED\nqwen3:8b         abc123          5.2 GB    2 days ago\nllama3.2:latest  def456          2.0 GB    1 hour ago\n";

    assert_eq!(
        parse_ollama_models(output),
        [
            ModelOption {
                value: "qwen3:8b".to_string(),
                label: "qwen3:8b".to_string(),
            },
            ModelOption {
                value: "llama3.2:latest".to_string(),
                label: "llama3.2:latest".to_string(),
            },
        ]
    );
}

#[test]
fn ollama_models_require_the_expected_header_and_skip_empty_or_repeated_headers() {
    assert!(parse_ollama_models("").is_empty());
    assert!(parse_ollama_models("NAME ID SIZE MODIFIED\n").is_empty());
    assert!(parse_ollama_models("MODEL ID SIZE MODIFIED\nqwen3:8b x 5 GB\n").is_empty());

    let output = "notice\nNAME ID SIZE MODIFIED\n\nNAME ID SIZE MODIFIED\nqwen3:8b x 5 GB\n";
    assert_eq!(
        parse_ollama_models(output),
        [ModelOption {
            value: "qwen3:8b".to_string(),
            label: "qwen3:8b".to_string(),
        }]
    );
}

#[test]
fn codex_models_are_the_listed_ones_in_priority_order() {
    let dir = tempfile::tempdir().unwrap();

    fs::write(
        dir.path().join("models_cache.json"),
        r#"{"models":[
            {"slug":"gpt-b","display_name":"GPT B","visibility":"list","priority":2},
            {"slug":"internal","display_name":"Internal","visibility":"hide","priority":1},
            {"slug":"gpt-a","display_name":"GPT A","visibility":"list","priority":1},
            {"slug":"gpt-c","priority":3}
        ]}"#,
    )
    .unwrap();

    let values: Vec<_> = codex_models(dir.path())
        .into_iter()
        .map(|option| (option.value, option.label))
        .collect();

    assert_eq!(
        values,
        [
            ("gpt-a".to_string(), "GPT A".to_string()),
            ("gpt-b".to_string(), "GPT B".to_string()),
            ("gpt-c".to_string(), "gpt-c".to_string()),
        ]
    );
}

#[test]
fn codex_models_leave_out_those_that_cannot_code() {
    let dir = tempfile::tempdir().unwrap();

    fs::write(
        dir.path().join("models_cache.json"),
        r#"{"models":[
            {"slug":"coder","visibility":"list","supported_in_api":true,"input_modalities":["text","image"],"shell_type":"unified_exec","priority":1},
            {"slug":"not-in-api","visibility":"list","supported_in_api":false,"priority":2},
            {"slug":"audio","visibility":"list","input_modalities":["audio"],"priority":3},
            {"slug":"no-shell","visibility":"list","shell_type":"disabled","priority":4}
        ]}"#,
    )
    .unwrap();

    let values: Vec<_> = codex_models(dir.path())
        .into_iter()
        .map(|option| option.value)
        .collect();

    assert_eq!(values, ["coder"]);
}

#[test]
fn a_missing_or_broken_cache_gives_no_models() {
    let dir = tempfile::tempdir().unwrap();

    assert!(codex_models(dir.path()).is_empty());

    fs::write(dir.path().join("models_cache.json"), "not json").unwrap();

    assert!(codex_models(dir.path()).is_empty());
}

#[test]
fn claude_aliases_are_read_from_the_model_answer() {
    let output = "Current model: `Sonnet 5.5`\nUsage: /model <name>. Available: sonnet, opus, fable[1m], haiku, best, sonnet[1m], opusplan, default, or a full model ID.\n";
    let models: Vec<_> = parse_claude_models(output)
        .into_iter()
        .map(|option| (option.value, option.label))
        .collect();

    assert_eq!(
        models,
        [
            ("sonnet".to_string(), "Sonnet 5.5".to_string()),
            ("opus".to_string(), "Opus 5.5".to_string()),
            ("fable[1m]".to_string(), "Fable 5.1 (1M)".to_string()),
            ("haiku".to_string(), "Haiku 5.5".to_string()),
            ("best".to_string(), "Best".to_string()),
            ("sonnet[1m]".to_string(), "Sonnet 5.5 (1M)".to_string()),
            ("opusplan".to_string(), "Opusplan".to_string()),
            ("default".to_string(), "Default".to_string()),
        ]
    );
    assert!(parse_claude_models("Current model: x").is_empty());
}

#[test]
fn antigravity_models_are_the_tab_separated_lines() {
    let output = "Fetching available models...\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n";
    let models = parse_antigravity_models(output);

    assert_eq!(models.len(), 2);
    assert_eq!(models[0].value, "gemini-3.8-flash-low");
    assert_eq!(models[1].label, "Claude Sonnet 4.6 (Thinking)");
    assert!(parse_antigravity_models("Error: Please sign in").is_empty());
}
