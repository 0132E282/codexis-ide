use super::*;

fn store() -> (tempfile::TempDir, ChatStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = ChatStore::open(dir.path().join("rynox.db"));

    (dir, store)
}

fn turn(id: &str, answer: &str) -> ChatTurn {
    ChatTurn {
        id: id.into(),
        cli: "claude".into(),
        prompt: format!("hỏi {id}"),
        answer: answer.into(),
        error: None,
        steps: None,
        context: None,
    }
}

#[test]
fn turns_and_sessions_survive_a_reopen_and_stay_in_their_conversation() {
    let (dir, mut store) = store();
    let a = store.load("/a", None).unwrap().conversation;
    let b = store.load("/b", None).unwrap().conversation;

    store.save_turn("/a", a, &turn("t1", "một")).unwrap();
    store.save_turn("/a", a, &turn("t2", "hai")).unwrap();
    store.save_turn("/b", b, &turn("t1x", "khác")).unwrap();
    store.save_session("/a", a, "claude", "sess-1").unwrap();
    store.save_session("/a", a, "codex", "sess-2").unwrap();
    drop(store);

    let mut reopened = ChatStore::open(dir.path().join("rynox.db"));
    let history = reopened.load("/a", None).unwrap();

    assert_eq!(history.conversation, a);
    assert_eq!(
        history
            .turns
            .iter()
            .map(|t| t.id.as_str())
            .collect::<Vec<_>>(),
        ["t1", "t2"]
    );
    assert_eq!(history.sessions["claude"], "sess-1");
    assert_eq!(history.sessions["codex"], "sess-2");
    assert_eq!(reopened.load("/b", None).unwrap().turns[0].answer, "khác");
}

#[test]
fn saving_a_known_turn_updates_it_in_place() {
    let (_dir, mut store) = store();
    let c = store.load("/a", None).unwrap().conversation;

    store.save_turn("/a", c, &turn("t1", "nửa")).unwrap();
    store.save_turn("/a", c, &turn("t2", "hai")).unwrap();
    store.save_turn("/a", c, &turn("t1", "đủ câu")).unwrap();

    let turns = store.load("/a", Some(c)).unwrap().turns;

    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].answer, "đủ câu");
    assert_eq!(turns[1].id, "t2");
}

#[test]
fn conversations_are_listed_with_a_title_from_the_first_message_and_kept_apart() {
    let (_dir, mut store) = store();
    let first = store.load("/a", None).unwrap().conversation;

    store.save_turn("/a", first, &turn("t1", "x")).unwrap();

    let second = store.new_conversation("/a").unwrap();

    assert_ne!(first, second);
    // An empty conversation is not listed, and asking for another one reuses it.
    assert_eq!(store.list("/a").unwrap().len(), 1);
    assert_eq!(store.new_conversation("/a").unwrap(), second);

    store.save_turn("/a", second, &turn("t2", "y")).unwrap();

    let list = store.list("/a").unwrap();

    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, second);
    assert_eq!(list[0].title, "hỏi t2");
    assert_eq!(store.load("/a", Some(first)).unwrap().turns.len(), 1);
    assert!(store.list("/other").unwrap().is_empty());
}

#[test]
fn a_conversation_of_another_workspace_is_refused_and_delete_removes_everything() {
    let (_dir, mut store) = store();
    let c = store.load("/a", None).unwrap().conversation;

    store.save_turn("/a", c, &turn("t1", "x")).unwrap();
    store.save_session("/a", c, "claude", "s").unwrap();

    assert_eq!(store.load("/b", Some(c)), Err(ChatError::Invalid));
    assert_eq!(
        store.save_turn("/b", c, &turn("t9", "x")),
        Err(ChatError::Invalid)
    );
    assert_eq!(store.delete_conversation("/b", c), Err(ChatError::Invalid));

    store.delete_conversation("/a", c).unwrap();

    assert!(store.list("/a").unwrap().is_empty());
}

