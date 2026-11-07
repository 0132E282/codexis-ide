use super::*;

fn options(session: Option<&str>) -> TurnOptions<'_> {
    TurnOptions {
        session,
        model: None,
        mode: None,
        add_dirs: &[],
    }
}

#[test]
fn a_session_that_looks_like_a_flag_is_rejected() {
    for bad in [
        "--dangerously-skip-permissions",
        "-x",
        "",
        "a b",
        "a\n",
        "a\0b",
    ] {
        assert_eq!(
            options(Some(bad)).validate(),
            Err(validation::KEY_BAD_SESSION),
            "{bad:?}"
        );
    }

    assert_eq!(
        options(Some(&"a".repeat(129))).validate(),
        Err(validation::KEY_BAD_SESSION)
    );
    assert_eq!(
        options(Some("0b1c9f3e-5a2d-4c7e-9a10-2f6d8b7e1c34")).validate(),
        Ok(())
    );
    assert_eq!(options(None).validate(), Ok(()));
}

#[test]
fn a_valid_session_never_gives_a_dash_argument_after_resume() {
    let session = "0b1c9f3e-5a2d-4c7e-9a10-2f6d8b7e1c34";

    for kind in [CliKind::Claude, CliKind::Codex] {
        let args = kind.agent().unwrap().turn_args(&options(Some(session)));
        let at = args
            .iter()
            .position(|arg| arg == "--resume" || arg == "resume")
            .expect("resume");

        assert_eq!(args[at + 1], session);
    }
}

#[test]
fn a_permission_can_only_be_answered_once_and_only_if_asked() {
    let responder = Responder::new();

    // * Without an open turn the input check comes first, as before.
    assert_eq!(
        responder.answer("r1", &Decision::Deny),
        Err("agent.turn_ended".to_string())
    );

    let mut child = std::process::Command::new("cat")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();

    responder.attach(child.stdin.take().unwrap());
    responder.expect("r1");

    assert_eq!(
        responder.answer("r2", &Decision::Deny),
        Err(validation::KEY_REQUEST_UNKNOWN.to_string())
    );
    assert_eq!(responder.answer("r1", &Decision::Deny), Ok(()));
    assert_eq!(
        responder.answer("r1", &Decision::Deny),
        Err(validation::KEY_REQUEST_UNKNOWN.to_string())
    );

    responder.close();
    let _ = child.wait();
}

#[test]
fn the_id_of_a_permission_event_is_read() {
    assert_eq!(
        permission_id(r#"{"id":"r1","tool":"Write"}"#),
        Some("r1".to_string())
    );
    assert_eq!(permission_id(r#"{"id":5}"#), None);
    assert_eq!(permission_id("nope"), None);
}
