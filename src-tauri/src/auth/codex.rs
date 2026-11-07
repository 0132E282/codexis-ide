//! Codex: sign-in state from the exit code of `codex login status`; the account email is read from the login's `id_token`.

use super::{combined_text, detail, AuthTool, SignIn};
use crate::cli::CliKind;
use std::path::PathBuf;
use std::process::Output;

pub struct CodexAuth;

impl AuthTool for CodexAuth {
    fn kind(&self) -> CliKind {
        CliKind::Codex
    }

    fn status_args(&self) -> &'static [&'static str] {
        &["login", "status"]
    }

    fn login_args(&self) -> &'static [&'static str] {
        &["login"]
    }

    fn logout_args(&self) -> &'static [&'static str] {
        &["logout"]
    }

    fn read_sign_in(&self, output: &Output, environment: &[(&'static str, String)]) -> SignIn {
        let logged_in = output.status.success();

        SignIn {
            logged_in,
            account: codex_account(environment).filter(|_| logged_in),
            details: combined_text(output)
                .lines()
                .find_map(|line| detail("auth.detail.status", line))
                .into_iter()
                .collect(),
        }
    }
}

/// Email in the `id_token` of the Codex login: `<CODEX_HOME>/auth.json`, or `~/.codex/auth.json` for the default account. Only the email claim is read; tokens are never returned.
fn codex_account(environment: &[(&'static str, String)]) -> Option<String> {
    let home = environment
        .iter()
        .find(|(name, _)| *name == CliKind::Codex.config_variable())
        .map(|(_, value)| PathBuf::from(value))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))?;
    let text = std::fs::read_to_string(home.join("auth.json")).ok()?;

    id_token_email(&text)
}

fn id_token_email(auth_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(auth_json).ok()?;
    let token = value["tokens"]["id_token"].as_str()?;
    let payload = decode_base64_url(token.split('.').nth(1)?)?;
    let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;

    claims["email"].as_str().map(str::to_string)
}

/// Unpadded URL-safe base64, as in a JWT segment.
fn decode_base64_url(text: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(text.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;

    for character in text.bytes() {
        let sextet = match character {
            b'A'..=b'Z' => character - b'A',
            b'a'..=b'z' => character - b'a' + 26,
            b'0'..=b'9' => character - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            b'=' => break,
            _ => return None,
        };

        buffer = (buffer << 6) | u32::from(sextet);
        bits += 6;

        if bits >= 8 {
            bits -= 8;
            bytes.push(u8::try_from((buffer >> bits) & 0xff).ok()?);
        }
    }

    Some(bytes)
}

#[cfg(test)]
#[path = "../../tests/unit/auth_codex.rs"]
mod tests;