#[test]
fn only_the_newest_turns_are_kept() {
    let (_dir, mut store) = store();
    let c = store.load("/a", None).unwrap().conversation;

    for number in 0..MAX_TURNS + 3 {
        store
            .save_turn("/a", c, &turn(&format!("t{number}"), "x"))
            .unwrap();
    }

    let turns = store.load("/a", Some(c)).unwrap().turns;

    assert_eq!(turns.len() as i64, MAX_TURNS);
    assert_eq!(turns[0].id, "t3");
}

#[test]
fn turns_saved_before_conversations_are_grouped_on_open() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rynox.db");
    let old = Connection::open(&path).unwrap();

    old.execute_batch(
        "CREATE TABLE chat_turns (
            workspace TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL,
            cli TEXT NOT NULL, prompt TEXT NOT NULL, answer TEXT NOT NULL, error TEXT,
            archived INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace, id));
         CREATE TABLE chat_sessions (
            workspace TEXT NOT NULL, cli TEXT NOT NULL, session TEXT NOT NULL,
            PRIMARY KEY (workspace, cli));
         INSERT INTO chat_turns VALUES ('/a', 'o1', 1, 'claude', 'cũ', 'x', NULL, 1);
         INSERT INTO chat_turns VALUES ('/a', 'n1', 2, 'claude', 'hiện tại', 'y', NULL, 0);
         INSERT INTO chat_sessions VALUES ('/a', 'claude', 'sess');",
    )
    .unwrap();
    drop(old);

    let mut store = ChatStore::open(path);
    let list = store.list("/a").unwrap();

    assert_eq!(list.len(), 2);
    assert_eq!(list[0].title, "hiện tại");
    assert_eq!(list[1].title, "Cuộc trò chuyện cũ");

    let current = store.load("/a", None).unwrap();

    assert_eq!(current.turns[0].id, "n1");
    assert_eq!(current.sessions["claude"], "sess");
}

#[test]
fn saving_a_session_again_replaces_it() {
    let (_dir, mut store) = store();
    let c = store.load("/a", None).unwrap().conversation;

    store.save_session("/a", c, "claude", "old").unwrap();
    store.save_session("/a", c, "claude", "new").unwrap();

    let sessions = store.load("/a", Some(c)).unwrap().sessions;

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions["claude"], "new");
}

#[test]
fn titles_skip_attachments_and_are_cut() {
    assert_eq!(title_of("@/tmp/a.png\nxin chào"), "xin chào");
    assert_eq!(
        title_of(&"a".repeat(80)).chars().count(),
        MAX_TITLE_CHARS + 1
    );
    assert_eq!(title_of("@/tmp/a.png"), "");
}

#[test]
fn bad_input_is_refused() {
    let (_dir, mut store) = store();
    let c = store.load("/a", None).unwrap().conversation;
    let mut unknown_cli = turn("t1", "x");

    unknown_cli.cli = "gemini".into();

    assert_eq!(
        store.save_turn("/a", c, &unknown_cli),
        Err(ChatError::Invalid)
    );
    assert_eq!(
        store.save_turn("/a", c, &turn("", "x")),
        Err(ChatError::Rejected("validation.bad_run_id"))
    );
    assert_eq!(
        store.save_turn("", c, &turn("t1", "x")),
        Err(ChatError::Rejected("validation.empty"))
    );
    assert_eq!(
        store.save_session("/a", c, "claude", ""),
        Err(ChatError::Rejected("validation.bad_session"))
    );
    assert_eq!(
        store.save_session("/a", c, "gemini", "s"),
        Err(ChatError::Invalid)
    );
    assert!(store.load("/a", Some(c)).unwrap().turns.is_empty());
}

