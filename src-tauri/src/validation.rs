//! Shared input validation for the Tauri commands, built on `garde`.
//!
//! Every failure is a [`ValidationError`] holding a fixed key (`validation.name_empty`...) that the front end
//! translates; the key never carries the rejected value, so nothing secret can leak through an error.
//! Only dangerous or meaningless input is refused: anything a person could reasonably type stays valid.

use garde::Validate;
use std::fmt;

/// Longest display name, in characters.
pub const MAX_DISPLAY_NAME_CHARS: usize = 100;
/// Longest file, folder or project name, in bytes (the limit of common file systems).
pub const MAX_ENTRY_NAME_BYTES: usize = 255;
/// Longest branch name, in bytes.
pub const MAX_BRANCH_NAME_BYTES: usize = 255;
/// Longest commit message, in characters.
pub const MAX_COMMIT_MESSAGE_CHARS: usize = 10_000;
/// Longest path handed over by the front end, in bytes.
pub const MAX_PATH_BYTES: usize = 4096;
/// Longest run id, in bytes.
pub const MAX_RUN_ID_BYTES: usize = 64;
/// Longest question put to the AI, in characters.
pub const MAX_QUESTION_CHARS: usize = 20_000;
/// Longest message one AI relays to another, in bytes.
pub const MAX_RELAY_MESSAGE_BYTES: usize = 20_000;
/// Longest picked code snippet sent to the AI, in bytes.
pub const MAX_SNIPPET_BYTES: usize = 1_000_000;

/// Longest CLI session id, in bytes.
pub const MAX_SESSION_BYTES: usize = 128;
/// Longest model name, in characters.
pub const MAX_MODEL_CHARS: usize = 100;
/// Longest prompt of a chat turn, in bytes (the limit the saved history accepts too).
pub const MAX_PROMPT_BYTES: usize = 200_000;
/// Longest permission request id, in bytes.
pub const MAX_REQUEST_ID_BYTES: usize = 128;
/// Largest input of a permission answer, serialized, in bytes.
pub const MAX_PERMISSION_INPUT_BYTES: usize = 1024 * 1024;

pub const KEY_EMPTY: &str = "validation.empty";
pub const KEY_TOO_LONG: &str = "validation.too_long";
pub const KEY_CONTROL_CHAR: &str = "validation.control_char";
pub const KEY_FORBIDDEN_CHAR: &str = "validation.forbidden_char";
pub const KEY_RESERVED_NAME: &str = "validation.reserved_name";
pub const KEY_BAD_RUN_ID: &str = "validation.bad_run_id";
pub const KEY_BAD_BRANCH: &str = "validation.bad_branch";
pub const KEY_BAD_SESSION: &str = "validation.bad_session";
pub const KEY_BAD_MODEL: &str = "validation.bad_model";
pub const KEY_BAD_REQUEST_ID: &str = "validation.bad_request_id";
pub const KEY_RUN_EXISTS: &str = "validation.run_exists";
pub const KEY_REQUEST_UNKNOWN: &str = "validation.request_unknown";
pub const KEY_BAD_STEPS: &str = "validation.bad_steps";

/// Longest workspace key (a root path), in bytes.
pub const MAX_WORKSPACE_KEY_BYTES: usize = 4096;
/// Longest error text saved with a chat turn, in bytes.
pub const MAX_TURN_ERROR_BYTES: usize = 20_000;
/// Largest steps JSON saved with a chat turn, in bytes.
pub const MAX_STEPS_BYTES: usize = 4_000_000;

/// A rejected input: only a stable key, never the value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    key: String,
}

impl ValidationError {
    pub fn key(&self) -> &str {
        &self.key
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.key)
    }
}

impl std::error::Error for ValidationError {}

impl From<ValidationError> for String {
    fn from(error: ValidationError) -> Self {
        error.key
    }
}

/// Runs the garde rules of `value` and keeps only the key of the first failure.
fn check<T: Validate<Context = ()>>(value: &T) -> Result<(), ValidationError> {
    value.validate().map_err(|report| ValidationError {
        key: report.iter().next().map_or_else(
            || KEY_EMPTY.to_string(),
            |(_, error)| error.message().to_string(),
        ),
    })
}

