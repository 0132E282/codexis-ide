//! Client of a local VieNeu-TTS server (OpenAI-compatible speech API) that reads Vietnamese aloud.
//!
//! The app never installs or starts the server: the person runs it. Only loopback addresses over plain
//! HTTP are reachable, redirects are refused, the answer is capped and nothing is written to disk. The
//! HTTP/1.1 client is the minimum needed (Content-Length and chunked bodies) over `std::net::TcpStream`.

use serde::Serialize;
use std::fmt;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::time::Duration;

/// Longest text sent in one request, in characters.
pub const MAX_TEXT_CHARS: usize = 500;
/// Largest audio answer, in bytes.
pub const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
/// Largest answer of the status endpoints, in bytes.
const MAX_JSON_BYTES: usize = 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_LINE_BYTES: usize = 8192;
const MAX_HEADER_LINES: usize = 100;
const MAX_VOICES: usize = 200;
const MAX_VOICE_CHARS: usize = 200;
/// Slowest and fastest speed asked of the server, in percent.
const MIN_SPEED_PERCENT: u32 = 80;
const MAX_SPEED_PERCENT: u32 = 125;
const MODEL_NAME: &str = "vieneu-tts";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpeechError {
    BadUrl,
    Unreachable,
    BadResponse,
    TooLarge,
    TextTooLong,
}

impl SpeechError {
    /// Fixed user-facing key (translated by the front end).
    pub fn message(self) -> &'static str {
        match self {
            Self::BadUrl => "speech.bad_url",
            Self::Unreachable => "speech.unreachable",
            Self::BadResponse => "speech.bad_response",
            Self::TooLarge => "speech.too_large",
            Self::TextTooLong => "speech.text_too_long",
        }
    }
}

impl fmt::Display for SpeechError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for SpeechError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Voice {
    pub id: String,
    pub name: String,
    /// `north`, `central`, `south` or empty (the server does not say).
    pub region: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub reachable: bool,
    pub voices: Vec<Voice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Synthesized {
    pub wav_base64: String,
}

/// A parsed loopback address: where to connect and what to put in the `Host` header.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Target {
    addresses: Vec<SocketAddr>,
    host_header: String,
}

fn parse_target(base_url: &str) -> Result<Target, SpeechError> {
    let trimmed = base_url.trim();
    let rest = trimmed
        .get(..7)
        .filter(|scheme| scheme.eq_ignore_ascii_case("http://"))
        .map(|_| &trimmed[7..])
        .ok_or(SpeechError::BadUrl)?;
    let authority = rest.strip_suffix('/').unwrap_or(rest);

    if authority.is_empty() || authority.contains(['/', '?', '#', '@', '\\']) {
        return Err(SpeechError::BadUrl);
    }

    let (host, port_text) = if let Some(bracketed) = authority.strip_prefix('[') {
        let (inner, after) = bracketed.split_once(']').ok_or(SpeechError::BadUrl)?;

        (
            format!("[{inner}]"),
            match after {
                "" => None,
                other => Some(other.strip_prefix(':').ok_or(SpeechError::BadUrl)?),
            },
        )
    } else {
        match authority.split_once(':') {
            Some((host, port)) => (host.to_string(), Some(port)),
            None => (authority.to_string(), None),
        }
    };
    let port = match port_text {
        None => 80,
        Some(text) => text
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0 && text.bytes().all(|byte| byte.is_ascii_digit()))
            .ok_or(SpeechError::BadUrl)?,
    };
    let ipv4 = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let ipv6 = SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), port);
    let addresses = match host.to_ascii_lowercase().as_str() {
        "127.0.0.1" => vec![ipv4],
        "[::1]" => vec![ipv6],
        // * No name lookup: `localhost` is always the loopback, whatever the resolver says.
        "localhost" => vec![ipv4, ipv6],
        _ => return Err(SpeechError::BadUrl),
    };

    Ok(Target {
        addresses,
        host_header: format!("{host}:{port}"),
    })
}

/// Whether `base_url` is a loopback `http://` address this client may call.
pub fn is_loopback_url(base_url: &str) -> bool {
    parse_target(base_url).is_ok()
}

struct Response {
    status: u16,
    body: Vec<u8>,
}

fn connect(target: &Target) -> Result<TcpStream, SpeechError> {
    let stream = target
        .addresses
        .iter()
        .find_map(|address| TcpStream::connect_timeout(address, CONNECT_TIMEOUT).ok())
        .ok_or(SpeechError::Unreachable)?;

    stream
        .set_read_timeout(Some(READ_TIMEOUT))
        .and_then(|()| stream.set_write_timeout(Some(READ_TIMEOUT)))
        .map_err(|_| SpeechError::Unreachable)?;

    Ok(stream)
}

fn read_line(reader: &mut impl BufRead) -> Result<String, SpeechError> {
    let mut line = Vec::new();

    reader
        .take(MAX_LINE_BYTES as u64 + 1)
        .read_until(b'\n', &mut line)
        .map_err(|_| SpeechError::Unreachable)?;

    if line.len() > MAX_LINE_BYTES || line.last() != Some(&b'\n') {
        return Err(SpeechError::BadResponse);
    }

    String::from_utf8(line)
        .map(|text| text.trim_end().to_string())
        .map_err(|_| SpeechError::BadResponse)
}

