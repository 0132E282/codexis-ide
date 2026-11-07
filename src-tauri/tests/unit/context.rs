use super::*;
use serde_json::json;

#[test]
fn claude_sums_input_and_cache() {
    let usage = json!({"input_tokens": 100, "cache_read_input_tokens": 300,
        "cache_creation_input_tokens": 100, "output_tokens": 50});
    let context = ContextUsage::from_usage(CliKind::Claude, "m", &usage, Some(1000)).unwrap();
    assert_eq!(context.used, 500);
    assert_eq!(context.window, Some(1000));
    assert_eq!(context.percent, Some(50.0));
    assert_eq!(
        (context.cache_read, context.cache_creation, context.output),
        (300, 100, 50)
    );
}

#[test]
fn codex_uses_input_and_table_window() {
    let usage = json!({"input_tokens": 200_000, "cached_input_tokens": 150_000,
        "output_tokens": 10});
    let context = ContextUsage::from_usage(CliKind::Codex, "gpt-5-codex", &usage, None).unwrap();
    assert_eq!(context.used, 200_000);
    assert_eq!(context.window, Some(400_000));
    assert_eq!(context.percent, Some(50.0));
    assert_eq!(context.cache_read, 150_000);
}

#[test]
fn unknown_model_has_no_percent() {
    let usage = json!({"input_tokens": 10, "output_tokens": 1});
    let context = ContextUsage::from_usage(CliKind::Codex, "mystery", &usage, None).unwrap();
    assert_eq!((context.window, context.percent), (None, None));
    let claude = ContextUsage::from_usage(CliKind::Claude, "x", &usage, Some(0)).unwrap();
    assert_eq!(claude.percent, None);
}

#[test]
fn percent_is_capped_at_100() {
    let usage = json!({"input_tokens": 2000, "output_tokens": 1});
    let context = ContextUsage::from_usage(CliKind::Claude, "m", &usage, Some(1000)).unwrap();
    assert_eq!(context.percent, Some(100.0));
}

#[test]
fn missing_or_zero_usage_is_none() {
    assert!(ContextUsage::from_usage(CliKind::Claude, "m", &Value::Null, None).is_none());
    assert!(ContextUsage::from_usage(CliKind::Claude, "m", &json!({}), None).is_none());
    let zero = json!({"input_tokens": 0, "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0, "output_tokens": 0});
    assert!(ContextUsage::from_usage(CliKind::Claude, "m", &zero, Some(200_000)).is_none());
}

#[test]
fn serializes_camel_case_with_null_window() {
    let usage = json!({"input_tokens": 5, "output_tokens": 1});
    let context = ContextUsage::from_usage(CliKind::Claude, "m", &usage, None).unwrap();
    let value = serde_json::to_value(&context).unwrap();
    assert_eq!(value["cacheRead"], 0);
    assert!(value["window"].is_null() && value["percent"].is_null());
}

#[test]
fn zero_used_with_output_still_reports() {
    let usage = json!({"input_tokens": 0, "output_tokens": 7});
    let context = ContextUsage::from_usage(CliKind::Claude, "m", &usage, Some(1000)).unwrap();
    assert_eq!(
        (context.used, context.output, context.percent),
        (0, 7, Some(0.0))
    );
}

#[test]
fn used_above_window_is_capped_not_dropped() {
    let usage = json!({"input_tokens": 5_000_000, "output_tokens": 1});
    let context = ContextUsage::from_usage(CliKind::Claude, "m", &usage, Some(1000)).unwrap();
    assert_eq!((context.used, context.percent), (5_000_000, Some(100.0)));
}

#[test]
fn zero_window_never_divides() {
    assert_eq!(window_of(CliKind::Claude, "m", Some(0)), None);
    assert_eq!(window_of(CliKind::Codex, "gpt-5", Some(0)), Some(400_000));
    let usage = json!({"input_tokens": 5, "output_tokens": 1});
    let context = ContextUsage::from_usage(CliKind::Codex, "mystery", &usage, Some(0)).unwrap();
    assert_eq!((context.window, context.percent), (None, None));
}

#[test]
fn window_of_by_cli_and_model() {
    assert_eq!(window_of(CliKind::Claude, "gpt-5", None), None);
    assert_eq!(window_of(CliKind::Github, "gpt-5", None), None);
    assert_eq!(window_of(CliKind::Codex, "", None), None);
    assert_eq!(window_of(CliKind::Codex, "GPT-5", None), None);
    assert_eq!(
        window_of(CliKind::Codex, "gpt-5.1-codex", None),
        Some(400_000)
    );
    assert_eq!(
        window_of(CliKind::Claude, "m", Some(1_000_000)),
        Some(1_000_000)
    );
    assert_eq!(window_of(CliKind::Codex, "gpt-5", Some(123)), Some(123));
}

#[test]
fn github_has_no_usage() {
    let usage = json!({"input_tokens": 10, "output_tokens": 1});
    assert!(ContextUsage::from_usage(CliKind::Github, "m", &usage, Some(1000)).is_none());
}

#[test]
fn usage_that_is_not_an_object_is_none() {
    for usage in [json!([1, 2]), json!("x"), json!(5), json!(true)] {
        assert!(ContextUsage::from_usage(CliKind::Claude, "m", &usage, None).is_none());
        assert!(ContextUsage::from_usage(CliKind::Codex, "m", &usage, None).is_none());
    }
}

#[test]
fn non_u64_fields_count_as_zero() {
    let usage = json!({"input_tokens": "9", "output_tokens": -3,
        "cache_read_input_tokens": 1.5});
    assert!(ContextUsage::from_usage(CliKind::Claude, "m", &usage, None).is_none());
}

#[test]
fn large_u64_values_do_not_overflow() {
    let big = u64::MAX / 4;
    let usage = json!({"input_tokens": big, "cache_read_input_tokens": big,
        "cache_creation_input_tokens": big, "output_tokens": u64::MAX});
    let context = ContextUsage::from_usage(CliKind::Claude, "m", &usage, Some(u64::MAX)).unwrap();
    assert_eq!(context.used, big * 3);
    assert_eq!(context.output, u64::MAX);
    let percent = context.percent.unwrap();
    assert!(percent.is_finite() && (0.0..=100.0).contains(&percent));
}

#[test]
fn serializes_every_field_in_camel_case() {
    let usage = json!({"input_tokens": 1, "cache_read_input_tokens": 2,
        "cache_creation_input_tokens": 3, "output_tokens": 4});
    let context = ContextUsage::from_usage(CliKind::Claude, "m", &usage, Some(10)).unwrap();
    let value = serde_json::to_value(&context).unwrap();
    let object = value.as_object().unwrap();
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "cacheCreation",
            "cacheRead",
            "input",
            "model",
            "output",
            "percent",
            "used",
            "window"
        ]
    );
    assert_eq!(
        (value["used"].as_u64(), value["window"].as_u64()),
        (Some(6), Some(10))
    );
    assert_eq!(value["percent"].as_f64(), Some(60.0));
}

#[test]
fn huge_token_counts_saturate_instead_of_overflowing() {
    let usage = json!({"input_tokens": u64::MAX, "cache_read_input_tokens": 5,
        "cache_creation_input_tokens": 5, "output_tokens": 1});
    let context = ContextUsage::from_usage(CliKind::Claude, "m", &usage, Some(1000)).unwrap();
    assert_eq!(context.used, u64::MAX);
    assert_eq!(context.percent, Some(100.0));
}