fn reject(key: &'static str) -> garde::Error {
    garde::Error::new(key)
}

fn has_control(value: &str) -> bool {
    value.chars().any(char::is_control)
}

// * Rules (the `custom` functions of the structs below) ---------------------------------------------------

fn display_name_rule(value: &str, _: &()) -> garde::Result {
    let name = value.trim();

    if name.is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if name.chars().count() > MAX_DISPLAY_NAME_CHARS {
        return Err(reject(KEY_TOO_LONG));
    }

    if has_control(name) {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    Ok(())
}

fn entry_name_rule(value: &str, _: &()) -> garde::Result {
    let name = value.trim();

    if name.is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if name.len() > MAX_ENTRY_NAME_BYTES {
        return Err(reject(KEY_TOO_LONG));
    }

    if has_control(name) {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    if name.contains(['/', '\\']) {
        return Err(reject(KEY_FORBIDDEN_CHAR));
    }

    // * Only the whole name is reserved: `archive..tar` is a legal name, `..` climbs out of the folder.
    if matches!(name, "." | "..") {
        return Err(reject(KEY_RESERVED_NAME));
    }

    Ok(())
}

fn path_rule(value: &str, _: &()) -> garde::Result {
    if value.is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if value.len() > MAX_PATH_BYTES {
        return Err(reject(KEY_TOO_LONG));
    }

    // * Any control character in a path (NUL first of all) is never a real file name.
    if has_control(value) {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    Ok(())
}

fn commit_message_rule(value: &str, _: &()) -> garde::Result {
    if value.trim().is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if value.chars().count() > MAX_COMMIT_MESSAGE_CHARS {
        return Err(reject(KEY_TOO_LONG));
    }

    // * A message is several lines, so newline, carriage return and tab stay; NUL and the rest do not.
    if value
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    Ok(())
}

fn branch_rule(value: &str, _: &()) -> garde::Result {
    if value.is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if value.len() > MAX_BRANCH_NAME_BYTES {
        return Err(reject(KEY_TOO_LONG));
    }

    if has_control(value) {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    // * The `git check-ref-format` rules that matter: nothing git would read as an option or a revision range.
    let bad = value.starts_with(['-', '/', '.'])
        || value.ends_with(['/', '.'])
        || value.ends_with(".lock")
        || value == "@"
        || value.contains("..")
        || value.contains("//")
        || value.contains("@{")
        || value.contains(|c: char| {
            c.is_whitespace() || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        })
        || value
            .split('/')
            .any(|part| part.starts_with('.') || part.ends_with(".lock"));

    if bad {
        return Err(reject(KEY_BAD_BRANCH));
    }

    Ok(())
}

/// The prefix a run id must start with (`run-` for chat turns).
pub struct RunIdContext {
    prefix: String,
}

fn run_id_rule(value: &str, context: &RunIdContext) -> garde::Result {
    let rest = value.strip_prefix(context.prefix.as_str());

    let valid = value.len() <= MAX_RUN_ID_BYTES
        && rest.is_some_and(|rest| {
            !rest.is_empty()
                && rest
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        });

    if valid {
        Ok(())
    } else {
        Err(reject(KEY_BAD_RUN_ID))
    }
}

fn question_rule(value: &str, _: &()) -> garde::Result {
    if value.trim().is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if value.chars().count() > MAX_QUESTION_CHARS {
        return Err(reject(KEY_TOO_LONG));
    }

    if value.contains('\0') {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    Ok(())
}

fn relay_message_rule(value: &str, _: &()) -> garde::Result {
    if value.trim().is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if value.len() > MAX_RELAY_MESSAGE_BYTES {
        return Err(reject(KEY_TOO_LONG));
    }

    if value
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    Ok(())
}

fn session_rule(value: &str, _: &()) -> garde::Result {
    // * The session goes straight after `--resume` / `resume`, so it must never be readable as a flag.
    let mut chars = value.chars();
    let valid = value.len() <= MAX_SESSION_BYTES
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));

    if valid {
        Ok(())
    } else {
        Err(reject(KEY_BAD_SESSION))
    }
}

fn model_rule(value: &str, _: &()) -> garde::Result {
    let valid = !value.is_empty()
        && value.chars().count() <= MAX_MODEL_CHARS
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'));

    if valid {
        Ok(())
    } else {
        Err(reject(KEY_BAD_MODEL))
    }
}

fn prompt_rule(value: &str, _: &()) -> garde::Result {
    if value.trim().is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if value.len() > MAX_PROMPT_BYTES {
        return Err(reject(KEY_TOO_LONG));
    }

    if value.contains('\0') {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    Ok(())
}

fn request_id_rule(value: &str, _: &()) -> garde::Result {
    let valid = !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_BYTES
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'));

    if valid {
        Ok(())
    } else {
        Err(reject(KEY_BAD_REQUEST_ID))
    }
}

fn snippet_rule(value: &str, _: &()) -> garde::Result {
    if value.len() > MAX_SNIPPET_BYTES {
        return Err(reject(KEY_TOO_LONG));
    }

    if value.contains('\0') {
        return Err(reject(KEY_CONTROL_CHAR));
    }

    Ok(())
}

// * Structs garde derives from (built from the command parameters, never exposed) ------------------------

#[derive(Validate)]
struct DisplayName<'a> {
    #[garde(custom(display_name_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct EntryName<'a> {
    #[garde(custom(entry_name_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct RelativePath<'a> {
    #[garde(custom(path_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct CommitMessage<'a> {
    #[garde(custom(commit_message_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct BranchName<'a> {
    #[garde(custom(branch_rule))]
    value: &'a str,
}

#[derive(Validate)]
#[garde(context(RunIdContext))]
struct RunId<'a> {
    #[garde(custom(run_id_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct Question<'a> {
    #[garde(custom(question_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct RelayMessage<'a> {
    #[garde(custom(relay_message_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct Session<'a> {
    #[garde(custom(session_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct Model<'a> {
    #[garde(custom(model_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct Prompt<'a> {
    #[garde(custom(prompt_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct RequestId<'a> {
    #[garde(custom(request_id_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct Snippet<'a> {
    #[garde(custom(snippet_rule))]
    value: &'a str,
}

// * Public API ---------------------------------------------------------------------------------------------

/// A name shown to people (account, profile): not blank, at most 100 characters, no control character.
pub fn display_name(value: &str) -> Result<(), ValidationError> {
    check(&DisplayName { value })
}

/// The new name of a file, folder or project: one path component, never `.`/`..`, no separator or control character.
pub fn entry_name(value: &str) -> Result<(), ValidationError> {
    check(&EntryName { value })
}

/// A path as the front end sends it: not empty, bounded, no control character (NUL included).
pub fn relative_path(value: &str) -> Result<(), ValidationError> {
    check(&RelativePath { value })
}

/// A commit message: not blank, at most 10 000 characters, no control character besides line breaks and tabs.
pub fn commit_message(value: &str) -> Result<(), ValidationError> {
    check(&CommitMessage { value })
}

/// A branch name by the rules of `git check-ref-format` that keep git from misreading it.
pub fn branch_name(value: &str) -> Result<(), ValidationError> {
    check(&BranchName { value })
}

/// A run id: `prefix`, then letters, digits, `-` or `_`; at most 64 bytes.
pub fn run_id(value: &str, prefix: &str) -> Result<(), ValidationError> {
    let context = RunIdContext {
        prefix: prefix.to_string(),
    };

    RunId { value }
        .validate_with(&context)
        .map_err(|report| ValidationError {
            key: report.iter().next().map_or_else(
                || KEY_BAD_RUN_ID.to_string(),
                |(_, error)| error.message().to_string(),
            ),
        })
}

/// A question for the AI: not blank, at most 20 000 characters, no NUL.
pub fn question(value: &str) -> Result<(), ValidationError> {
    check(&Question { value })
}

/// A code snippet for the AI: may be empty, at most 1 MB, no NUL.
pub fn snippet(value: &str) -> Result<(), ValidationError> {
    check(&Snippet { value })
}

/// A message one AI relays to another: not blank, at most 20 000 bytes, no control character besides line breaks and tabs.
pub fn relay_message(value: &str) -> Result<(), ValidationError> {
    check(&RelayMessage { value })
}

/// A CLI session id: starts with a letter or digit, then letters, digits, `-`, `_` or `.`; at most 128 bytes.
/// It goes straight after `--resume` / `resume`, so a value starting with `-` is refused.
pub fn valid_session(value: &str) -> Result<(), ValidationError> {
    check(&Session { value })
}

/// A model name for `--model` / `-m`: letters, digits and `. _ : -`, never starting with `-`; at most 100 characters.
pub fn valid_model(value: &str) -> Result<(), ValidationError> {
    check(&Model { value })
}

/// The prompt of a chat turn: not blank, at most 200 000 bytes, no NUL.
pub fn prompt(value: &str) -> Result<(), ValidationError> {
    check(&Prompt { value })
}

/// The id of a permission question of the CLI: letters, digits and `- _ . :`; at most 128 bytes.
pub fn request_id(value: &str) -> Result<(), ValidationError> {
    check(&RequestId { value })
}

/// A workspace key kept in the database: not empty, at most 4096 bytes, no control character.
pub fn workspace_key(value: &str) -> Result<(), ValidationError> {
    check(&RelativePath { value })
}

/// The error text of a saved chat turn: at most 20 000 bytes.
pub fn turn_error(value: &str) -> Result<(), ValidationError> {
    if value.len() > MAX_TURN_ERROR_BYTES {
        return Err(ValidationError {
            key: KEY_TOO_LONG.to_string(),
        });
    }

    Ok(())
}

/// The steps of a saved chat turn: at most 4 MB and valid JSON.
pub fn steps_json(value: &str) -> Result<(), ValidationError> {
    if value.len() > MAX_STEPS_BYTES {
        return Err(ValidationError {
            key: KEY_TOO_LONG.to_string(),
        });
    }

    serde_json::from_str::<serde_json::Value>(value).map_err(|_| ValidationError {
        key: KEY_BAD_STEPS.to_string(),
    })?;

    Ok(())
}

/// The input of a permission answer: at most 1 MiB once serialized.
pub fn permission_input(value: &serde_json::Value) -> Result<(), ValidationError> {
    match serde_json::to_vec(value) {
        Ok(bytes) if bytes.len() <= MAX_PERMISSION_INPUT_BYTES => Ok(()),
        _ => Err(ValidationError {
            key: KEY_TOO_LONG.to_string(),
        }),
    }
}

// * Secrets and environment ----------------------------------------------------------------------------

/// Longest API key, in characters.
pub const MAX_API_KEY_CHARS: usize = 500;

pub const KEY_BAD_API_KEY: &str = "validation.bad_api_key";
pub const KEY_FORBIDDEN_ENV: &str = "validation.forbidden_env";

fn api_key_rule(value: &str, _: &()) -> garde::Result {
    if value.is_empty() {
        return Err(reject(KEY_EMPTY));
    }

    if value.len() > MAX_API_KEY_CHARS {
        return Err(reject(KEY_TOO_LONG));
    }

    // * Printable ASCII without space only: a key goes into an environment variable and an HTTP header.
    if !value.bytes().all(|byte| (0x21..=0x7E).contains(&byte)) {
        return Err(reject(KEY_BAD_API_KEY));
    }

    Ok(())
}

/// Variables that change how a program is found, loaded or logged in: never set from the settings of a project.
fn is_sensitive_env_name(name: &str) -> bool {
    let name = name.to_ascii_uppercase();

    matches!(
        name.as_str(),
        "PATH" | "NODE_OPTIONS" | "CODEX_HOME" | "ANTHROPIC_API_KEY"
    ) || name.starts_with("LD_")
        || name.starts_with("DYLD_")
        || name.ends_with("_CONFIG_DIR")
}

fn env_name_rule(value: &str, _: &()) -> garde::Result {
    if is_sensitive_env_name(value) {
        Err(reject(KEY_FORBIDDEN_ENV))
    } else {
        Ok(())
    }
}

fn env_value_rule(value: &str, _: &()) -> garde::Result {
    // * A tab is fine in a value; a line break or any other control character is not.
    if value.chars().any(|c| c.is_control() && c != '\t') {
        Err(reject(KEY_CONTROL_CHAR))
    } else {
        Ok(())
    }
}

#[derive(Validate)]
struct ApiKey<'a> {
    #[garde(custom(api_key_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct EnvName<'a> {
    #[garde(custom(env_name_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct EnvValue<'a> {
    #[garde(custom(env_value_rule))]
    value: &'a str,
}

/// An API key: 1 to 500 printable ASCII characters (0x21..=0x7E), no space.
pub fn api_key(value: &str) -> Result<(), ValidationError> {
    check(&ApiKey { value })
}

/// An environment variable name that is not sensitive (`PATH`, `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `*_CONFIG_DIR`, `CODEX_HOME`, `ANTHROPIC_API_KEY`).
pub fn env_name(value: &str) -> Result<(), ValidationError> {
    check(&EnvName { value })
}

/// An environment variable value without control characters (a tab is allowed).
pub fn env_value(value: &str) -> Result<(), ValidationError> {
    check(&EnvValue { value })
}

// * Chat settings text and avatar --------------------------------------------------------------------------

/// Longest avatar data URL, in bytes (the front end shrinks the picture first).
pub const MAX_AVATAR_DATA_URL_BYTES: usize = 300_000;
pub const KEY_BAD_AVATAR: &str = "validation.bad_avatar";

const AVATAR_TYPES: [(&str, &str); 4] = [
    ("data:image/png;base64,", "image/png"),
    ("data:image/jpeg;base64,", "image/jpeg"),
    ("data:image/webp;base64,", "image/webp"),
    ("data:image/gif;base64,", "image/gif"),
];

fn plain_text_rule(value: &str, _: &()) -> garde::Result {
    if has_control(value) {
        Err(reject(KEY_CONTROL_CHAR))
    } else {
        Ok(())
    }
}

fn multiline_text_rule(value: &str, _: &()) -> garde::Result {
    if value
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        Err(reject(KEY_CONTROL_CHAR))
    } else {
        Ok(())
    }
}

