use super::*;
use std::fs;
use tempfile::TempDir;

/// A reader that hands out at most `step` bytes per read, like a pipe that cuts messages anywhere.
struct Chunked {
    bytes: Vec<u8>,
    at: usize,
    step: usize,
}

impl Read for Chunked {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.step.min(buffer.len()).min(self.bytes.len() - self.at);

        buffer[..count].copy_from_slice(&self.bytes[self.at..self.at + count]);
        self.at += count;

        Ok(count)
    }
}

fn framed(message: &Value) -> Vec<u8> {
    let mut bytes = Vec::new();

    write_message(&mut bytes, message).unwrap();

    bytes
}

fn reader(bytes: Vec<u8>, step: usize) -> MessageReader<Chunked> {
    MessageReader::new(Chunked { bytes, at: 0, step })
}

fn position(line: u32, character: u32) -> Position {
    Position { line, character }
}

fn range(start: (u32, u32), end: (u32, u32)) -> Range {
    Range {
        start: position(start.0, start.1),
        end: position(end.0, end.1),
    }
}

fn sandbox() -> (TempDir, Sandbox) {
    let dir = TempDir::new().unwrap();
    let sandbox = Sandbox::open(dir.path()).unwrap();

    (dir, sandbox)
}

#[test]
fn reads_a_message_cut_one_byte_at_a_time() {
    let message =
        json!({ "jsonrpc": "2.0", "id": 1, "method": "ping", "params": { "text": "xin chào 😀" } });
    let mut reader = reader(framed(&message), 1);

    assert_eq!(reader.next_message().unwrap(), Some(message));
    assert_eq!(reader.next_message().unwrap(), None);
}

#[test]
fn reads_two_messages_delivered_in_one_chunk() {
    let first = json!({ "jsonrpc": "2.0", "method": "a" });
    let second = json!({ "jsonrpc": "2.0", "method": "b" });
    let mut bytes = framed(&first);

    bytes.extend(framed(&second));

    let mut reader = reader(bytes, usize::MAX);

    assert_eq!(reader.next_message().unwrap(), Some(first));
    assert_eq!(reader.next_message().unwrap(), Some(second));
    assert_eq!(reader.next_message().unwrap(), None);
}

#[test]
fn accepts_a_content_type_header_and_any_header_case() {
    let body = br#"{"jsonrpc":"2.0","method":"a"}"#;
    let mut bytes = format!(
        "content-type: application/vscode-jsonrpc; charset=utf-8\r\nCONTENT-LENGTH: {}\r\n\r\n",
        body.len()
    )
    .into_bytes();

    bytes.extend_from_slice(body);

    assert!(reader(bytes, 3).next_message().unwrap().is_some());
}

#[test]
fn rejects_a_missing_or_malformed_length() {
    for header in [
        "Content-Type: x\r\n\r\n{}",
        "Content-Length: abc\r\n\r\n{}",
        "Content-Length: -2\r\n\r\n{}",
        "Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
        "no colon here\r\n\r\n{}",
    ] {
        assert_eq!(
            reader(header.as_bytes().to_vec(), 4).next_message(),
            Err(ProtocolError::BadHeader),
            "{header}"
        );
    }
}

#[test]
fn rejects_a_header_that_never_ends() {
    let bytes = vec![b'a'; MAX_HEADER_BYTES * 2];

    assert_eq!(
        reader(bytes, 1024).next_message(),
        Err(ProtocolError::BadHeader)
    );
}

#[test]
fn refuses_a_length_over_the_limit_before_reading_the_body() {
    // * Only the header is there: the error must come from the number, not from waiting for 17 MiB.
    let header = format!("Content-Length: {}\r\n\r\n", 17 * 1024 * 1024);

    assert_eq!(
        reader(header.into_bytes(), 64).next_message(),
        Err(ProtocolError::TooLarge)
    );

    let huge = "Content-Length: 99999999999999999999999999\r\n\r\n";

    assert_eq!(
        reader(huge.as_bytes().to_vec(), 64).next_message(),
        Err(ProtocolError::TooLarge)
    );
}

#[test]
fn a_length_at_the_limit_is_allowed() {
    let header = format!("Content-Length: {MAX_MESSAGE_BYTES}\r\n\r\n");

    // * The length is allowed; the stream just ends before the body does.
    assert_eq!(
        reader(header.into_bytes(), 4096).next_message(),
        Err(ProtocolError::Closed)
    );
}

#[test]
fn rejects_a_body_that_is_not_utf8_or_not_an_object() {
    for body in [
        &[0xff_u8, 0xfe, 0x7b, 0x7d][..],
        &b"[1,2]"[..],
        &b"not json"[..],
    ] {
        let mut bytes = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();

        bytes.extend_from_slice(body);

        assert_eq!(reader(bytes, 5).next_message(), Err(ProtocolError::BadBody));
    }
}