#[test]
fn turn_fields_are_validated() {
    let (_dir, mut store) = store();
    let c = store.load("/a", None).unwrap().conversation;
    let rejected = |key| Err(ChatError::Rejected(key));

    for bad in ["a/b", "a b", "../x", "é"] {
        assert_eq!(
            store.save_turn("/a", c, &turn(bad, "x")),
            rejected("validation.bad_run_id")
        );
    }
    assert_eq!(
        store.save_turn("/a", c, &turn(&"a".repeat(65), "x")),
        rejected("validation.bad_run_id")
    );
    assert!(store
        .save_turn("/a", c, &turn(&"a".repeat(64), "x"))
        .is_ok());

    let mut blank = turn("t1", "x");
    blank.prompt = "  ".into();
    assert_eq!(
        store.save_turn("/a", c, &blank),
        rejected("validation.empty")
    );

    let mut long_error = turn("t1", "x");
    long_error.error = Some("e".repeat(20_001));
    assert_eq!(
        store.save_turn("/a", c, &long_error),
        rejected("validation.too_long")
    );
    long_error.error = Some("e".repeat(20_000));
    assert!(store.save_turn("/a", c, &long_error).is_ok());

    let mut steps = turn("t2", "x");
    steps.steps = Some("{not json".into());
    assert_eq!(
        store.save_turn("/a", c, &steps),
        rejected("validation.bad_steps")
    );
    steps.steps = Some(format!("\"{}\"", "s".repeat(4_000_000)));
    assert_eq!(
        store.save_turn("/a", c, &steps),
        rejected("validation.too_long")
    );
    steps.steps = Some("[{\"kind\":\"tool\"}]".into());
    assert!(store.save_turn("/a", c, &steps).is_ok());
}

#[test]
fn workspace_keys_are_bounded() {
    let (_dir, mut store) = store();

    for bad in ["".to_string(), "a\0b".to_string(), "a".repeat(4097)] {
        assert!(matches!(
            store.new_conversation(&bad),
            Err(ChatError::Rejected(_))
        ));
        assert!(matches!(
            store.load(&bad, None),
            Err(ChatError::Rejected(_))
        ));
    }
    assert!(store.list(&"a".repeat(4097)).unwrap().is_empty());
}

#[test]
fn sessions_are_validated_on_save_and_on_load() {
    let (_dir, mut store) = store();
    let c = store.load("/a", None).unwrap().conversation;

    for bad in ["--x", "-x", "a b", "a\n", "a\0b", &"a".repeat(129)] {
        assert_eq!(
            store.save_session("/a", c, "claude", bad),
            Err(ChatError::Rejected("validation.bad_session"))
        );
    }
    store.save_session("/a", c, "claude", "good-1").unwrap();
    store
        .connection
        .execute(
            "INSERT INTO conversation_sessions (conversation, cli, session) VALUES (?1, 'codex', '--bad')",
            [c],
        )
        .unwrap();

    let sessions = store.load("/a", Some(c)).unwrap().sessions;

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions["claude"], "good-1");
}