/// The first bytes of a base64 text, decoded (enough to read an image signature); `None` when the text is not valid base64.
fn base64_head(encoded: &str) -> Option<Vec<u8>> {
    let bytes = encoded.as_bytes();
    let padding = bytes.iter().rev().take_while(|byte| **byte == b'=').count();
    let body = &bytes[..bytes.len() - padding];

    if padding > 2 || !bytes.len().is_multiple_of(4) || body.is_empty() {
        return None;
    }

    let mut decoded = Vec::with_capacity(16);
    let mut accumulator = 0u32;
    let mut bits = 0u32;

    for byte in body {
        let sextet = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };

        accumulator = (accumulator << 6) | u32::from(sextet);
        bits += 6;

        if bits >= 8 {
            bits -= 8;
            if decoded.len() < 16 {
                decoded.push(((accumulator >> bits) & 0xFF) as u8);
            }
        }
    }

    Some(decoded)
}

fn avatar_rule(value: &str, _: &()) -> garde::Result {
    if value.is_empty() {
        return Ok(());
    }

    if value.len() > MAX_AVATAR_DATA_URL_BYTES {
        return Err(reject(KEY_TOO_LONG));
    }

    let Some((prefix, mime)) = AVATAR_TYPES
        .iter()
        .find(|(prefix, _)| value.starts_with(prefix))
    else {
        return Err(reject(KEY_BAD_AVATAR));
    };
    let head = base64_head(&value[prefix.len()..]).ok_or_else(|| reject(KEY_BAD_AVATAR))?;
    let matches_type = match *mime {
        "image/png" => head.starts_with(&[0x89, b'P', b'N', b'G']),
        "image/jpeg" => head.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif" => head.starts_with(b"GIF8"),
        _ => head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WEBP",
    };

    if matches_type {
        Ok(())
    } else {
        Err(reject(KEY_BAD_AVATAR))
    }
}

