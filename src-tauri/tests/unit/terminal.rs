use super::*;

#[test]
fn complete_text_holds_back_a_cut_character() {
    let bytes = "ab\u{1EA1}".as_bytes();
    let (text, rest) = complete_text(&bytes[..bytes.len() - 1]);

    assert_eq!(text, "ab");
    assert_eq!(rest.len(), 2);
    assert_eq!(complete_text(bytes), ("ab\u{1EA1}", &[][..]));
}

#[cfg(unix)]
#[test]
fn a_shell_runs_in_a_pseudo_terminal() {
    // * The whole exchange runs on a worker thread and the test only waits for its answer with a deadline: any step that never returns on some system (reading the end of a pseudo-terminal, waiting for the child, closing the master) must fail the test, not hang the whole run.
    let (done, answer) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");

        command.args(["-c", "echo hello"]);

        let mut child = pair.slave.spawn_command(command).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();

        drop(pair.slave);

        let mut output = String::new();
        let mut buffer = [0u8; 64];

        while !output.contains("hello") {
            match reader.read(&mut buffer) {
                Ok(read) if read > 0 => {
                    output.push_str(&String::from_utf8_lossy(&buffer[..read]));
                }
                _ => break,
            }
        }

        let _ = child.kill();
        let _ = done.send(output);
        // * The master is kept open until the answer is sent: closing it may block on some systems, and nothing waits for it.
        drop(pair.master);
    });

    let output = answer
        .recv_timeout(std::time::Duration::from_secs(20))
        .expect("the pseudo-terminal test did not finish in 20 seconds");

    assert!(output.contains("hello"), "output was {output:?}");
}

#[test]
fn only_plain_short_ids_are_accepted() {
    assert!(check_id("term-1_A").is_ok());
    assert!(check_id(&"a".repeat(64)).is_ok());
    assert!(check_id("").is_err());
    assert!(check_id(&"a".repeat(65)).is_err());
    assert!(check_id("a b").is_err());
    assert!(check_id("../x").is_err());
    assert!(check_id("tab\u{1EA1}").is_err());
}

#[test]
fn sizes_must_be_between_one_and_five_hundred() {
    assert!(check_size(80, 24).is_ok());
    assert!(check_size(500, 500).is_ok());
    assert!(check_size(0, 24).is_err());
    assert!(check_size(80, 0).is_err());
    assert!(check_size(501, 24).is_err());
    assert!(check_size(80, u16::MAX).is_err());
}

#[test]
fn bad_sizes_and_ids_are_refused_before_anything_starts() {
    let terminals = Terminals::default();

    assert!(matches!(
        terminals.resize("missing", 0, 24),
        Err(TerminalError::BadSize)
    ));
    assert!(matches!(
        terminals.resize("missing", 80, 24),
        Err(TerminalError::Unknown(_))
    ));
}

#[test]
fn a_write_over_the_limit_is_refused() {
    let terminals = Terminals::default();
    let big = "x".repeat(1024 * 1024);

    assert!(matches!(
        terminals.write("missing", &big),
        Err(TerminalError::TooLarge)
    ));
    assert!(matches!(
        terminals.write("missing", "ls"),
        Err(TerminalError::Unknown(_))
    ));
}

#[test]
fn take_text_keeps_only_a_cut_character_for_the_next_chunk() {
    let bytes = "ab\u{1EA1}".as_bytes();
    let mut pending = bytes[..bytes.len() - 1].to_vec();

    assert_eq!(take_text(&mut pending), "ab");
    assert_eq!(pending, &bytes[2..bytes.len() - 1]);

    pending.push(bytes[bytes.len() - 1]);

    assert_eq!(take_text(&mut pending), "\u{1EA1}");
    assert!(pending.is_empty());
}

#[test]
fn take_text_shows_bytes_that_are_not_text_with_replacement_characters() {
    let mut pending = vec![0xFF, 0xFE, 0xFD, 0xFC, 0xFB];

    assert_eq!(take_text(&mut pending), "\u{FFFD}".repeat(5));
    assert!(pending.is_empty());
}

#[test]
fn a_terminal_window_keeps_its_folder_until_it_is_closed() {
    let terminals = Terminals::default();

    terminals
        .register_window("terminal-1", "/work/app")
        .unwrap();

    assert_eq!(
        terminals.window_root("terminal-1").unwrap().as_deref(),
        Some("/work/app")
    );
    assert_eq!(terminals.window_root("terminal-2").unwrap(), None);

    terminals.close_owned("terminal-1");

    assert_eq!(terminals.window_root("terminal-1").unwrap(), None);
}

#[cfg(unix)]
#[test]
fn closing_a_window_ends_only_its_shells() {
    let terminals = Terminals::default();

    for (id, owner) in [("a", "terminal-1"), ("b", "terminal-1"), ("c", "main")] {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");

        command.args(["-c", "sleep 30"]);

        let child = pair.slave.spawn_command(command).unwrap();
        let writer = pair.master.take_writer().unwrap();

        terminals.sessions.lock().unwrap().insert(
            id.to_string(),
            Session {
                master: pair.master,
                writer: Arc::new(Mutex::new(writer)),
                child,
                owner: owner.to_string(),
                scrollback: Arc::new(Mutex::new(Scrollback::default())),
            },
        );
    }

    terminals.close_owned("terminal-1");

    let sessions = terminals.sessions.lock().unwrap();

    assert_eq!(sessions.keys().collect::<Vec<_>>(), vec!["c"]);
    drop(sessions);
    terminals.close("c").unwrap();
}

#[test]
fn scrollback_keeps_the_tail_within_the_limit() {
    let mut text = "abcdef".to_string();

    trim_front(&mut text, 4);
    assert_eq!(text, "cdef");

    trim_front(&mut text, 10);
    assert_eq!(text, "cdef");
}

#[test]
fn scrollback_is_never_cut_inside_a_character() {
    // * Each of these characters takes 3 bytes: a limit of 7 would start in the middle of one, so the whole character goes.
    let mut text = "\u{1EA1}\u{1EA1}\u{1EA1}".to_string();

    trim_front(&mut text, 7);
    assert_eq!(text, "\u{1EA1}\u{1EA1}");
}

#[test]
fn scrollback_counts_every_byte_printed() {
    let mut scrollback = Scrollback::default();
    let chunk = "x".repeat(MAX_SCROLLBACK_BYTES);

    assert_eq!(scrollback.push(&chunk), MAX_SCROLLBACK_BYTES as u64);
    assert_eq!(scrollback.push("tail"), MAX_SCROLLBACK_BYTES as u64 + 4);

    let snapshot = scrollback.snapshot();

    assert_eq!(snapshot.data.len(), MAX_SCROLLBACK_BYTES);
    assert!(snapshot.data.ends_with("xtail"));
    assert_eq!(snapshot.end, MAX_SCROLLBACK_BYTES as u64 + 4);
}
