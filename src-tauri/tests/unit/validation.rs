use super::*;

fn key<T>(result: Result<T, ValidationError>) -> String {
    result.err().expect("rejected").key().to_string()
}

#[test]
fn session_cannot_become_a_flag() {
    for good in [
        "0b1c9f3e-5a2d-4c7e-9a10-2f6d8b7e1c34",
        "abc_DEF.1-2",
        &"a".repeat(128),
    ] {
        assert!(valid_session(good).is_ok(), "{good}");
    }

    for bad in [
        "--dangerously-skip-permissions",
        "-x",
        "",
        "a b",
        "a\n",
        "a\0b",
        "_a",
        ".a",
        "é",
        &"a".repeat(129),
    ] {
        assert_eq!(key(valid_session(bad)), KEY_BAD_SESSION, "{bad:?}");
    }
}

#[test]
fn model_rules() {
    assert!(valid_model("claude-opus-4.1").is_ok());
    assert!(valid_model("gpt-5:codex_x").is_ok());
    assert!(valid_model(&"a".repeat(100)).is_ok());

    for bad in ["--dangerous", "-m", "a b", "", "a/b"] {
        assert_eq!(key(valid_model(bad)), KEY_BAD_MODEL, "{bad:?}");
    }

    assert_eq!(key(valid_model(&"a".repeat(101))), KEY_BAD_MODEL);
}

#[test]
fn prompt_bounds() {
    assert!(prompt("Giải thích đoạn này").is_ok());
    assert!(prompt(&"a".repeat(200_000)).is_ok());
    assert_eq!(key(prompt(&"a".repeat(200_001))), KEY_TOO_LONG);
    assert_eq!(key(prompt(" \n\t ")), KEY_EMPTY);
    assert_eq!(key(prompt("")), KEY_EMPTY);
    assert_eq!(key(prompt("a\0b")), KEY_CONTROL_CHAR);
}

#[test]
fn request_id_rules() {
    assert!(request_id("req_1:a-b.c").is_ok());
    assert!(request_id(&"a".repeat(128)).is_ok());

    for bad in ["", "a b", "a\n", "a/b", "é"] {
        assert_eq!(key(request_id(bad)), KEY_BAD_REQUEST_ID, "{bad:?}");
    }

    assert_eq!(key(request_id(&"a".repeat(129))), KEY_BAD_REQUEST_ID);
}

#[test]
fn permission_input_is_bounded() {
    assert!(permission_input(&serde_json::json!({"command": "ls"})).is_ok());
    assert!(permission_input(&serde_json::Value::Null).is_ok());

    let big = serde_json::json!({"text": "a".repeat(MAX_PERMISSION_INPUT_BYTES)});

    assert_eq!(key(permission_input(&big)), KEY_TOO_LONG);
}
