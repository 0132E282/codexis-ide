use super::*;

#[test]
fn claude_json_gives_state_and_account() {
    assert_eq!(
        claude_state(r#"{"loggedIn": true, "email": "a@b.c"}"#),
        (true, Some("a@b.c".to_string()))
    );
    assert_eq!(
        claude_state(r#"{"loggedIn": false, "email": "a@b.c"}"#),
        (false, None)
    );
    assert_eq!(claude_state("not json"), (false, None));
}

#[test]
fn usage_limits_are_read_from_the_usage_output() {
    let text = "You are using your subscription\n\nCurrent session: 12% used · resets Nov 5 at 12:29am (Asia/Saigon)\nCurrent week (all models): 3% used · resets Nov 11 at 10:59am (Asia/Saigon)\n\nLast 24h · 1661 requests";
    let limits = parse_limits(text);

    assert_eq!(limits.len(), 2);
    assert_eq!(limits[0].label, "Current session");
    assert_eq!(limits[0].percent, 12);
    assert_eq!(
        limits[1].resets.as_deref(),
        Some("Nov 11 at 10:59am (Asia/Saigon)")
    );
    assert!(parse_limits("nothing here").is_empty());
}

#[test]
fn claude_details_show_only_whitelisted_fields() {
    let details = claude_details(
        r#"{"loggedIn": true, "email": "a@b.c", "authMethod": "claude.ai", "accessToken": "secret"}"#,
    );
    let labels: Vec<&str> = details.iter().map(|row| row.label).collect();

    assert_eq!(labels, ["auth.detail.account", "auth.detail.auth_method"]);
    assert!(details.iter().all(|row| !row.value.contains("secret")));
}
