use super::*;

#[test]
fn token_is_32_hex_characters_and_never_repeats() {
    let first = generate_token().unwrap();

    assert_eq!(first.len(), 32);
    assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_ne!(first, generate_token().unwrap());
}

#[test]
fn events_of_side_runs_are_not_sent_to_the_phone() {
    assert_eq!(event_message(r#"{"runId":"side-1","kind":"text"}"#), None);
    assert_eq!(event_message(r#"{"runId":"side-","kind":"text"}"#), None);

    let message = event_message(r#"{"runId":"run-1","kind":"text"}"#).unwrap();
    let value: serde_json::Value = serde_json::from_str(&message).unwrap();
    assert_eq!(value["type"], "event");
    assert_eq!(value["runId"], "run-1");

    assert!(event_message(r#"{"kind":"text"}"#).is_some());
    assert!(event_message(r#"{"runId":"inside-side-1"}"#).is_some());
    assert_eq!(event_message("[1]"), None);
}

#[test]
fn side_run_filter_is_exact_prefix_match_on_string_run_ids() {
    for blocked in [r#"{"runId":"side-x"}"#, r#"{"runId":"side-side-"}"#] {
        assert_eq!(event_message(blocked), None, "{blocked}");
    }
    for passed in [
        r#"{"runId":""}"#,
        r#"{"runId":null}"#,
        r#"{"runId":42}"#,
        r#"{"runId":true}"#,
        r#"{"runId":["side-1"]}"#,
        r#"{"runId":{"a":"side-1"}}"#,
        r#"{"runId":"SIDE-1"}"#,
        r#"{"runId":"Side-1"}"#,
        r#"{"runId":"xside-1"}"#,
        r#"{"runId":" side-1"}"#,
        r#"{"runId":"side"}"#,
        r#"{"RunId":"side-1"}"#,
    ] {
        let message = event_message(passed).unwrap_or_else(|| panic!("dropped {passed}"));
        let value: serde_json::Value = serde_json::from_str(&message).unwrap();
        assert_eq!(value["type"], "event", "{passed}");
    }
    for not_object in ["null", "\"side-1\"", "7", "", "{bad"] {
        assert_eq!(event_message(not_object), None, "{not_object}");
    }
}

#[test]
fn tokens_match_only_when_equal() {
    assert!(tokens_match("abc", "abc"));
    assert!(!tokens_match("abd", "abc"));
    assert!(!tokens_match("ab", "abc"));
    assert!(!tokens_match("abcd", "abc"));
    assert!(!tokens_match("", "abc"));
}

#[test]
fn messages_of_the_phone_are_parsed() {
    assert_eq!(
        parse_message(r#"{"type":"auth","token":"t"}"#),
        Some(ClientMessage::Auth {
            token: "t".to_string()
        })
    );
    assert_eq!(
        parse_message(r#"{"type":"send","prompt":"hi"}"#),
        Some(ClientMessage::Send {
            prompt: "hi".to_string()
        })
    );
    assert_eq!(parse_message(r#"{"type":"other"}"#), None);
    assert_eq!(parse_message("not json"), None);
}

#[test]
fn only_a_send_with_a_usable_prompt_is_accepted() {
    let long = format!(
        r#"{{"type":"send","prompt":"{}"}}"#,
        "x".repeat(MAX_PROMPT_CHARS + 1)
    );
    let limit = format!(
        r#"{{"type":"send","prompt":"{}"}}"#,
        "x".repeat(MAX_PROMPT_CHARS)
    );

    assert_eq!(
        PhoneGate::accepted_prompt(r#"{"type":"send","prompt":"hi"}"#),
        Some("hi".to_string())
    );
    assert_eq!(
        PhoneGate::accepted_prompt(r#"{"type":"send","prompt":"  "}"#),
        None
    );
    assert_eq!(
        PhoneGate::accepted_prompt(r#"{"type":"auth","token":"t"}"#),
        None
    );
    assert_eq!(PhoneGate::accepted_prompt("not json"), None);
    assert_eq!(PhoneGate::accepted_prompt(&long), None);
    assert!(PhoneGate::accepted_prompt(&limit).is_some());
}

#[test]
fn the_gate_holds_at_most_three_phones() {
    let gate = PhoneGate::new("t".to_string());

    for expected in 1..=MAX_PHONES {
        assert!(gate.has_room());
        assert_eq!(gate.joined(), expected);
    }

    assert!(!gate.has_room());
    assert_eq!(gate.left(), MAX_PHONES - 1);
    assert!(gate.has_room());
}

#[test]
fn only_a_network_address_is_reachable() {
    assert!(reachable("192.168.1.20".parse().unwrap()));
    assert!(!reachable("127.0.0.1".parse().unwrap()));
    assert!(!reachable("0.0.0.0".parse().unwrap()));
    assert!(!reachable("::1".parse().unwrap()));
}

#[test]
fn chat_events_get_the_event_type() {
    let message = event_message(r#"{"runId":"r","kind":"text","text":"x"}"#).unwrap();
    let value: serde_json::Value = serde_json::from_str(&message).unwrap();

    assert_eq!(value["type"], "event");
    assert_eq!(value["runId"], "r");
    assert_eq!(value["kind"], "text");
    assert_eq!(event_message("[1]"), None);
}
