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
    let (sender, receiver) = std::sync::mpsc::channel();

    drop(pair.slave);

    // * The reader runs on its own thread and the test waits with a deadline: a read that never returns (the end of a pseudo-terminal differs between systems) must fail the test, not hang the whole run.
    std::thread::spawn(move || {
        let mut buffer = [0u8; 64];

        while let Ok(read) = reader.read(&mut buffer) {
            if read == 0 || sender.send(buffer[..read].to_vec()).is_err() {
                break;
            }
        }
    });

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let mut output = String::new();

    while !output.contains("hello") {
        let left = deadline.saturating_duration_since(std::time::Instant::now());

        match receiver.recv_timeout(left) {
            Ok(bytes) => output.push_str(&String::from_utf8_lossy(&bytes)),
            Err(_) => break,
        }
    }

    child.wait().unwrap();
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