#[derive(Validate)]
struct PlainText<'a> {
    #[garde(custom(plain_text_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct MultilineText<'a> {
    #[garde(custom(multiline_text_rule))]
    value: &'a str,
}

#[derive(Validate)]
struct Avatar<'a> {
    #[garde(custom(avatar_rule))]
    value: &'a str,
}

/// A one-line text (may be empty): no control character.
pub fn plain_text(value: &str) -> Result<(), ValidationError> {
    check(&PlainText { value })
}

/// A multi-line text (may be empty): no control character except newline, carriage return and tab.
pub fn multiline_text(value: &str) -> Result<(), ValidationError> {
    check(&MultilineText { value })
}

/// An avatar data URL (may be empty): png/jpeg/webp/gif, valid base64, signature matching the type, at most 300 000 bytes.
pub fn avatar(value: &str) -> Result<(), ValidationError> {
    check(&Avatar { value })
}

#[cfg(test)]
#[path = "../tests/unit/validation.rs"]
mod agent_input_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn key<T>(result: Result<T, ValidationError>) -> String {
        result.err().expect("rejected").key().to_string()
    }

    #[test]
    fn display_name_bounds() {
        assert!(display_name("Phúc").is_ok());
        assert!(display_name(&"a".repeat(100)).is_ok());
        assert!(display_name(&"é".repeat(100)).is_ok());
        assert_eq!(key(display_name(&"a".repeat(101))), KEY_TOO_LONG);
        assert_eq!(key(display_name(&"é".repeat(101))), KEY_TOO_LONG);
        assert_eq!(key(display_name("")), KEY_EMPTY);
        assert_eq!(key(display_name("  \t ")), KEY_EMPTY);
        assert_eq!(key(display_name("a\nb")), KEY_CONTROL_CHAR);
        assert_eq!(key(display_name("a\0b")), KEY_CONTROL_CHAR);
        assert!(display_name("Nguyễn Hoàng 🚀").is_ok());
    }

    #[test]
    fn entry_name_rules() {
        assert!(entry_name("main.rs").is_ok());
        assert!(entry_name("báo cáo.md").is_ok());
        assert!(entry_name("archive..tar").is_ok());
        assert!(entry_name(" padded.txt \n").is_ok());
        assert!(entry_name(&"a".repeat(255)).is_ok());
        assert_eq!(key(entry_name(&"a".repeat(256))), KEY_TOO_LONG);
        assert_eq!(key(entry_name("")), KEY_EMPTY);
        assert_eq!(key(entry_name("   ")), KEY_EMPTY);
        assert_eq!(key(entry_name("..")), KEY_RESERVED_NAME);
        assert_eq!(key(entry_name(".")), KEY_RESERVED_NAME);
        assert_eq!(key(entry_name("../x")), KEY_FORBIDDEN_CHAR);
        assert_eq!(key(entry_name("a/b")), KEY_FORBIDDEN_CHAR);
        assert_eq!(key(entry_name("a\\b")), KEY_FORBIDDEN_CHAR);
        assert_eq!(key(entry_name("a\0b")), KEY_CONTROL_CHAR);
    }

    #[test]
    fn entry_name_counts_bytes_not_characters() {
        // 128 two-byte characters are 256 bytes.
        assert!(entry_name(&"é".repeat(127)).is_ok());
        assert_eq!(key(entry_name(&"é".repeat(128))), KEY_TOO_LONG);
    }

    #[test]
    fn path_rules() {
        assert!(relative_path("src/lib.rs").is_ok());
        assert!(relative_path("tài liệu/ghi chú.md").is_ok());
        assert!(relative_path(&"a".repeat(4096)).is_ok());
        assert_eq!(key(relative_path(&"a".repeat(4097))), KEY_TOO_LONG);
        assert_eq!(key(relative_path("")), KEY_EMPTY);
        assert_eq!(key(relative_path("a\0b")), KEY_CONTROL_CHAR);
    }

    #[test]
    fn commit_message_rules() {
        assert!(commit_message("fix: lỗi\n\nMô tả\tchi tiết\r\n").is_ok());
        assert!(commit_message(&"a".repeat(10_000)).is_ok());
        assert_eq!(key(commit_message(&"a".repeat(10_001))), KEY_TOO_LONG);
        assert_eq!(key(commit_message("")), KEY_EMPTY);
        assert_eq!(key(commit_message(" \n ")), KEY_EMPTY);
        assert_eq!(key(commit_message("a\0b")), KEY_CONTROL_CHAR);
        assert_eq!(key(commit_message("a\u{1b}[31m")), KEY_CONTROL_CHAR);
    }

    #[test]
    fn branch_name_rules() {
        for good in [
            "main",
            "feature/đăng-nhập",
            "release-1.2",
            "a.b/c_d",
            "v1.0.0",
        ] {
            assert!(branch_name(good).is_ok(), "{good}");
        }

        for bad in [
            "-rf",
            "a..b",
            "a b",
            "a~1",
            "a^",
            "a:b",
            "a?",
            "a*",
            "a[",
            "a\\b",
            "/a",
            "a/",
            "a//b",
            ".a",
            "a/.b",
            "a.",
            "a.lock",
            "a/b.lock/c",
            "@",
            "a@{u}",
        ] {
            assert_eq!(key(branch_name(bad)), KEY_BAD_BRANCH, "{bad}");
        }

        assert_eq!(key(branch_name("")), KEY_EMPTY);
        assert_eq!(key(branch_name("a\0b")), KEY_CONTROL_CHAR);
        assert!(branch_name(&"a".repeat(255)).is_ok());
        assert_eq!(key(branch_name(&"a".repeat(256))), KEY_TOO_LONG);
    }

    #[test]
    fn run_id_rules() {
        assert!(run_id("run-lx3k9-0", "run-").is_ok());
        assert!(run_id("run-A_b-9", "run-").is_ok());
        assert!(run_id(&format!("run-{}", "a".repeat(60)), "run-").is_ok());
        assert_eq!(
            key(run_id(&format!("run-{}", "a".repeat(61)), "run-")),
            KEY_BAD_RUN_ID
        );

        for bad in [
            "", "run-", "abc", "run-a/b", "run-a b", "run-a\0", "run-..", "run-é", "RUN-1",
        ] {
            assert_eq!(key(run_id(bad, "run-")), KEY_BAD_RUN_ID, "{bad}");
        }

        assert!(run_id("bg-1", "bg-").is_ok());
    }

    #[test]
    fn question_and_snippet_rules() {
        assert!(question("Giải thích đoạn này?").is_ok());
        assert_eq!(key(question("  ")), KEY_EMPTY);
        assert_eq!(key(question("a\0")), KEY_CONTROL_CHAR);
        assert!(question(&"a".repeat(20_000)).is_ok());
        assert_eq!(key(question(&"a".repeat(20_001))), KEY_TOO_LONG);

        assert!(snippet("").is_ok());
        assert!(snippet("fn main() {\n\tprintln!(\"é\");\n}").is_ok());
        assert_eq!(key(snippet("a\0")), KEY_CONTROL_CHAR);
        assert!(snippet(&"a".repeat(1_000_000)).is_ok());
        assert_eq!(key(snippet(&"a".repeat(1_000_001))), KEY_TOO_LONG);
    }

    #[test]
    fn error_never_carries_the_value() {
        let error = entry_name("secret-token/\0").unwrap_err();

        assert!(!error.to_string().contains("secret"));
        assert_eq!(String::from(error), KEY_CONTROL_CHAR);
    }
}
