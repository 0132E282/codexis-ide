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
fn a_missing_or_broken_cache_gives_no_models() {
    let dir = tempfile::tempdir().unwrap();

    assert!(codex_models(dir.path()).is_empty());

    fs::write(dir.path().join("models_cache.json"), "not json").unwrap();

    assert!(codex_models(dir.path()).is_empty());
}

fn option(value: &str) -> ModelOption {
    ModelOption {
        value: value.to_string(),
        label: value.to_uppercase(),
    }
}

#[test]
fn saved_models_keep_the_order_and_are_replaced_on_the_next_connect() {
    let store = ModelStore::new(Connection::open_in_memory().unwrap()).unwrap();

    store.replace("codex", &[option("b"), option("a")]).unwrap();
    store.replace("claude", &[option("x")]).unwrap();

    assert_eq!(store.list("codex").unwrap(), [option("b"), option("a")]);

    store.replace("codex", &[option("c")]).unwrap();

    assert_eq!(store.list("codex").unwrap(), [option("c")]);
    assert_eq!(store.list("claude").unwrap(), [option("x")]);
}

#[test]
fn an_empty_list_keeps_what_was_saved() {
    let store = ModelStore::new(Connection::open_in_memory().unwrap()).unwrap();

    store.replace("codex", &[option("a")]).unwrap();
    store.replace("codex", &[]).unwrap();

    assert_eq!(store.list("codex").unwrap(), [option("a")]);
}