#[test]
fn steps_of_lists_saved_steps_in_order_and_refuses_another_workspace() {
    let (_dir, mut store) = store();
    let a = store.load("/a", None).unwrap().conversation;
    let mut with_steps = turn("t1", "một");

    with_steps.steps = Some(r#"[{"kind":"tool","name":"Write","input":"a.txt"}]"#.into());
    store.save_turn("/a", a, &with_steps).unwrap();
    store.save_turn("/a", a, &turn("t2", "hai")).unwrap();

    assert_eq!(
        store.steps_of("/a", a).unwrap(),
        vec![with_steps.steps.clone().unwrap()]
    );
    assert_eq!(store.steps_of("/b", a), Err(ChatError::Invalid));
}

#[test]
fn size_of_counts_turns_failures_and_characters_of_one_conversation() {
    let (_dir, mut store) = store();
    let a = store.load("/a", None).unwrap().conversation;
    let b = store.load("/b", None).unwrap().conversation;
    let mut failed = turn("t2", "hai");

    failed.error = Some("lỗi".into());
    store.save_turn("/a", a, &turn("t1", "một")).unwrap();
    store.save_turn("/a", a, &failed).unwrap();
    store.save_turn("/b", b, &turn("t3", "khác")).unwrap();

    let size = store.size_of("/a", a).unwrap();

    assert_eq!((size.turns, size.failed_turns), (2, 1));
    assert_eq!(size.answer_characters, 6);
    assert_eq!(size.prompt_characters, 12);
    assert_eq!(size.last_cli.as_deref(), Some("claude"));
    assert_eq!(store.size_of("/a", b), Err(ChatError::Invalid));
}

#[test]
fn chat_grids_span_projects_keep_groups_and_forget_deleted_conversations() {
    let (dir, mut store) = store();
    // * An empty conversation is reused, so each one gets a turn before the next is made.
    let make = |store: &mut ChatStore, workspace: &str| {
        let id = store.new_conversation(workspace).unwrap();

        store
            .save_turn(workspace, id, &turn(&format!("t{id}"), "x"))
            .unwrap();
        id
    };
    let member = |workspace: &str, conversation: i64| GridMember {
        group: 1,
        workspace: workspace.into(),
        conversation,
        title: String::new(),
    };
    // * What the grid keeps: the titles are read from the conversations, so they are left out of the comparison.
    let pairs = |store: &ChatStore| -> Vec<(String, i64)> {
        store
            .grid()
            .unwrap()
            .into_iter()
            .map(|member| (member.workspace, member.conversation))
            .collect()
    };
    let expected = |members: &[GridMember]| -> Vec<(String, i64)> {
        members
            .iter()
            .map(|member| (member.workspace.clone(), member.conversation))
            .collect()
    };
    let a1 = make(&mut store, "/a");
    let b1 = make(&mut store, "/b");
    let a2 = make(&mut store, "/a");
    let b2 = make(&mut store, "/b");
    let c1 = make(&mut store, "/c");
    let a3 = make(&mut store, "/a");

    let picked = vec![member("/a", a1), member("/b", b1), member("/a", a2)];
    store.save_grid(&picked).unwrap();
    assert_eq!(pairs(&store), expected(&picked));

    drop(store);
    let mut store = ChatStore::open(dir.path().join("rynox.db"));
    assert_eq!(pairs(&store), expected(&picked));

    store.delete_conversation("/b", b1).unwrap();
    assert_eq!(
        pairs(&store),
        expected(&[member("/a", a1), member("/a", a2)])
    );
    assert!(store
        .grid()
        .unwrap()
        .iter()
        .all(|member| !member.title.is_empty()));

    let five = [
        member("/a", a1),
        member("/b", b2),
        member("/a", a2),
        member("/c", c1),
        member("/a", a3),
    ];
    assert_eq!(store.save_grid(&five), Err(ChatError::Invalid));
    // * Several groups are allowed, each with its own four; the order and the group are kept.
    let in_group = |group: i64, workspace: &str, conversation: i64| GridMember {
        group,
        ..member(workspace, conversation)
    };
    let groups = [
        in_group(1, "/a", a1),
        in_group(1, "/a", a2),
        in_group(2, "/b", b2),
        in_group(2, "/c", c1),
        in_group(2, "/a", a3),
    ];
    store.save_grid(&groups).unwrap();
    assert_eq!(
        store
            .grid()
            .unwrap()
            .into_iter()
            .map(|member| (member.group, member.conversation))
            .collect::<Vec<_>>(),
        vec![(1, a1), (1, a2), (2, b2), (2, c1), (2, a3)]
    );
    assert_eq!(
        store.save_grid(&[member("/a", a1), member("/a", a1)]),
        Err(ChatError::Invalid)
    );
    // * A conversation under another project's name is refused.
    assert_eq!(
        store.save_grid(&[member("/a", a1), member("/b", a2)]),
        Err(ChatError::Invalid)
    );

    // * One pick is kept: it waits for a second chat to make a grid.
    store.save_grid(&[member("/a", a1)]).unwrap();
    assert_eq!(pairs(&store), expected(&[member("/a", a1)]));

    store.save_grid(&[]).unwrap();
    assert!(store.grid().unwrap().is_empty());
}

#[test]
fn context_of_a_turn_is_saved_loaded_and_validated() {
    let (_dir, mut store) = store();
    let c = store.load("/a", None).unwrap().conversation;
    let mut with_context = turn("t1", "một");

    with_context.context = Some(r#"{"used":1200,"window":200000,"percent":0.6}"#.into());
    store.save_turn("/a", c, &with_context).unwrap();
    store.save_turn("/a", c, &turn("t2", "hai")).unwrap();

    let turns = store.load("/a", Some(c)).unwrap().turns;

    assert_eq!(turns[0].context, with_context.context);
    assert_eq!(turns[1].context, None);

    with_context.context = Some("{not json".into());
    assert_eq!(
        store.save_turn("/a", c, &with_context),
        Err(ChatError::Rejected("validation.bad_steps"))
    );
}
