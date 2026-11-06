//! Control of the AI chat from a phone on the same network.
//!
//! The IDE listens on a random port; the phone scans a QR code holding `{ v, host, port, token }` and connects with a WebSocket.
//! Its first message must be `{"type":"auth","token":"..."}`. After that it can send `{"type":"send","prompt":"..."}`
//! (handed to the chat as the `remote-send` event) and receives every chat event as `{"type":"event", ...}`.
//! The token lives only while the server runs: stopping it (or quitting the app) ends every connection.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, TcpListener as StdTcpListener, UdpSocket};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, EventId, Listener};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};
use tokio_tungstenite::tungstenite::Message;

/// Phones connected at once.
const MAX_PHONES: usize = 3;
/// The longest prompt a phone may send (characters).
const MAX_PROMPT_CHARS: usize = 20_000;
/// Time a new connection has to introduce itself with the token.
const AUTH_TIMEOUT: Duration = Duration::from_secs(5);

/// What the phone needs to connect: the address and the pairing token (the QR code holds exactly this).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Info {
    pub host: String,
    pub port: u16,
    pub token: String,
}

/// A message of the phone.
#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ClientMessage {
    Auth { token: String },
    Send { prompt: String },
}

/// Reads one text message of the phone; None when it is not one of the known messages.
pub fn parse_message(text: &str) -> Option<ClientMessage> {
    serde_json::from_str(text).ok()
}

/// Compares two tokens without stopping at the first difference, so the time taken tells nothing about the token.
pub fn tokens_match(given: &str, expected: &str) -> bool {
    let given = given.as_bytes();
    let expected = expected.as_bytes();
    let mut difference = given.len() ^ expected.len();

    for (index, byte) in expected.iter().enumerate() {
        difference |= usize::from(byte ^ given.get(index).copied().unwrap_or(0));
    }

    difference == 0
}

/// A random pairing token: 32 hexadecimal characters from the operating system.
fn generate_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];

    getrandom::fill(&mut bytes).map_err(|_| "Không tạo được mã ghép đôi.".to_string())?;

    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Whether `address` can be reached by a phone on the network (not a loopback or unspecified one).
fn reachable(address: IpAddr) -> bool {
    address.is_ipv4() && !address.is_loopback() && !address.is_unspecified()
}

/// The address of this machine on the local network. Connecting a UDP socket sends nothing: it only makes the system pick the network card.
fn local_host() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("192.0.2.1:9")?;
            socket.local_addr()
        })
        .map(|address| address.ip())
        .ok()
        .filter(|address| reachable(*address))
        .map_or_else(|| "127.0.0.1".to_string(), |address| address.to_string())
}

/// The `{"type":"event", ...}` message for a chat event (the payload of `agent-event`); None when it is not an object.
fn event_message(payload: &str) -> Option<String> {
    let mut value = serde_json::from_str::<serde_json::Value>(payload).ok()?;

    value
        .as_object_mut()?
        .insert("type".to_string(), "event".into());

    Some(value.to_string())
}

struct Running {
    info: Info,
    /// Dropping it (or sending `true`) stops the listener and every phone connection.
    stop: watch::Sender<bool>,
    listener: EventId,
}

/// The phone server of the app: at most one runs at a time.
#[derive(Default)]
pub struct Remote {
    running: Mutex<Option<Running>>,
}

impl Remote {
    /// Starts the server, or returns the running one's info.
    pub fn start(&self, app: &AppHandle) -> Result<Info, String> {
        let mut running = self.running.lock().expect("remote lock poisoned");

        if let Some(current) = running.as_ref() {
            return Ok(current.info.clone());
        }

        let listener = StdTcpListener::bind("0.0.0.0:0")
            .map_err(|_| "Không mở được cổng kết nối.".to_string())?;

        listener
            .set_nonblocking(true)
            .map_err(|_| "Không mở được cổng kết nối.".to_string())?;

        let port = listener
            .local_addr()
            .map_err(|_| "Không mở được cổng kết nối.".to_string())?
            .port();
        let info = Info {
            host: local_host(),
            port,
            token: generate_token()?,
        };
        let (events, _) = broadcast::channel::<String>(256);
        let (stop, stopped) = watch::channel(false);
        let sender = events.clone();
        let listener_id = app.listen("agent-event", move |event| {
            if let Some(message) = event_message(event.payload()) {
                // * Nobody listening (no phone connected) is not an error.
                let _ = sender.send(message);
            }
        });

        tauri::async_runtime::spawn(serve(
            listener,
            app.clone(),
            info.token.clone(),
            events,
            stopped,
        ));

        *running = Some(Running {
            info: info.clone(),
            stop,
            listener: listener_id,
        });

        Ok(info)
    }

