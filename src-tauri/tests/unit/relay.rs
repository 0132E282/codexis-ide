use super::*;
use std::collections::HashMap;

fn block(name: &str, message: &str) -> String {
    format!("Ok.\n```relay:{name}\n{message}\n```\n")
}

#[test]
fn an_address_block_names_the_ai_and_holds_the_message() {
    let address = parse_address("Trước\n  ```relay:Codex\ndòng 1\n\ndòng 2\n```\nSau").unwrap();

    assert_eq!(address.name, "codex");
    assert_eq!(address.message, "dòng 1\n\ndòng 2");
}

#[test]
fn an_answer_without_a_closed_block_addresses_nobody() {
    assert_eq!(parse_address("chỉ là lời"), None);
    assert_eq!(parse_address("```rust\nfn x() {}\n```"), None);
    assert_eq!(parse_address("```relay:codex\nkhông đóng"), None);
    assert_eq!(parse_address("nhắc tới ```relay:codex trong câu"), None);
}

#[test]
fn only_the_first_block_counts() {
    let answer = format!("{}{}", block("codex", "một"), block("claude", "hai"));

    assert_eq!(parse_address(&answer).unwrap().name, "codex");
}

#[test]
fn an_address_starts_a_hop_and_the_answer_returns_to_the_asker() {
    let mut relay = Relay::new(CliKind::Claude, "làm X");
    let hop = relay
        .next(CliKind::Claude, &block("codex", "xem giúp"))
        .unwrap()
        .unwrap();

    assert_eq!(
        hop,
        Hop {
            from: CliKind::Claude,
            target: CliKind::Codex,
            message: "xem giúp".to_string(),
            first_visit: true,
        }
    );

    let prompt = relay.prompt(&hop);

    assert!(prompt.contains("xem giúp"));
    assert!(prompt.contains("Yêu cầu gốc của người dùng: làm X"));
    assert!(prompt.contains("claude"));

    // * Codex addresses nobody: its answer goes back to Claude, then Claude's plain answer ends the relay.
    let back = relay.next(CliKind::Codex, "xong rồi").unwrap().unwrap();

    assert_eq!(
        (back.target, back.message.as_str()),
        (CliKind::Claude, "xong rồi")
    );
    assert!(!back.first_visit);
    assert!(!relay.prompt(&back).contains("Yêu cầu gốc"));
    assert_eq!(relay.next(CliKind::Claude, "kết luận"), Ok(None));
}

#[test]
fn an_ai_cannot_address_itself() {
    let mut relay = Relay::new(CliKind::Claude, "x");

    assert_eq!(
        relay.next(CliKind::Claude, &block("claude", "tự nói")),
        Err(RelayStop::SelfAddress)
    );
}

#[test]
fn unknown_ais_and_bad_messages_are_refused() {
    let mut relay = Relay::new(CliKind::Claude, "x");

    for name in ["gemini", "github", "rm"] {
        assert_eq!(
            relay.next(CliKind::Claude, &block(name, "hi")),
            Err(RelayStop::UnknownTarget),
            "{name}"
        );
    }

    assert_eq!(
        relay.next(CliKind::Claude, "```relay:codex\n\n```"),
        Err(RelayStop::BadMessage)
    );
    assert_eq!(
        relay.next(
            CliKind::Claude,
            &block(
                "codex",
                &"a".repeat(validation::MAX_RELAY_MESSAGE_BYTES + 1)
            )
        ),
        Err(RelayStop::BadMessage)
    );
    assert_eq!(
        relay.next(CliKind::Claude, "```relay:codex\na\u{1b}b\n```"),
        Err(RelayStop::BadMessage)
    );
}

#[test]
fn the_same_message_to_the_same_ai_is_not_sent_twice() {
    let mut relay = Relay::new(CliKind::Claude, "x");

    assert!(relay
        .next(CliKind::Claude, &block("codex", "giống"))
        .unwrap()
        .is_some());
    assert_eq!(
        relay.next(CliKind::Claude, &block("codex", "giống")),
        Err(RelayStop::Repeated)
    );
}

#[test]
fn a_long_answer_going_back_is_cut_not_refused() {
    let mut relay = Relay::new(CliKind::Claude, "x");

    relay.next(CliKind::Claude, &block("codex", "hỏi")).unwrap();

    let back = relay
        .next(
            CliKind::Codex,
            &"é".repeat(validation::MAX_RELAY_MESSAGE_BYTES),
        )
        .unwrap()
        .unwrap();

    assert!(back.message.len() <= validation::MAX_RELAY_MESSAGE_BYTES);
    assert!(validation::relay_message(&back.message).is_ok());
}

/// Plays the CLIs from scripts: each AI says its next scripted answer.
struct Script {
    answers: HashMap<CliKind, Vec<String>>,
    ran: Vec<(CliKind, String)>,
    notices: Vec<RelayStop>,
    stop_after: Option<usize>,
    failing: bool,
}

