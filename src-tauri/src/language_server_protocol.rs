//! The wire side of the Language Server Protocol: JSON-RPC 2.0 messages framed with `Content-Length`, `file://` URIs inside the sandbox and text edits counted in UTF-16 units.
//!
//! Nothing here starts a process or touches Tauri. Reading never trusts a length from the other side: it is checked against [`MAX_MESSAGE_BYTES`] before a byte of the body is read.

use crate::permission::Sandbox;
use crate::workspace::normalise;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

/// Largest message (body) accepted from or sent to a server: 16 MiB.
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

/// Largest header block; a real one is a few dozen bytes.
const MAX_HEADER_BYTES: usize = 8 * 1024;

const READ_CHUNK_BYTES: usize = 8 * 1024;

const HEADER_END: &[u8] = b"\r\n\r\n";

const FILE_SCHEME: &str = "file://";

/// Why a message could not be read or written. A reader that failed is not used again: the session is closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolError {
    /// The header block has no valid `Content-Length`, is too long or is not text.
    BadHeader,
    TooLarge,
    /// The body is not UTF-8 or not a JSON object.
    BadBody,
    /// The stream ended, or failed, in the middle of a message.
    Closed,
}

impl ProtocolError {
    /// Fixed key for the front end and the log.
    pub fn key(self) -> &'static str {
        match self {
            Self::BadHeader => "language_server.bad_header",
            Self::TooLarge => "language_server.message_too_large",
            Self::BadBody => "language_server.bad_message",
            Self::Closed => "language_server.closed",
        }
    }
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.key())
    }
}

impl std::error::Error for ProtocolError {}

/// A position in a document: zero-based line and UTF-16 code units in the line, as the protocol counts them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

/// Reads framed messages from a stream, however the bytes are cut or joined by the reads.
pub struct MessageReader<R> {
    inner: R,
    buffer: Vec<u8>,
}

impl<R: Read> MessageReader<R> {
    pub fn new(inner: R) -> Self {
        Self {
            inner,
            buffer: Vec::new(),
        }
    }

    /// The next message, or `None` when the stream ended cleanly between two messages.
    ///
    /// # Errors
    /// Fails on a bad header, a length over the limit, a body that is not a JSON object, or a stream cut inside a message.
    pub fn next_message(&mut self) -> Result<Option<Value>, ProtocolError> {
        let header_length = loop {
            if let Some(found) = find(&self.buffer, HEADER_END) {
                break found;
            }

            if self.buffer.len() > MAX_HEADER_BYTES {
                return Err(ProtocolError::BadHeader);
            }

            if self.fill()? == 0 {
                return if self.buffer.is_empty() {
                    Ok(None)
                } else {
                    Err(ProtocolError::Closed)
                };
            }
        };

        if header_length > MAX_HEADER_BYTES {
            return Err(ProtocolError::BadHeader);
        }

        let length = content_length(&self.buffer[..header_length])?;

        if length > MAX_MESSAGE_BYTES {
            return Err(ProtocolError::TooLarge);
        }

        let body_start = header_length + HEADER_END.len();
        let body_end = body_start + length;

        // * The buffer only grows by what was really read, never by what the header promised.
        while self.buffer.len() < body_end {
            if self.fill()? == 0 {
                return Err(ProtocolError::Closed);
            }
        }

        let parsed = serde_json::from_slice::<Value>(&self.buffer[body_start..body_end]);

        self.buffer.drain(..body_end);

        match parsed {
            Ok(message) if message.is_object() => Ok(Some(message)),
            _ => Err(ProtocolError::BadBody),
        }
    }