#[test]
fn a_stream_cut_inside_a_message_is_closed_not_clean() {
    let mut bytes = framed(&json!({ "jsonrpc": "2.0", "method": "a" }));

    bytes.truncate(bytes.len() - 3);

    assert_eq!(reader(bytes, 7).next_message(), Err(ProtocolError::Closed));
}

#[test]
fn refuses_to_write_a_message_over_the_limit() {
    let message = json!({ "text": "x".repeat(MAX_MESSAGE_BYTES) });

    assert!(write_message(&mut Vec::new(), &message).is_err());
}

#[test]
fn classifies_requests_notifications_and_responses() {
    assert_eq!(
        classify(
            json!({ "id": "a", "method": "workspace/configuration", "params": { "items": [] } })
        ),
        Some(Incoming::Request {
            id: json!("a"),
            method: "workspace/configuration".into(),
            params: json!({ "items": [] }),
        })
    );
    assert_eq!(
        classify(json!({ "method": "window/logMessage" })),
        Some(Incoming::Notification {
            method: "window/logMessage".into(),
            params: Value::Null,
        })
    );
    assert_eq!(
        classify(json!({ "id": 4, "result": { "ok": true } })),
        Some(Incoming::Response {
            id: 4,
            result: Ok(json!({ "ok": true })),
        })
    );
    assert_eq!(
        classify(json!({ "id": 5, "error": { "code": -32800, "message": "cancelled" } })),
        Some(Incoming::Response {
            id: 5,
            result: Err(RpcError {
                code: -32800,
                message: "cancelled".into(),
            }),
        })
    );
    assert_eq!(classify(json!({ "id": "x", "result": 1 })), None);
    assert_eq!(classify(json!({ "jsonrpc": "2.0" })), None);
}

#[test]
fn uris_round_trip_names_with_spaces_accents_and_hashes() {
    let (dir, sandbox) = sandbox();

    for name in [
        "my file.rs",
        "tiếng Việt.rs",
        "a#b.rs",
        "100%.rs",
        "a+b&c.rs",
    ] {
        fs::write(dir.path().join(name), "x").unwrap();

        let uri = path_to_uri(&sandbox, name).unwrap();

        assert!(uri.starts_with("file:///"));
        assert!(
            !uri.contains(' ') && !uri.contains('#') && uri.is_ascii(),
            "{uri}"
        );
        assert_eq!(uri_to_relative(&sandbox, &uri).as_deref(), Some(name));
    }
}

#[test]
fn nested_files_keep_their_folders() {
    let (dir, sandbox) = sandbox();

    fs::create_dir_all(dir.path().join("src/bin")).unwrap();
    fs::write(dir.path().join("src/bin/main.rs"), "x").unwrap();

    let uri = path_to_uri(&sandbox, "src/bin/main.rs").unwrap();

    assert!(uri.ends_with("/src/bin/main.rs"));
    assert_eq!(
        uri_to_relative(&sandbox, &uri).as_deref(),
        Some("src/bin/main.rs")
    );
}

#[test]
fn uris_outside_the_root_or_not_plain_files_have_no_relative_path() {
    let (dir, sandbox) = sandbox();
    let outside = TempDir::new().unwrap();

    fs::write(outside.path().join("o.rs"), "x").unwrap();

    let root = dir.path().canonicalize().unwrap();

    for uri in [
        file_uri(&outside.path().canonicalize().unwrap().join("o.rs")),
        "file:///etc/passwd".to_string(),
        format!("file://{}/../x.rs", root.display()),
        format!("file://{}/%2e%2e/x.rs", root.display()),
        format!("file://{}/a%00b.rs", root.display()),
        format!("file://{}/a%zz.rs", root.display()),
        format!("file://{}/a.rs#frag", root.display()),
        format!("file://{}/a.rs?q=1", root.display()),
        "http://example.com/a.rs".to_string(),
        "file://evil.example/etc/passwd".to_string(),
        "file://relative/a.rs".to_string(),
        "untitled:Untitled-1".to_string(),
    ] {
        assert_eq!(uri_to_relative(&sandbox, &uri), None, "{uri}");
    }
}

#[test]
fn a_file_that_is_not_there_yet_is_still_judged_by_its_path() {
    let (dir, sandbox) = sandbox();
    let uri = file_uri(&dir.path().canonicalize().unwrap().join("new/file.rs"));

    assert_eq!(
        uri_to_relative(&sandbox, &uri).as_deref(),
        Some("new/file.rs")
    );
}

#[cfg(unix)]
#[test]
fn a_link_leaving_the_root_gets_no_uri_and_no_relative_path() {
    let (dir, sandbox) = sandbox();
    let outside = TempDir::new().unwrap();

    fs::write(outside.path().join("secret.rs"), "x").unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.rs"), dir.path().join("link.rs"))
        .unwrap();

    assert_eq!(path_to_uri(&sandbox, "link.rs"), None);
    assert_eq!(
        uri_to_relative(
            &sandbox,
            &file_uri(&dir.path().canonicalize().unwrap().join("link.rs"))
        ),
        None
    );
}