/// Reads exactly `length` bytes (never more than `limit`).
fn read_exact_bytes(reader: &mut impl Read, length: usize) -> Result<Vec<u8>, SpeechError> {
    let mut bytes = Vec::new();

    reader
        .take(length as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| SpeechError::Unreachable)?;

    if bytes.len() == length {
        Ok(bytes)
    } else {
        Err(SpeechError::BadResponse)
    }
}

fn read_chunked(reader: &mut impl BufRead, limit: usize) -> Result<Vec<u8>, SpeechError> {
    let mut body = Vec::new();

    loop {
        let size_line = read_line(reader)?;
        let size_text = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16).map_err(|_| SpeechError::BadResponse)?;

        if size == 0 {
            // * Trailers, if any, up to the blank line.
            for _ in 0..MAX_HEADER_LINES {
                if read_line(reader)?.is_empty() {
                    break;
                }
            }

            return Ok(body);
        }

        if body.len().saturating_add(size) > limit {
            return Err(SpeechError::TooLarge);
        }

        body.extend(read_exact_bytes(reader, size)?);

        if !read_line(reader)?.is_empty() {
            return Err(SpeechError::BadResponse);
        }
    }
}

fn read_response(stream: impl Read, limit: usize) -> Result<Response, SpeechError> {
    let mut reader = BufReader::new(stream);
    let status_line = read_line(&mut reader)?;
    let mut parts = status_line.split_whitespace();
    let version_ok = parts
        .next()
        .is_some_and(|version| version.starts_with("HTTP/1."));
    let status = parts
        .next()
        .and_then(|code| code.parse::<u16>().ok())
        .filter(|_| version_ok)
        .ok_or(SpeechError::BadResponse)?;
    let mut content_length: Option<usize> = None;
    let mut chunked = false;

    for _ in 0..MAX_HEADER_LINES {
        let line = read_line(&mut reader)?;

        if line.is_empty() {
            return finish_response(reader, status, content_length, chunked, limit);
        }

        let Some((name, value)) = line.split_once(':') else {
            return Err(SpeechError::BadResponse);
        };
        let value = value.trim();

        if name.eq_ignore_ascii_case("content-length") {
            content_length = Some(value.parse().map_err(|_| SpeechError::BadResponse)?);
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            chunked = value.to_ascii_lowercase().contains("chunked");
        }
    }

    Err(SpeechError::BadResponse)
}

fn finish_response(
    mut reader: BufReader<impl Read>,
    status: u16,
    content_length: Option<usize>,
    chunked: bool,
    limit: usize,
) -> Result<Response, SpeechError> {
    // * Redirects (and anything else that is not a success) are never followed.
    if !(200..300).contains(&status) {
        return Err(SpeechError::BadResponse);
    }

    let body = if chunked {
        read_chunked(&mut reader, limit)?
    } else if let Some(length) = content_length {
        if length > limit {
            return Err(SpeechError::TooLarge);
        }

        read_exact_bytes(&mut reader, length)?
    } else {
        let mut bytes = Vec::new();

        reader
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| SpeechError::Unreachable)?;

        if bytes.len() > limit {
            return Err(SpeechError::TooLarge);
        }

        bytes
    };

    Ok(Response { status, body })
}