    /// Stops the server and drops every phone; the token is no longer valid.
    pub fn stop(&self, app: &AppHandle) {
        if let Some(current) = self.running.lock().expect("remote lock poisoned").take() {
            app.unlisten(current.listener);
            let _ = current.stop.send(true);
        }
    }
}

async fn serve(
    listener: StdTcpListener,
    app: AppHandle,
    token: String,
    events: broadcast::Sender<String>,
    mut stopped: watch::Receiver<bool>,
) {
    let Ok(listener) = TcpListener::from_std(listener) else {
        return;
    };
    let phones = Arc::new(AtomicUsize::new(0));

    loop {
        tokio::select! {
            _ = stopped.changed() => return,
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };

                if phones.load(Ordering::SeqCst) >= MAX_PHONES {
                    continue;
                }

                tauri::async_runtime::spawn(phone(
                    stream,
                    app.clone(),
                    token.clone(),
                    events.subscribe(),
                    stopped.clone(),
                    Arc::clone(&phones),
                ));
            }
        }
    }
}

/// One phone: proves it knows the token, then relays messages both ways until it leaves or the server stops.
async fn phone(
    stream: TcpStream,
    app: AppHandle,
    token: String,
    mut events: broadcast::Receiver<String>,
    mut stopped: watch::Receiver<bool>,
    phones: Arc<AtomicUsize>,
) {
    let Ok(Ok(mut socket)) =
        tokio::time::timeout(AUTH_TIMEOUT, tokio_tungstenite::accept_async(stream)).await
    else {
        return;
    };
    let first = tokio::time::timeout(AUTH_TIMEOUT, socket.next()).await;
    let signed_in = matches!(
        first,
        Ok(Some(Ok(Message::Text(ref text))))
            if matches!(parse_message(text.as_str()), Some(ClientMessage::Auth { token: ref given }) if tokens_match(given, &token))
    );

    if !signed_in
        || socket
            .send(Message::text(r#"{"type":"ready"}"#))
            .await
            .is_err()
    {
        let _ = socket.close(None).await;

        return;
    }

    let count = phones.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit("remote-connected", count);

    loop {
        tokio::select! {
            _ = stopped.changed() => break,
            incoming = socket.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if let Some(ClientMessage::Send { prompt }) = parse_message(text.as_str()) {
                        if !prompt.trim().is_empty() && prompt.chars().count() <= MAX_PROMPT_CHARS {
                            let _ = app.emit("remote-send", serde_json::json!({ "prompt": prompt }));
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            outgoing = events.recv() => match outgoing {
                Ok(message) => {
                    if socket.send(Message::text(message)).await.is_err() {
                        break;
                    }
                }
                // * Too slow to keep up: it skips the missed events and goes on.
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            },
        }
    }

    let _ = socket.close(None).await;
    let count = phones.fetch_sub(1, Ordering::SeqCst) - 1;
    let _ = app.emit("remote-disconnected", count);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_32_hex_characters_and_never_repeats() {
        let first = generate_token().unwrap();

        assert_eq!(first.len(), 32);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, generate_token().unwrap());
    }

    #[test]
    fn tokens_match_only_when_equal() {
        assert!(tokens_match("abc", "abc"));
        assert!(!tokens_match("abd", "abc"));
        assert!(!tokens_match("ab", "abc"));
        assert!(!tokens_match("abcd", "abc"));
        assert!(!tokens_match("", "abc"));
    }

    #[test]
    fn messages_of_the_phone_are_parsed() {
        assert_eq!(
            parse_message(r#"{"type":"auth","token":"t"}"#),
            Some(ClientMessage::Auth {
                token: "t".to_string()
            })
        );
        assert_eq!(
            parse_message(r#"{"type":"send","prompt":"hi"}"#),
            Some(ClientMessage::Send {
                prompt: "hi".to_string()
            })
        );
        assert_eq!(parse_message(r#"{"type":"other"}"#), None);
        assert_eq!(parse_message("not json"), None);
    }

    #[test]
    fn only_a_network_address_is_reachable() {
        assert!(reachable("192.168.1.20".parse().unwrap()));
        assert!(!reachable("127.0.0.1".parse().unwrap()));
        assert!(!reachable("0.0.0.0".parse().unwrap()));
        assert!(!reachable("::1".parse().unwrap()));
    }

    #[test]
    fn chat_events_get_the_event_type() {
        let message = event_message(r#"{"runId":"r","kind":"text","text":"x"}"#).unwrap();
        let value: serde_json::Value = serde_json::from_str(&message).unwrap();

        assert_eq!(value["type"], "event");
        assert_eq!(value["runId"], "r");
        assert_eq!(value["kind"], "text");
        assert_eq!(event_message("[1]"), None);
    }
}
