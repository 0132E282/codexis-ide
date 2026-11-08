//! Relay between the AI CLIs of one chat turn: an AI addresses another one with a ```` ```relay:<name> ```` block, the other runs with that message and its answer goes back, until nobody addresses anybody, a limit is hit or the person stops the turn.
//! This module is the pure part (parsing, limits, loop protection, the order of the hops); running a CLI is behind [`HopRunner`].

use crate::cli::CliKind;
use crate::validation;
use std::collections::HashSet;

/// The most hops one turn may relay (an answer sent back to the caller is a hop too).
pub const MAX_HOPS: usize = 6;
/// The most characters of the person's request that are repeated to an AI the first time it is addressed.
const MAX_CONTEXT_CHARS: usize = 2000;
/// How the opening line of an address block starts.
const ADDRESS_OPENING: &str = "```relay:";
const FENCE: &str = "```";

const HOP_TEMPLATE: &str = include_str!("../../prompts/chat/relay-hop.md");

/// Why a relay ended without being asked to; the key is shown translated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayStop {
    HopLimit,
    SelfAddress,
    Repeated,
    UnknownTarget,
    BadMessage,
}

impl RelayStop {
    pub fn key(self) -> &'static str {
        match self {
            Self::HopLimit => "relay.hop_limit",
            Self::SelfAddress => "relay.self_address",
            Self::Repeated => "relay.repeated",
            Self::UnknownTarget => "relay.unknown_target",
            Self::BadMessage => "relay.bad_message",
        }
    }
}

/// What an answer addresses to another AI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Address {
    /// The name after `relay:`, lowercase.
    pub name: String,
    pub message: String,
}

/// The first ```` ```relay:<name> ```` block of `answer` that is closed; none when the answer addresses nobody.
pub fn parse_address(answer: &str) -> Option<Address> {
    let mut lines = answer.lines();

    while let Some(line) = lines.next() {
        let Some(name) = line.trim_start().strip_prefix(ADDRESS_OPENING) else {
            continue;
        };
        let mut message = Vec::new();

        for body in lines.by_ref() {
            if body.trim() == FENCE {
                return Some(Address {
                    name: name.trim().to_lowercase(),
                    message: message.join("\n").trim().to_string(),
                });
            }

            message.push(body);
        }

        // * A block that is never closed is not an address.
        return None;
    }

    None
}

/// One AI's turn to speak, decided by the relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hop {
    pub from: CliKind,
    pub target: CliKind,
    pub message: String,
    /// The target has not spoken in this relay yet: it also gets the person's request.
    pub first_visit: bool,
}

/// The order of the hops of one turn and the rules that end it.
pub struct Relay {
    request: String,
    hops: usize,
    /// What each AI was already sent, so the same message never goes twice.
    sent: HashSet<(CliKind, String)>,
    /// Who spoke already in this relay.
    visited: HashSet<CliKind>,
    /// The AIs waiting for an answer, the latest asker last.
    callers: Vec<CliKind>,
}

impl Relay {
    /// A relay for the turn of `starter`, answering `request` (the person's message).
    pub fn new(starter: CliKind, request: &str) -> Self {
        Self {
            request: request.chars().take(MAX_CONTEXT_CHARS).collect(),
            hops: 0,
            sent: HashSet::new(),
            visited: HashSet::from([starter]),
            callers: Vec::new(),
        }
    }

    /// What `speaker`'s `answer` leads to: another AI's turn, the end (`None`), or a stop by one of the limits.
    /// An answer that addresses nobody goes back to the AI that asked; the first AI's answer ends the relay.
    ///
    /// # Errors
    /// The [`RelayStop`] that ends the relay: an unknown or invalid address, an AI addressing itself, a message sent before, or too many hops.
    pub fn next(&mut self, speaker: CliKind, answer: &str) -> Result<Option<Hop>, RelayStop> {
        let (target, message) = match parse_address(answer) {
            Some(address) => {
                let target = CliKind::parse_agent(&address.name).ok_or(RelayStop::UnknownTarget)?;

                if target == speaker {
                    return Err(RelayStop::SelfAddress);
                }

                validation::relay_message(&address.message).map_err(|_| RelayStop::BadMessage)?;

                (target, address.message)
            }
            None => {
                let Some(caller) = self.callers.last().copied() else {
                    return Ok(None);
                };

                if answer.trim().is_empty() {
                    return Ok(None);
                }

                (caller, clip(answer.trim()))
            }
        };

        if self.hops >= MAX_HOPS {
            return Err(RelayStop::HopLimit);
        }

        if !self.sent.insert((target, message.clone())) {
            return Err(RelayStop::Repeated);
        }

        // * Answering the AI that asked closes its question; asking a new AI leaves the speaker waiting.
        if self.callers.last() == Some(&target) {
            self.callers.pop();
        } else {
            self.callers.push(speaker);
        }

        self.hops += 1;

        Ok(Some(Hop {
            from: speaker,
            target,
            message,
            first_visit: self.visited.insert(target),
        }))
    }

    /// The prompt `hop`'s target receives.
    pub fn prompt(&self, hop: &Hop) -> String {
        let context = if hop.first_visit && !self.request.trim().is_empty() {
            format!("\n\nThe user's original request: {}", self.request.trim())
        } else {
            String::new()
        };

        HOP_TEMPLATE
            .trim_end()
            .replace("{context}", &context)
            .replace("{from}", hop.from.name())
            .replace("{message}", &hop.message)
    }
}

/// `text` cut to the longest message a relay accepts, at a character boundary.
fn clip(text: &str) -> String {
    let mut end = text.len().min(validation::MAX_RELAY_MESSAGE_BYTES);

    while !text.is_char_boundary(end) {
        end -= 1;
    }

    text[..end].to_string()
}

/// Runs the hops: the only part of a relay that touches CLIs and the chat.
pub trait HopRunner {
    /// The person asked to stop; checked before every hop.
    fn stopped(&self) -> bool;

    /// Shows who speaks, runs the target's turn with `prompt` and returns what it answered; `None` when the turn failed (the failure was already shown).
    fn run_hop(&mut self, target: CliKind, prompt: &str) -> Option<String>;

    /// Tells the person the relay ended by a limit.
    fn notice(&mut self, stop: RelayStop);
}

/// Continues a turn: `starter` answered `first_answer` to `request`; hops follow until nobody addresses anybody, a limit stops the relay, a hop fails or the person stops it.
pub fn drive(runner: &mut impl HopRunner, starter: CliKind, request: &str, first_answer: String) {
    let mut relay = Relay::new(starter, request);
    let mut speaker = starter;
    let mut answer = first_answer;

    while !runner.stopped() {
        let hop = match relay.next(speaker, &answer) {
            Ok(Some(hop)) => hop,
            Ok(None) => return,
            Err(stop) => {
                runner.notice(stop);

                return;
            }
        };

        // * The stop may have come while the next hop was being decided.
        if runner.stopped() {
            return;
        }

        let Some(next_answer) = runner.run_hop(hop.target, &relay.prompt(&hop)) else {
            return;
        };

        speaker = hop.target;
        answer = next_answer;
    }
}

#[cfg(test)]
#[path = "../tests/unit/relay.rs"]
mod tests;
