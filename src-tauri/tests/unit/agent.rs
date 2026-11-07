use super::*;

fn options(session: Option<&str>) -> TurnOptions<'_> {
    TurnOptions {
        session,
        model: None,
        mode: None,
        add_dirs: &[],
        fork: false,
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

fn args(
    kind: CliKind,
    session: Option<&str>,
    model: Option<&str>,
    mode: Option<&str>,
    add_dirs: &[String],
) -> Vec<String> {
    kind.agent().unwrap().turn_args(&TurnOptions {
        session,
        model,
        mode,
        add_dirs,
        fork: false,
    })
}

#[test]
fn the_language_rule_goes_in_front_of_the_prompt() {
    assert_eq!(with_language("Xin chào", ""), "Xin chào");
    assert!(with_language("hello", "vi").starts_with("[Luôn trả lời bằng tiếng Việt"));
    assert!(with_language("hello", "vi").ends_with("\n\nhello"));
    assert!(with_language("xin chào", "en").starts_with("[Always answer in English"));
}

#[test]
fn extra_projects_become_add_dir_flags() {
    let dirs = vec!["/a".to_string(), "/b".to_string()];
    let claude = args(CliKind::Claude, None, None, None, &dirs);

    assert_eq!(
        claude[claude.len() - 4..],
        ["--add-dir", "/a", "--add-dir", "/b"]
    );

    let codex = args(CliKind::Codex, Some("s"), None, None, &dirs);

    assert_eq!(
        codex[..6],
        ["exec", "--add-dir", "/a", "--add-dir", "/b", "resume"]
    );
    assert!(!args(CliKind::Claude, None, None, None, &[])
        .iter()
        .any(|arg| arg == "--add-dir"));
}

#[test]
fn plan_mode_asks_the_person_but_the_side_chat_stays_read_only() {
    let stdio = |mode: Option<&str>| {
        let list = args(CliKind::Claude, None, None, mode, &[]);

        (
            list.windows(2)
                .any(|pair| pair == ["--input-format", "stream-json"]),
            list.windows(2)
                .any(|pair| pair == ["--permission-prompt-tool", "stdio"]),
            list.windows(2)
                .any(|pair| pair == ["--permission-mode", "plan"]),
        )
    };

    assert_eq!(stdio(Some(PLAN_MODE)), (true, true, true));
    assert_eq!(stdio(Some(READ_ONLY_PLAN_MODE)), (false, false, true));
    assert_eq!(stdio(Some("auto")), (false, false, false));
    assert!(asks_person(Some(PLAN_MODE)) && asks_person(Some(ASK_MODE)));
    assert!(!asks_person(Some(READ_ONLY_PLAN_MODE)) && !asks_person(Some("auto")));
    assert!(!asks_person(None));
    assert!(valid_mode(READ_ONLY_PLAN_MODE));

    // * Only plan mode of a side-chat run changes; the main chat and other modes are as the person chose.
    assert_eq!(
        mode_for_run("side-1", Some(PLAN_MODE)),
        Some(READ_ONLY_PLAN_MODE)
    );
    assert_eq!(mode_for_run("run-1", Some(PLAN_MODE)), Some(PLAN_MODE));
    assert_eq!(mode_for_run("side-1", Some("auto")), Some("auto"));
    assert_eq!(mode_for_run("side-1", None), None);
}

#[test]
fn answer_splits_into_title_and_description() {
    assert_eq!(
        split_message("Fix login\n\nBody line\nmore"),
        ("Fix login".to_string(), "Body line\nmore".to_string())
    );
    assert_eq!(
        split_message("Only title"),
        ("Only title".to_string(), String::new())
    );
}

#[test]
fn resume_arguments_differ_per_cli() {
    assert!(args(CliKind::Claude, Some("s"), None, None, &[])
        .ends_with(&["--resume".into(), "s".into()]));
    assert_eq!(
        args(CliKind::Codex, Some("s"), None, None, &[])[..3],
        ["exec".to_string(), "resume".to_string(), "s".to_string()]
    );
    assert_eq!(
        args(CliKind::Codex, None, None, None, &[])
            .last()
            .map(String::as_str),
        Some("-")
    );
}

#[test]
fn model_goes_to_the_flag_of_each_cli() {
    assert!(args(CliKind::Claude, None, Some("opus"), None, &[])
        .ends_with(&["--model".into(), "opus".into()]));
    assert_eq!(
        args(CliKind::Codex, Some("s"), Some("gpt-5"), None, &[])[..5],
        [
            "exec".to_string(),
            "-m".to_string(),
            "gpt-5".to_string(),
            "resume".to_string(),
            "s".to_string()
        ]
    );
}

#[test]
fn permission_mode_is_a_claude_flag_only() {
    let claude = args(CliKind::Claude, None, None, Some("plan"), &[]);

    assert!(claude
        .windows(2)
        .any(|pair| pair == ["--permission-mode", "plan"]));
    assert!(!args(CliKind::Codex, None, None, Some("plan"), &[])
        .iter()
        .any(|arg| arg == "--permission-mode"));
    assert!(valid_mode("acceptEdits"));
    assert!(valid_mode("bypassPermissions"));
    assert!(!valid_mode("--x"));
    assert!(!valid_mode("Bypass"));
}

#[test]
fn bypass_permissions_is_a_plain_permission_mode_without_the_ask_stream() {
    let args = args(CliKind::Claude, None, None, Some("bypassPermissions"), &[]);

    assert!(args
        .windows(2)
        .any(|pair| pair == ["--permission-mode", "bypassPermissions"]));
    assert!(!args.iter().any(|arg| arg == "--permission-prompt-tool"));
}

#[test]
fn model_names_cannot_become_flags() {
    assert!(valid_model("claude-opus-4.1"));
    assert!(valid_model("gpt-5-codex"));
    assert!(!valid_model("--dangerous"));
    assert!(!valid_model("a b"));
    assert!(!valid_model(""));
}

#[test]
fn options_are_validated_model_first_then_mode() {
    let options = |model, mode| TurnOptions {
        session: None,
        model,
        mode,
        add_dirs: &[],
        fork: false,
    };

    assert_eq!(
        options(Some("--x"), Some("--y")).validate(),
        Err("agent.model_invalid")
    );
    assert_eq!(
        options(Some("opus"), Some("--y")).validate(),
        Err("agent.mode_invalid")
    );
    assert_eq!(options(Some("opus"), Some("plan")).validate(), Ok(()));
    assert_eq!(options(None, None).validate(), Ok(()));
}

#[test]
fn unknown_cli_name_is_rejected() {
    assert_eq!(CliKind::parse_agent("claude"), Some(CliKind::Claude));
    assert_eq!(
        CliKind::parse_agent("codex").map(CliKind::name),
        Some("codex")
    );
    assert_eq!(CliKind::parse_agent("rm"), None);
    assert_eq!(CliKind::parse_agent("github"), None);
}

#[test]
fn only_the_chat_clis_have_an_agent() {
    assert_eq!(
        CliKind::Claude.agent().map(|agent| agent.kind()),
        Some(CliKind::Claude)
    );
    assert_eq!(
        CliKind::Codex.agent().map(|agent| agent.kind()),
        Some(CliKind::Codex)
    );
    assert!(CliKind::Github.agent().is_none());
    assert!(!CliKind::Codex.agent().unwrap().supports_ask_mode());
    assert!(CliKind::Codex
        .agent()
        .unwrap()
        .turn_environment(vec![("K", "v".into())], true)
        .is_empty());
}

#[test]
fn the_filter_drops_repeated_text_and_foreign_sub_agent_results() {
    let mut filter = EventFilter::default();
    let started = Event::Subagent(r#"{"id":"t1","label":"x"}"#.to_string());

    assert!(filter.admit(&Event::Text("whole".into())));
    assert!(filter.admit(&Event::Delta("wh".into())));
    assert!(!filter.admit(&Event::Text("whole".into())));
    assert!(filter.admit(&Event::Text("next".into())));
    assert!(!filter.admit(&Event::SubagentDone("t1".into())));
    assert!(filter.admit(&started));
    assert!(filter.admit(&Event::SubagentDone("t1".into())));
}

#[test]
fn a_responder_without_an_open_turn_answers_turn_ended() {
    let responder = Responder::new();

    assert_eq!(
        responder.answer("r1", &Decision::Deny),
        Err("agent.turn_ended".to_string())
    );
}

#[test]
fn a_poisoned_responder_answers_reply_failed() {
    let responder = Responder::new();
    let shared = responder.clone();

    let _ = std::thread::spawn(move || {
        let _guard = shared.0.lock().unwrap();
        panic!("poison");
    })
    .join();

    assert_eq!(
        responder.answer("r1", &Decision::Deny),
        Err("agent.reply_failed".to_string())
    );
}