#[test]
fn paths_that_fail_the_workspace_rules_get_no_uri() {
    let (dir, sandbox) = sandbox();

    fs::write(dir.path().join("a.rs"), "x").unwrap();

    for path in ["../a.rs", "/a.rs", "", "./a.rs", "a/../a.rs", "missing.rs"] {
        assert_eq!(path_to_uri(&sandbox, path), None, "{path:?}");
    }
}

#[test]
fn positions_count_utf16_units() {
    let text = "a😀b\nxyz";

    assert_eq!(offset_of(text, position(0, 0)), 0);
    assert_eq!(offset_of(text, position(0, 1)), 1);
    // * Inside the surrogate pair: rounds down to the start of the emoji.
    assert_eq!(offset_of(text, position(0, 2)), 1);
    assert_eq!(offset_of(text, position(0, 3)), 5);
    assert_eq!(offset_of(text, position(0, 4)), 6);
    assert_eq!(offset_of(text, position(1, 2)), 9);
    // * Past the end of the line: the end of that line; past the last line: the end of the text.
    assert_eq!(offset_of(text, position(0, 99)), 6);
    assert_eq!(offset_of(text, position(9, 0)), text.len());
}

#[test]
fn replaces_a_range_and_the_whole_text() {
    let mut text = "héllo wörld\nline two".to_string();

    assert!(apply_change(
        &mut text,
        Some(&range((0, 6), (0, 11))),
        "there"
    ));
    assert_eq!(text, "héllo there\nline two");

    assert!(apply_change(&mut text, Some(&range((0, 11), (1, 4))), " "));
    assert_eq!(text, "héllo there  two");

    assert!(apply_change(&mut text, None, "fresh"));
    assert_eq!(text, "fresh");
}

#[test]
fn a_backwards_range_changes_nothing() {
    let mut text = "abc".to_string();

    assert!(!apply_change(&mut text, Some(&range((0, 2), (0, 1))), "x"));
    assert_eq!(text, "abc");
}

#[test]
fn crlf_lines_are_kept_and_columns_stop_before_the_line_break() {
    let mut text = "one\r\ntwo\r\nthree".to_string();

    // * A character past the end of line 0 is clamped before the "\r\n", not inside it.
    assert_eq!(offset_of(&text, position(0, 50)), 3);
    assert_eq!(offset_of(&text, position(1, 0)), 5);

    assert!(apply_change(
        &mut text,
        Some(&range((1, 3), (1, 3))),
        "!\r\nnew"
    ));
    assert_eq!(text, "one\r\ntwo!\r\nnew\r\nthree");

    assert!(apply_change(&mut text, Some(&range((0, 3), (1, 0))), ""));
    assert_eq!(text, "onetwo!\r\nnew\r\nthree");
}

#[test]
fn a_run_of_edits_with_emoji_and_crlf_matches_what_an_editor_holds() {
    let mut mirror = "fn main() {\r\n    let s = \"😀\";\r\n}\r\n".to_string();
    let mut editor = mirror.clone();
    let changes = [
        (range((1, 13), (1, 15)), "ả😀"),
        (range((0, 0), (0, 0)), "// tiêu đề\r\n"),
        (range((2, 4), (2, 4)), "\r\n    println!();"),
        (range((4, 0), (4, 1)), ""),
    ];

    for (change, new_text) in &changes {
        assert!(apply_change(&mut mirror, Some(change), new_text));

        // * The editor applies the same edit by its own offsets.
        let start = offset_of(&editor, change.start);
        let end = offset_of(&editor, change.end);

        editor.replace_range(start..end, new_text);
    }

    assert_eq!(mirror, editor);
    assert!(mirror.contains("ả😀"));
    assert_eq!(mirror.matches("\r\n").count(), 5);
}

#[test]
fn edits_to_one_file_apply_against_the_original_text() {
    let text = "let a = 1;\nlet b = a + a;\n";
    let edits = vec![
        (range((1, 8), (1, 9)), "first".to_string()),
        (range((0, 4), (0, 5)), "first".to_string()),
        (range((1, 12), (1, 13)), "first".to_string()),
    ];

    assert_eq!(
        apply_edits(text, &edits).unwrap(),
        "let first = 1;\nlet b = first + first;\n"
    );
}

#[test]
fn overlapping_or_backwards_edits_are_refused() {
    let text = "abcdef";

    assert_eq!(
        apply_edits(
            text,
            &[
                (range((0, 0), (0, 3)), "x".into()),
                (range((0, 2), (0, 4)), "y".into())
            ]
        ),
        None
    );
    assert_eq!(
        apply_edits(text, &[(range((0, 3), (0, 1)), "x".into())]),
        None
    );
    assert_eq!(apply_edits(text, &[]), Some(text.to_string()));
}
