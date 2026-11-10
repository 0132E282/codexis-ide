use super::*;

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
    let output = "Current model: `Sonnet 5.5`\nUsage: /model <name>. Available: sonnet, opus, sonnet[1m], default, or a full model ID.\n";
    let models: Vec<_> = parse_claude_models(output)
        .into_iter()
        .map(|option| (option.value, option.label))
        .collect();

    assert_eq!(
        models,
        [
            ("sonnet".to_string(), "Sonnet".to_string()),
            ("opus".to_string(), "Opus".to_string()),
            ("sonnet[1m]".to_string(), "Sonnet (1M)".to_string()),
            ("default".to_string(), "Default".to_string()),
        ]
    );
    assert!(parse_claude_models("Current model: x").is_empty());
}