fn request(
    target: &Target,
    method: &str,
    path: &str,
    json_body: Option<&str>,
    limit: usize,
) -> Result<Response, SpeechError> {
    let mut stream = connect(target)?;
    let mut head = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}\r\nAccept: */*\r\nConnection: close\r\n",
        target.host_header
    );

    if let Some(body) = json_body {
        head.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        ));
    }

    head.push_str("\r\n");
    stream
        .write_all(head.as_bytes())
        .and_then(|()| stream.write_all(json_body.unwrap_or("").as_bytes()))
        .and_then(|()| stream.flush())
        .map_err(|_| SpeechError::Unreachable)?;

    read_response(stream, limit)
}

fn text_of(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.chars().count() <= MAX_VOICE_CHARS)
        .map(str::to_string)
}

/// The region a voice speaks, from what the server says about it: a region/accent/dialect field (a bare "Bắc", "north"...) or a phrase in its name or description ("miền Nam", "Hà Nội", "southern"...). Empty when nothing says; names alone are never guessed from.
fn detect_region(item: &serde_json::Value) -> String {
    let phrase = |text: &str| {
        let text = text.to_lowercase();
        let has = |words: &[&str]| words.iter().any(|word| text.contains(word));

        if has(&["miền bắc", "hà nội", "ha noi", "northern", "north"]) {
            "north"
        } else if has(&["miền trung", "huế", "central"]) {
            "central"
        } else if has(&["miền nam", "sài gòn", "sai gon", "southern", "south"]) {
            "south"
        } else {
            ""
        }
    };
    let field = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| item.get(key).and_then(serde_json::Value::as_str))
            .unwrap_or("")
    };
    // * A region field may be the bare word.
    let declared = field(&["region", "accent", "dialect"])
        .trim()
        .to_lowercase();
    let bare = match declared.as_str() {
        "bắc" | "bac" | "north" => "north",
        "trung" | "central" => "central",
        "nam" | "south" => "south",
        _ => "",
    };

    [
        bare,
        phrase(&declared),
        phrase(field(&["description", "name", "label"])),
    ]
    .into_iter()
    .find(|region| !region.is_empty())
    .unwrap_or("")
    .to_string()
}

/// Voices from the answer of `/v1/voices`, whatever shape it has: an array (of names or objects), or an object holding one under `voices` or `data` (or mapping id to name).
fn parse_voices(body: &[u8]) -> Vec<Voice> {
    let Ok(root) = serde_json::from_slice::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let list = root
        .get("voices")
        .or_else(|| root.get("data"))
        .unwrap_or(&root);
    let mut voices: Vec<Voice> = match list {
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                serde_json::Value::String(name) => Some(Voice {
                    id: name.trim().to_string(),
                    name: name.trim().to_string(),
                    region: String::new(),
                }),
                other => {
                    let id = text_of(other, &["id", "voice_id", "name"])?;
                    let name = text_of(other, &["name", "description", "id"])
                        .unwrap_or_else(|| id.clone());

                    Some(Voice {
                        id,
                        name,
                        region: detect_region(other),
                    })
                }
            })
            .collect(),
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(id, value)| Voice {
                id: id.clone(),
                name: value.as_str().unwrap_or(id).to_string(),
                region: String::new(),
            })
            .collect(),
        _ => Vec::new(),
    };

    voices.retain(|voice| !voice.id.is_empty() && voice.id.chars().count() <= MAX_VOICE_CHARS);
    voices.truncate(MAX_VOICES);

    voices
}

/// Whether the server answers, and its voices. Only a bad address is an error; an unreachable server is `reachable: false`.
///
/// # Errors
/// Fails with `speech.bad_url` when `base_url` is not a loopback `http://` address.
pub fn status(base_url: &str) -> Result<Status, SpeechError> {
    let target = parse_target(base_url)?;

    if request(&target, "GET", "/health", None, MAX_JSON_BYTES).is_err() {
        return Ok(Status {
            reachable: false,
            voices: Vec::new(),
        });
    }

    let voices = request(&target, "GET", "/v1/voices", None, MAX_JSON_BYTES)
        .map(|response| parse_voices(&response.body))
        .unwrap_or_default();

    Ok(Status {
        reachable: true,
        voices,
    })
}

fn is_wav(bytes: &[u8]) -> bool {
    bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE"
}

/// Speaks `text` with `voice` (empty = the server's default) and returns the WAV file as bytes.
///
/// # Errors
/// Fails on a bad address, a text over `MAX_TEXT_CHARS`, an unreachable server, an answer that is not a WAV file, or one over `MAX_AUDIO_BYTES`.
pub fn synthesize(
    base_url: &str,
    voice: &str,
    text: &str,
    speed_percent: Option<u32>,
) -> Result<Vec<u8>, SpeechError> {
    synthesize_limited(base_url, voice, text, speed_percent, MAX_AUDIO_BYTES)
}

fn synthesize_limited(
    base_url: &str,
    voice: &str,
    text: &str,
    speed_percent: Option<u32>,
    limit: usize,
) -> Result<Vec<u8>, SpeechError> {
    let target = parse_target(base_url)?;
    let text = text.trim();

    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(SpeechError::TextTooLong);
    }

    if text.is_empty() || voice.chars().count() > MAX_VOICE_CHARS {
        return Err(SpeechError::BadResponse);
    }

    let mut payload = serde_json::json!({
        "model": MODEL_NAME,
        "input": text,
        "response_format": "wav",
    });

    if !voice.trim().is_empty() {
        payload["voice"] = serde_json::Value::from(voice.trim());
    }

    // * The OpenAI speech API has a `speed` field; a server that does not know it ignores it.
    if let Some(percent) = speed_percent.filter(|percent| *percent != 100) {
        if !(MIN_SPEED_PERCENT..=MAX_SPEED_PERCENT).contains(&percent) {
            return Err(SpeechError::BadResponse);
        }

        payload["speed"] = serde_json::Value::from(f64::from(percent) / 100.0);
    }

    let response = request(
        &target,
        "POST",
        "/v1/audio/speech",
        Some(&payload.to_string()),
        limit,
    )?;

    if response.status != 200 || !is_wav(&response.body) {
        return Err(SpeechError::BadResponse);
    }

    Ok(response.body)
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding.
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        let combined = (u32::from(first) << 16) | (u32::from(second) << 8) | u32::from(third);

        for (index, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if index <= chunk.len() {
                encoded.push(char::from(
                    BASE64_ALPHABET[(combined >> shift) as usize & 63],
                ));
            } else {
                encoded.push('=');
            }
        }
    }

    encoded
}

#[cfg(test)]
#[path = "../tests/unit/speech.rs"]
mod tests;