    fn fill(&mut self) -> Result<usize, ProtocolError> {
        let mut chunk = [0u8; READ_CHUNK_BYTES];

        loop {
            match self.inner.read(&mut chunk) {
                Ok(read) => {
                    self.buffer.extend_from_slice(&chunk[..read]);

                    return Ok(read);
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Err(ProtocolError::Closed),
            }
        }
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// The `Content-Length` of a header block (other headers such as `Content-Type` are ignored).
fn content_length(header: &[u8]) -> Result<usize, ProtocolError> {
    let text = std::str::from_utf8(header).map_err(|_| ProtocolError::BadHeader)?;
    let mut length = None;

    for line in text.split("\r\n") {
        let (name, value) = line.split_once(':').ok_or(ProtocolError::BadHeader)?;

        if name.trim().eq_ignore_ascii_case("content-length") {
            let digits = value.trim();

            if length.is_some()
                || digits.is_empty()
                || !digits.bytes().all(|byte| byte.is_ascii_digit())
            {
                return Err(ProtocolError::BadHeader);
            }

            // * More digits than any usize needs is simply "too large", not a parse failure.
            length = Some(digits.parse::<usize>().unwrap_or(usize::MAX));
        }
    }

    length.ok_or(ProtocolError::BadHeader)
}

/// Writes one framed message and flushes.
///
/// # Errors
/// Fails when the body is over the limit or the stream cannot be written.
pub fn write_message(writer: &mut impl Write, message: &Value) -> io::Result<()> {
    let body = serde_json::to_vec(message).map_err(io::Error::other)?;

    if body.len() > MAX_MESSAGE_BYTES {
        return Err(io::Error::other(ProtocolError::TooLarge));
    }

    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(&body)?;
    writer.flush()
}

/// What the other side sent.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
    Response {
        id: u64,
        result: Result<Value, RpcError>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

pub const METHOD_NOT_FOUND: i64 = -32601;

/// Sorts a decoded message into request, notification or response; `None` for anything else (a response with an id we never used, a non-JSON-RPC object).
///
/// Takes the message by value: the `params` or `result` (up to [`MAX_MESSAGE_BYTES`]) are moved out, not deep-copied.
pub fn classify(mut message: Value) -> Option<Incoming> {
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_string);
    let id = message.get("id").filter(|id| !id.is_null()).cloned();

    match (method, id) {
        (Some(method), Some(id)) => Some(Incoming::Request {
            id,
            method,
            params: message["params"].take(),
        }),
        (Some(method), None) => Some(Incoming::Notification {
            method,
            params: message["params"].take(),
        }),
        (None, Some(id)) => {
            let id = id.as_u64()?;
            let result = match message.get("error") {
                Some(error) => Err(RpcError {
                    code: error.get("code").and_then(Value::as_i64).unwrap_or(0),
                    message: error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                }),
                None => Ok(message["result"].take()),
            };

            Some(Incoming::Response { id, result })
        }
        (None, None) => None,
    }
}

pub fn request_message(id: u64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

pub fn notification_message(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

pub fn response_message(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn error_response_message(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// `file://` URI of a file that exists inside the sandbox, from its relative path. `None` for a path that does not pass [`normalise`], does not exist, or links out of the root.
pub fn path_to_uri(sandbox: &Sandbox, relative: &str) -> Option<String> {
    let clean = normalise(relative)?;
    let resolved = sandbox.resolve(&sandbox.root().join(clean))?;

    Some(file_uri(&resolved))
}

/// `file://` URI of an absolute path, percent-encoded.
pub fn file_uri(path: &Path) -> String {
    let mut uri = String::from(FILE_SCHEME);

    for byte in path.to_string_lossy().bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            uri.push(char::from(byte));
        } else {
            uri.push_str(&format!("%{byte:02X}"));
        }
    }

    uri
}

/// The absolute path a `file://` URI names. `None` for another scheme or host, a query or fragment, bad escapes, control characters or `.`/`..` segments.
pub fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix(FILE_SCHEME)?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);

    if !rest.starts_with('/') || rest.contains(['?', '#']) {
        return None;
    }

    let decoded = percent_decode(rest)?;

    if decoded.chars().any(char::is_control) {
        return None;
    }

    let path = PathBuf::from(decoded);

    path.components()
        .all(|component| matches!(component, Component::RootDir | Component::Normal(_)))
        .then_some(path)
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;

            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(decoded).ok()
}

/// Relative path of a URI that lies inside the sandbox, `None` for anything outside it or not a plain path of the project.
pub fn uri_to_relative(sandbox: &Sandbox, uri: &str) -> Option<String> {
    let path = uri_to_path(uri)?;
    // * An existing file is judged by its real path (a link out of the root is outside); a file that is not there yet only by its own.
    let inside = if path.exists() {
        sandbox.resolve(&path)?
    } else if sandbox.contains(&path) {
        path
    } else {
        return None;
    };
    let relative = sandbox.relative(&inside);

    normalise(&relative)
}

/// Byte offset in `text` of a protocol position. A line past the end is the end of the text, a character past the end of its line is the end of that line (before its line break), and a character inside a surrogate pair rounds down.
pub fn offset_of(text: &str, position: Position) -> usize {
    let bytes = text.as_bytes();
    let mut line_start = 0;

    for _ in 0..position.line {
        match line_break_end(bytes, line_start) {
            Some(next) => line_start = next,
            None => return text.len(),
        }
    }

    let mut units = 0u32;

    for (index, character) in text[line_start..].char_indices() {
        if matches!(character, '\n' | '\r') || units >= position.character {
            return line_start + index;
        }

        let width = u32::try_from(character.len_utf16()).unwrap_or(2);

        if units + width > position.character {
            return line_start + index;
        }

        units += width;
    }

    text.len()
}

/// Index just after the first line break at or after `from` (`\n`, `\r\n` or a lone `\r`).
fn line_break_end(bytes: &[u8], from: usize) -> Option<usize> {
    let at = bytes[from..]
        .iter()
        .position(|byte| matches!(byte, b'\n' | b'\r'))?
        + from;

    if bytes[at] == b'\r' && bytes.get(at + 1) == Some(&b'\n') {
        Some(at + 2)
    } else {
        Some(at + 1)
    }
}

/// Applies one change event: a range replaced by `new_text`, or the whole text when there is no range. Returns false (and leaves `text` alone) for a range that ends before it starts.
pub fn apply_change(text: &mut String, range: Option<&Range>, new_text: &str) -> bool {
    let Some(range) = range else {
        new_text.clone_into(text);

        return true;
    };
    let start = offset_of(text, range.start);
    let end = offset_of(text, range.end);

    if end < start {
        return false;
    }

    text.replace_range(start..end, new_text);

    true
}

/// Applies edits that all refer to the same original text (a rename in one file): none may overlap. `None` when two do, or one ends before it starts.
pub fn apply_edits(text: &str, edits: &[(Range, String)]) -> Option<String> {
    let mut spans: Vec<(usize, usize, &str)> = Vec::with_capacity(edits.len());

    for (range, new_text) in edits {
        let start = offset_of(text, range.start);
        let end = offset_of(text, range.end);

        if end < start {
            return None;
        }

        spans.push((start, end, new_text));
    }

    spans.sort_by_key(|(start, end, _)| (*start, *end));

    if spans.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return None;
    }

    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;

    for (start, end, new_text) in spans {
        result.push_str(&text[cursor..start]);
        result.push_str(new_text);
        cursor = end;
    }

    result.push_str(&text[cursor..]);

    Some(result)
}

#[cfg(test)]
#[path = "../tests/unit/language_server_protocol.rs"]
mod tests;