impl Script {
    fn new(answers: &[(CliKind, Vec<String>)]) -> Self {
        Self {
            answers: answers.iter().cloned().collect(),
            ran: Vec::new(),
            notices: Vec::new(),
            stop_after: None,
            failing: false,
        }
    }
}

impl HopRunner for Script {
    fn stopped(&self) -> bool {
        self.stop_after.is_some_and(|hops| self.ran.len() >= hops)
    }

    fn run_hop(&mut self, target: CliKind, prompt: &str) -> Option<String> {
        self.ran.push((target, prompt.to_string()));

        if self.failing {
            return None;
        }

        let queue = self.answers.get_mut(&target)?;

        (!queue.is_empty()).then(|| queue.remove(0))
    }

    fn notice(&mut self, stop: RelayStop) {
        self.notices.push(stop);
    }
}

#[test]
fn a_relay_ends_when_nobody_addresses_anybody() {
    let mut script = Script::new(&[
        (CliKind::Codex, vec!["đã xem".to_string()]),
        (CliKind::Claude, vec!["tổng kết".to_string()]),
    ]);

    drive(
        &mut script,
        CliKind::Claude,
        "làm X",
        block("codex", "xem giúp"),
    );

    let who: Vec<CliKind> = script.ran.iter().map(|(cli, _)| *cli).collect();

    assert_eq!(who, [CliKind::Codex, CliKind::Claude]);
    assert!(script.notices.is_empty());
    assert!(script.ran[1].1.contains("đã xem"));
}

#[test]
fn a_ping_pong_stops_at_the_hop_limit() {
    // * Each AI keeps addressing the other with a new message, so only the limit can end it.
    let many = |name: &str| (0..20).map(|n| block(name, &format!("tin {n}"))).collect();
    let mut script = Script::new(&[
        (CliKind::Codex, many("claude")),
        (CliKind::Claude, many("codex")),
    ]);

    drive(&mut script, CliKind::Claude, "x", block("codex", "bắt đầu"));

    assert_eq!(script.ran.len(), MAX_HOPS);
    assert_eq!(script.notices, [RelayStop::HopLimit]);
}

#[test]
fn a_loop_of_identical_messages_is_cut_at_once() {
    let same = || vec![block("claude", "lặp"); 5];
    let mut script = Script::new(&[
        (CliKind::Codex, same()),
        (CliKind::Claude, vec![block("codex", "lặp"); 5]),
    ]);

    drive(&mut script, CliKind::Claude, "x", block("codex", "lặp"));

    assert_eq!(script.notices, [RelayStop::Repeated]);
    assert!(script.ran.len() < MAX_HOPS);
}

#[test]
fn a_self_address_ends_the_relay_with_a_notice() {
    let mut script = Script::new(&[(CliKind::Codex, vec![block("codex", "tôi")])]);

    drive(&mut script, CliKind::Claude, "x", block("codex", "hỏi"));

    assert_eq!(script.ran.len(), 1);
    assert_eq!(script.notices, [RelayStop::SelfAddress]);
}

#[test]
fn stopping_ends_the_relay_before_the_next_hop_without_a_notice() {
    let mut script = Script::new(&[(CliKind::Codex, vec!["a".to_string()])]);

    script.stop_after = Some(0);
    drive(&mut script, CliKind::Claude, "x", block("codex", "hỏi"));

    assert!(script.ran.is_empty());
    assert!(script.notices.is_empty());

    let mut script = Script::new(&[
        (CliKind::Codex, vec![block("claude", "tiếp"); 3]),
        (CliKind::Claude, vec![block("codex", "nữa"); 3]),
    ]);

    script.stop_after = Some(2);
    drive(&mut script, CliKind::Claude, "x", block("codex", "hỏi"));

    assert_eq!(script.ran.len(), 2);
    assert!(script.notices.is_empty());
}

#[test]
fn a_failed_hop_ends_the_relay() {
    let mut script = Script::new(&[]);

    script.failing = true;
    drive(&mut script, CliKind::Claude, "x", block("codex", "hỏi"));

    assert_eq!(script.ran.len(), 1);
    assert!(script.notices.is_empty());
}

#[test]
fn a_chain_returns_through_every_asker() {
    // * Claude asks Codex, Codex asks a third AI is not possible with two CLIs; with the second hop addressing back, Claude answers last.
    let mut script = Script::new(&[
        (CliKind::Codex, vec![block("claude", "cần thêm")]),
        (CliKind::Claude, vec!["đủ rồi".to_string()]),
    ]);

    drive(&mut script, CliKind::Claude, "x", block("codex", "hỏi"));

    let who: Vec<CliKind> = script.ran.iter().map(|(cli, _)| *cli).collect();

    assert_eq!(who, [CliKind::Codex, CliKind::Claude]);
    assert!(script.notices.is_empty());
}

#[test]
fn relay_stops_have_translatable_keys() {
    for stop in [
        RelayStop::HopLimit,
        RelayStop::SelfAddress,
        RelayStop::Repeated,
        RelayStop::UnknownTarget,
        RelayStop::BadMessage,
    ] {
        assert!(stop.key().starts_with("relay."));
    }
}
