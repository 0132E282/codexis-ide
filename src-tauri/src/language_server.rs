//! Runs language servers (rust-analyzer, Intelephense, csharp-ls) as child processes that speak LSP over stdin/stdout, one per project folder and server.
//!
//! A [`LanguageServers`] handle owns the sessions. Each session has a supervisor thread that launches the process, performs the `initialize` handshake, waits for it to die and restarts it a limited number of times; a reader thread decodes what the server sends; a writer thread serialises what we send, so a server that stops reading can never block a caller or the reader. The text of every open document is mirrored here (positions are UTF-16, as the protocol counts them), so a restarted server gets the documents back.
//!
//! Safety rules kept in this module: only a [`LaunchPlan`] built by the catalog is run, never through a shell, always with the project folder as working directory; messages are limited to 16 MiB; every wait has a time limit; the server may not edit files (`workspace/applyEdit` is refused, a rename comes back as data and is applied only through [`apply_file_edits`] after the person confirmed); every URI in a result is turned back into a project-relative path.

mod connection;
mod edits;
mod request;

use crate::language_server_catalog::{self as catalog, joined_path, LaunchPlan};
use crate::language_server_convert as convert;
use crate::language_server_protocol::{
    apply_change, classify, file_uri, path_to_uri, uri_to_path, uri_to_relative, Incoming,
    MessageReader, Position, ProtocolError, METHOD_NOT_FOUND,
};
use crate::permission::Sandbox;
use crate::workspace::{self, Workspace, MAX_WRITE_BYTES};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use connection::Connection;
pub use edits::{apply_file_edits, ApplyReport, FailedEdit, FileEdit, TextEditInput};
pub use request::{ContentChange, RequestKind, RequestOptions};

/// Servers running at the same time, over all projects.
const MAX_SERVERS: usize = 8;

/// Open documents mirrored per server.
const MAX_DOCUMENTS: usize = 500;

/// Lines kept in the log of a server.
const LOG_LINES: usize = 500;

/// Longest log line kept, in characters.
const LOG_LINE_CHARS: usize = 2000;

/// Diagnostics sent to the front end for one file.
const MAX_DIAGNOSTICS: usize = 1000;

/// Places a go-to-definition answer can list.
const MAX_LOCATIONS: usize = 50;

/// Completion items passed on to the editor for one answer.
const MAX_COMPLETIONS: usize = 2000;

const MAX_NEW_NAME_CHARS: usize = 256;

const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Time a server that was asked to exit gets before it is killed.
const EXIT_GRACE: Duration = Duration::from_millis(500);

/// Time limits and counts; the defaults are the product's, tests use shorter ones.
#[derive(Debug, Clone)]
pub struct Limits {
    pub request: Duration,
    pub initialize: Duration,
    pub shutdown: Duration,
    pub restart_window: Duration,
    pub max_restarts: usize,
    pub restart_delay: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            request: Duration::from_secs(10),
            initialize: Duration::from_secs(60),
            shutdown: Duration::from_secs(3),
            restart_window: Duration::from_secs(3 * 60),
            max_restarts: 3,
            restart_delay: Duration::from_secs(1),
        }
    }
}

/// Why something failed. Only the fixed key reaches the front end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanguageServerError {
    /// The server is not running (yet, or any more).
    NotRunning,
    NotOpen,
    Unsupported,
    Timeout,
    Cancelled,
    RequestFailed,
    BadPath,
    NotFound,
    TooLarge,
    TooMany,
    OutOfSync,
    BadRequest,
    StartFailed,
    EncodingUnsupported,
    Crashed,
    ExtensionChanged,
    Protocol(ProtocolError),
}

impl LanguageServerError {
    /// Fixed user-facing text.
    pub fn key(self) -> &'static str {
        match self {
            Self::NotRunning => "language_server.not_running",
            Self::NotOpen => "language_server.not_open",
            Self::Unsupported => "language_server.unsupported",
            Self::Timeout => "language_server.timeout",
            Self::Cancelled => "language_server.cancelled",
            Self::RequestFailed => "language_server.request_failed",
            Self::BadPath => "workspace.bad_path",
            Self::NotFound => "workspace.not_found",
            Self::TooLarge => "language_server.too_large",
            Self::TooMany => "language_server.too_many",
            Self::OutOfSync => "language_server.out_of_sync",
            Self::BadRequest => "language_server.bad_request",
            Self::StartFailed => "language_server.start_failed",
            Self::EncodingUnsupported => "language_server.encoding_unsupported",
            Self::Crashed => "language_server.crashed",
            Self::ExtensionChanged => "language_server.extension_changed",
            Self::Protocol(_) => "language_server.bad_message",
        }
    }
}

impl std::fmt::Display for LanguageServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.key())
    }
}

impl std::error::Error for LanguageServerError {}

type Result<T> = std::result::Result<T, LanguageServerError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerState {
    /// No usable source for the server (decided by the caller from the catalog).
    Missing,
    Stopped,
    Starting,
    Running,
    Error,
}

/// The diagnostics of one file, sent to the front end as `language-server-diagnostics`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEvent {
    pub root: String,
    pub server_id: String,
    pub path: String,
    /// Version of the document the diagnostics are for, when the server said.
    pub version: Option<i64>,
    pub diagnostics: Vec<Value>,
}

/// A change of state, sent to the front end as `language-server-status`. `root` is `None` when the setting changed for every project.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub root: Option<String>,
    pub server_id: String,
    pub state: ServerState,
    /// Filled in by the event sink from the saved setting.
    pub enabled: bool,
    pub last_error: Option<&'static str>,
    pub features: Option<ServerFeatures>,
}

/// What the running server can do, for the editor to switch its providers on.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerFeatures {
    pub completion: bool,
    pub completion_resolve: bool,
    pub completion_trigger_characters: Vec<String>,
    pub hover: bool,
    pub signature_help: bool,
    pub signature_trigger_characters: Vec<String>,
    pub signature_retrigger_characters: Vec<String>,
    pub definition: bool,
    pub rename: bool,
    /// Always offered with rename: a server without `prepareProvider` is answered from the document text.
    pub prepare_rename: bool,
    pub formatting: bool,
}

impl ServerFeatures {
    pub fn from_capabilities(capabilities: &Value) -> Self {
        let provides = |name: &str| {
            capabilities
                .get(name)
                .is_some_and(|value| !matches!(value, Value::Null | Value::Bool(false)))
        };
        let characters = |pointer: &str| -> Vec<String> {
            capabilities
                .pointer(pointer)
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default()
        };

        Self {
            completion: provides("completionProvider"),
            completion_resolve: capabilities.pointer("/completionProvider/resolveProvider")
                == Some(&Value::Bool(true)),
            completion_trigger_characters: characters("/completionProvider/triggerCharacters"),
            hover: provides("hoverProvider"),
            signature_help: provides("signatureHelpProvider"),
            signature_trigger_characters: characters("/signatureHelpProvider/triggerCharacters"),
            signature_retrigger_characters: characters(
                "/signatureHelpProvider/retriggerCharacters",
            ),
            definition: provides("definitionProvider"),
            rename: provides("renameProvider"),
            prepare_rename: provides("renameProvider"),
            formatting: provides("documentFormattingProvider"),
        }
    }
}

/// Where events go: the app window in production, a recorder in tests.
pub trait EventSink: Send + Sync {
    fn diagnostics(&self, event: DiagnosticsEvent);
    fn status(&self, event: StatusEvent);
}

/// The two ends of a connection to a server, and the process behind it if there is one.
pub struct Transport {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    stderr: Option<Box<dyn Read + Send>>,
    child: Option<Child>,
}

/// Starts (and restarts) the process of a server.
pub trait Launcher: Send + Sync {
    fn launch(&self) -> io::Result<Transport>;
}

/// Runs a [`LaunchPlan`]: the program directly (no shell), the project folder as working directory.
struct ProcessLauncher {
    plan: LaunchPlan,
    root: PathBuf,
}

impl Launcher for ProcessLauncher {
    fn launch(&self) -> io::Result<Transport> {
        let mut command = Command::new(&self.plan.program);

        command
            .args(&self.plan.arguments)
            .current_dir(&self.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(path) = joined_path(&self.plan.extra_path) {
            command.env("PATH", path);
        }

        // * Its own process group, so what the server starts (cargo, proc-macro servers) can be stopped with it.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;

            command.process_group(0);
        }

        let mut child = command.spawn()?;
        let (stdin, stdout, stderr) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take());

        match (stdin, stdout, stderr) {
            (Some(stdin), Some(stdout), Some(stderr)) => Ok(Transport {
                reader: Box::new(stdout),
                writer: Box::new(stdin),
                stderr: Some(Box::new(stderr)),
                child: Some(child),
            }),
            _ => {
                let _ = child.kill();
                let _ = child.wait();

                Err(io::Error::other("pipes"))
            }
        }
    }
}

/// An open document as the server knows it.
struct Document {
    uri: String,
    language_id: String,
    text: String,
    version: i64,
    /// The items of the last completion answer, for `completion_resolve`; replaced by the next completion.
    last_completion: Vec<Value>,
    completion_generation: u64,
}

#[derive(Default)]
struct Shared {
    state: Option<ServerState>,
    last_error: Option<&'static str>,
    connection: Option<Arc<Connection>>,
    capabilities: Value,
    /// Whether the server wants changes as ranges (`textDocumentSync.change = 2`) rather than the whole text.
    incremental: bool,
    documents: HashMap<String, Document>,
    log: VecDeque<String>,
    deaths: VecDeque<Instant>,
}

impl Shared {
    fn state(&self) -> ServerState {
        self.state.unwrap_or(ServerState::Starting)
    }

    /// The connection, only while the handshake is done.
    fn running_connection(&self) -> Option<Arc<Connection>> {
        (self.state() == ServerState::Running)
            .then(|| self.connection.clone())
            .flatten()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Key {
    root: PathBuf,
    id: &'static str,
}

/// One server for one project: its sessions over time, its documents and its log.
struct Server {
    key: Key,
    sandbox: Sandbox,
    launcher: Arc<dyn Launcher>,
    initialization_options: Value,
    sink: Arc<dyn EventSink>,
    limits: Limits,
    stopping: AtomicBool,
    /// Held while a document notification is queued, so notifications reach the server in the order the mirror changed.
    order: Mutex<()>,
    shared: Mutex<Shared>,
    supervisor: Mutex<Option<JoinHandle<()>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Server {
    fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::SeqCst)
    }

    fn log(&self, line: impl AsRef<str>) {
        let line: String = line.as_ref().chars().take(LOG_LINE_CHARS).collect();
        let mut shared = lock(&self.shared);

        shared.log.push_back(line);

        while shared.log.len() > LOG_LINES {
            shared.log.pop_front();
        }
    }

    fn set_state(&self, state: ServerState, last_error: Option<&'static str>) {
        let features = {
            let mut shared = lock(&self.shared);

            shared.state = Some(state);
            shared.last_error = last_error;

            (state == ServerState::Running)
                .then(|| ServerFeatures::from_capabilities(&shared.capabilities))
        };

        self.sink.status(StatusEvent {
            root: Some(self.key.root.display().to_string()),
            server_id: self.key.id.to_string(),
            state,
            enabled: true,
            last_error,
            features,
        });
    }

    /// Empty diagnostics for every open document, so the editor drops its markers (the server is gone or the file closed).
    fn clear_diagnostics(&self) {
        let paths: Vec<String> = lock(&self.shared).documents.keys().cloned().collect();

        for path in paths {
            self.send_diagnostics(path, None, Vec::new());
        }
    }

    fn send_diagnostics(&self, path: String, version: Option<i64>, diagnostics: Vec<Value>) {
        self.sink.diagnostics(DiagnosticsEvent {
            root: self.key.root.display().to_string(),
            server_id: self.key.id.to_string(),
            path,
            version,
            diagnostics,
        });
    }

    fn initialize_params(&self) -> Value {
        let root = &self.key.root;
        let name = root
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
        let markup = json!(["markdown", "plaintext"]);

        json!({
            "processId": std::process::id(),
            "clientInfo": { "name": "Codexis IDE" },
            "rootUri": file_uri(root),
            "workspaceFolders": [{ "uri": file_uri(root), "name": name }],
            "initializationOptions": self.initialization_options,
            "capabilities": {
                "general": { "positionEncodings": ["utf-16"] },
                "window": { "workDoneProgress": true },
                "workspace": {
                    "configuration": true,
                    "workspaceFolders": true,
                    "applyEdit": false,
                    "workspaceEdit": { "documentChanges": true, "resourceOperations": [] },
                },
                "textDocument": {
                    "synchronization": { "dynamicRegistration": false, "didSave": true },
                    "publishDiagnostics": { "relatedInformation": false },
                    "completion": {
                        "contextSupport": true,
                        "completionItem": {
                            "snippetSupport": true,
                            "documentationFormat": markup,
                            "resolveSupport": {
                                "properties": ["documentation", "detail", "additionalTextEdits"],
                            },
                        },
                    },
                    "hover": { "contentFormat": markup },
                    "signatureHelp": {
                        "contextSupport": true,
                        "signatureInformation": {
                            "documentationFormat": markup,
                            "parameterInformation": { "labelOffsetSupport": true },
                        },
                    },
                    "definition": { "linkSupport": true },
                    "rename": { "prepareSupport": true },
                    "formatting": {},
                },
            },
        })
    }

    /// Starts the process, does the handshake and moves to `Running`, sending every mirrored document.
    fn connect(self: &Arc<Self>) -> Result<(Arc<Connection>, Receiver<()>)> {
        let transport = self.launcher.launch().map_err(|error| {
            self.log(format!("start failed: {error}"));

            // * The file was there when the sources were scanned: an extension update replaced it since.
            if error.kind() == io::ErrorKind::NotFound {
                LanguageServerError::ExtensionChanged
            } else {
                LanguageServerError::StartFailed
            }
        })?;
        let (connection, closed) = Connection::open(transport, self);

        // * Installed before the handshake so `stop` can end a server that is still starting; checked under the lock so a stop that came first is not missed.
        {
            let mut shared = lock(&self.shared);

            if self.is_stopping() {
                drop(shared);
                connection.kill();

                return Err(LanguageServerError::NotRunning);
            }

            shared.connection = Some(connection.clone());
        }

        let answer = match connection.request(
            "initialize",
            self.initialize_params(),
            self.limits.initialize,
        ) {
            Ok(answer) => answer,
            Err(error) => {
                connection.kill();

                return Err(match error {
                    LanguageServerError::Timeout => LanguageServerError::Timeout,
                    _ => LanguageServerError::StartFailed,
                });
            }
        };

        let Some(capabilities) = answer.get("capabilities").filter(|value| value.is_object())
        else {
            connection.kill();

            return Err(LanguageServerError::StartFailed);
        };

        // * Positions are UTF-16 here; a server that answers with another encoding would put markers in the wrong place.
        if capabilities
            .get("positionEncoding")
            .and_then(Value::as_str)
            .is_some_and(|encoding| encoding != "utf-16")
        {
            connection.kill();

            return Err(LanguageServerError::EncodingUnsupported);
        }

        connection.notify("initialized", json!({}));

        let _order = lock(&self.order);
        let mut shared = lock(&self.shared);

        if self.is_stopping() {
            drop(shared);
            connection.kill();

            return Err(LanguageServerError::NotRunning);
        }

        shared.incremental = incremental_sync(capabilities);
        shared.capabilities = capabilities.clone();

        for document in shared.documents.values() {
            connection.notify("textDocument/didOpen", did_open_params(document));
        }

        drop(shared);
        self.set_state(ServerState::Running, None);

        Ok((connection, closed))
    }

    /// Keeps the server alive until it is stopped: waits for it to die, restarts it within the limits, gives up with `Error` after that.
    fn supervise(self: &Arc<Self>) {
        loop {
            if self.is_stopping() {
                return;
            }

            self.set_state(ServerState::Starting, None);

            let (connection, closed) = match self.connect() {
                Ok(connected) => connected,
                Err(error) => {
                    if !self.is_stopping() {
                        self.set_state(ServerState::Error, Some(error.key()));
                    }

                    return;
                }
            };

            loop {
                match closed.recv_timeout(POLL_INTERVAL) {
                    Err(RecvTimeoutError::Timeout)
                        if !self.is_stopping() && !connection.child_exited() => {}
                    _ => break,
                }
            }

            // * `stop` ends the process itself, politely first; this thread must not cut its handshake short.
            if self.is_stopping() {
                return;
            }

            // * A process that is not already gone (a broken stream) is ended, helpers included.
            connection.kill();
            lock(&self.shared).connection = None;

            self.log("the server exited");
            self.clear_diagnostics();

            let Some(deaths) = self.record_death() else {
                let last = lock(&self.shared).last_error.take();

                self.set_state(
                    ServerState::Error,
                    Some(last.unwrap_or(LanguageServerError::Crashed.key())),
                );

                return;
            };

            // * Each death in the window waits a little longer: 1 s, 2 s, 3 s.
            self.wait_or_stop(self.limits.restart_delay * u32::try_from(deaths).unwrap_or(1));
        }
    }

    /// Sleeps for `duration`, or less when the server is stopped meanwhile (a stop must not wait for a restart delay).
    fn wait_or_stop(&self, duration: Duration) {
        let started = Instant::now();

        while !self.is_stopping() && started.elapsed() < duration {
            thread::sleep(Duration::from_millis(20).min(duration));
        }
    }

    /// Notes that the server died; the number of deaths in the window, or `None` when it died more often than the limit.
    fn record_death(&self) -> Option<usize> {
        let mut shared = lock(&self.shared);
        let now = Instant::now();

        shared.deaths.push_back(now);

        while shared
            .deaths
            .front()
            .is_some_and(|death| now.duration_since(*death) > self.limits.restart_window)
        {
            shared.deaths.pop_front();
        }

        (shared.deaths.len() <= self.limits.max_restarts).then_some(shared.deaths.len())
    }

    fn read_loop(&self, connection: &Arc<Connection>, reader: Box<dyn Read + Send>) {
        let mut reader = MessageReader::new(reader);

        loop {
            match reader.next_message() {
                Ok(Some(message)) => {
                    if let Some(incoming) = classify(message) {
                        self.handle(connection, incoming);
                    }
                }
                Ok(None) => return,
                Err(error) => {
                    self.log(format!("protocol error: {}", error.key()));

                    if !connection.is_closed() {
                        lock(&self.shared).last_error = Some(error.key());
                    }

                    return;
                }
            }
        }
    }

    /// Copies what the server writes on stderr into the log, line by line, without ever holding more than a few KiB.
    fn pump_stderr(&self, mut stderr: Box<dyn Read + Send>) {
        let mut chunk = [0u8; 4096];
        let mut line: Vec<u8> = Vec::new();

        while let Ok(read) = stderr.read(&mut chunk) {
            if read == 0 {
                break;
            }

            for byte in &chunk[..read] {
                if *byte == b'\n' || line.len() >= LOG_LINE_CHARS {
                    self.flush_stderr_line(&mut line);
                }

                if *byte != b'\n' {
                    line.push(*byte);
                }
            }
        }

        self.flush_stderr_line(&mut line);
    }

    fn flush_stderr_line(&self, line: &mut Vec<u8>) {
        if !line.is_empty() {
            self.log(format!(
                "stderr: {}",
                String::from_utf8_lossy(line).trim_end()
            ));
            line.clear();
        }
    }

    fn handle(&self, connection: &Arc<Connection>, incoming: Incoming) {
        match incoming {
            Incoming::Response { id, result } => connection.resolve(id, result),
            Incoming::Request { id, method, params } => match self.answer(&method, &params) {
                Some(result) => connection.respond(&id, result),
                None => {
                    self.log(format!("request refused: {method}"));
                    connection.respond_error(&id, METHOD_NOT_FOUND, "method not found");
                }
            },
            Incoming::Notification { method, params } => self.notification(&method, &params),
        }
    }

    /// The answer to a request the server makes of us, `None` for one we do not support. The server never edits files: `workspace/applyEdit` is declined.
    fn answer(&self, method: &str, params: &Value) -> Option<Value> {
        match method {
            "workspace/configuration" => {
                let count = params
                    .get("items")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len);

                Some(Value::Array(vec![Value::Null; count]))
            }
            "client/registerCapability"
            | "client/unregisterCapability"
            | "window/workDoneProgress/create"
            | "window/showMessageRequest"
            | "window/showDocument" => Some(Value::Null),
            // * "The data changed, ask again": nothing here caches it.
            refresh if refresh.starts_with("workspace/") && refresh.ends_with("/refresh") => {
                Some(Value::Null)
            }
            "workspace/workspaceFolders" => Some(json!([{
                "uri": file_uri(&self.key.root),
                "name": self.key.root.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
            }])),
            "workspace/applyEdit" => Some(json!({
                "applied": false,
                "failureReason": "The editor applies edits itself, after the person confirmed.",
            })),
            _ => None,
        }
    }

    fn notification(&self, method: &str, params: &Value) {
        match method {
            "textDocument/publishDiagnostics" => self.publish_diagnostics(params),
            "window/logMessage" | "window/showMessage" => {
                if let Some(message) = params.get("message").and_then(Value::as_str) {
                    self.log(message);
                }
            }
            _ => {}
        }
    }

    fn publish_diagnostics(&self, params: &Value) {
        let Some(path) = params
            .get("uri")
            .and_then(Value::as_str)
            .and_then(|uri| uri_to_relative(&self.sandbox, uri))
        else {
            return;
        };
        let diagnostics = params
            .get("diagnostics")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .take(MAX_DIAGNOSTICS)
                    .filter_map(diagnostic)
                    .collect()
            })
            .unwrap_or_default();

        self.send_diagnostics(
            path,
            params.get("version").and_then(Value::as_i64),
            diagnostics,
        );
    }

    /// Ends the server for good: shutdown handshake, kill after the time limit, supervisor stopped.
    fn stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);

        let connection = lock(&self.shared).connection.take();

        if let Some(connection) = connection {
            connection.shutdown(self.limits.shutdown);
        }

        if let Some(handle) = lock(&self.supervisor).take() {
            let _ = handle.join();
        }

        self.clear_diagnostics();
        self.set_state(ServerState::Stopped, None);
    }

    fn open_document(&self, relative: &str, language_id: &str, text: String) -> Result<i64> {
        if text.len() > MAX_WRITE_BYTES {
            return Err(LanguageServerError::TooLarge);
        }

        let uri = path_to_uri(&self.sandbox, relative).ok_or(LanguageServerError::BadPath)?;
        let _order = lock(&self.order);
        let mut shared = lock(&self.shared);

        if !shared.documents.contains_key(relative) && shared.documents.len() >= MAX_DOCUMENTS {
            return Err(LanguageServerError::TooMany);
        }

        let (version, message) = match shared.documents.get_mut(relative) {
            Some(document) => {
                document.text = text;
                document.version += 1;

                (
                    document.version,
                    (
                        "textDocument/didChange",
                        did_change_params(document, vec![json!({ "text": document.text })]),
                    ),
                )
            }
            None => {
                let document = Document {
                    uri,
                    language_id: language_id.to_string(),
                    text,
                    version: 1,
                    last_completion: Vec::new(),
                    completion_generation: 0,
                };
                let message = ("textDocument/didOpen", did_open_params(&document));

                shared.documents.insert(relative.to_string(), document);

                (1, message)
            }
        };

        if let Some(connection) = shared.running_connection() {
            connection.notify(message.0, message.1);
        }

        Ok(version)
    }

    fn change_document(&self, relative: &str, changes: &[ContentChange]) -> Result<i64> {
        let _order = lock(&self.order);
        let mut shared = lock(&self.shared);
        let incremental = shared.incremental;
        let document = shared
            .documents
            .get_mut(relative)
            .ok_or(LanguageServerError::NotOpen)?;
        let mut text = document.text.clone();

        for change in changes {
            if !apply_change(&mut text, change.range.as_ref(), &change.text) {
                return Err(LanguageServerError::OutOfSync);
            }
        }

        if text.len() > MAX_WRITE_BYTES {
            return Err(LanguageServerError::TooLarge);
        }

        document.text = text;
        document.version += 1;

        let events = if incremental {
            changes
                .iter()
                .map(|change| serde_json::to_value(change).unwrap_or(Value::Null))
                .collect()
        } else {
            vec![json!({ "text": document.text })]
        };
        let params = did_change_params(document, events);
        let version = document.version;

        if let Some(connection) = shared.running_connection() {
            connection.notify("textDocument/didChange", params);
        }

        Ok(version)
    }

    fn save_document(&self, relative: &str, text: Option<String>) -> Result<i64> {
        let _order = lock(&self.order);
        let mut shared = lock(&self.shared);
        let document = shared
            .documents
            .get_mut(relative)
            .ok_or(LanguageServerError::NotOpen)?;
        let mut messages = Vec::new();

        // * The saved text can differ from the editor's (the formatter ran); the server is told before it hears of the save.
        if let Some(text) = text.filter(|text| *text != document.text) {
            if text.len() > MAX_WRITE_BYTES {
                return Err(LanguageServerError::TooLarge);
            }

            document.text = text;
            document.version += 1;
            messages.push((
                "textDocument/didChange",
                did_change_params(document, vec![json!({ "text": document.text })]),
            ));
        }

        messages.push((
            "textDocument/didSave",
            json!({ "textDocument": { "uri": document.uri } }),
        ));

        let version = document.version;

        if let Some(connection) = shared.running_connection() {
            for (method, params) in messages {
                connection.notify(method, params);
            }
        }

        Ok(version)
    }

    fn close_document(&self, relative: &str) {
        let _order = lock(&self.order);
        let mut shared = lock(&self.shared);

        if let Some(document) = shared.documents.remove(relative) {
            if let Some(connection) = shared.running_connection() {
                connection.notify(
                    "textDocument/didClose",
                    json!({ "textDocument": { "uri": document.uri } }),
                );
            }

            drop(shared);
            self.send_diagnostics(relative.to_string(), None, Vec::new());
        }
    }

    fn request(
        &self,
        relative: &str,
        kind: RequestKind,
        position: Option<Position>,
        options: &RequestOptions,
    ) -> Result<Value> {
        let (connection, uri, without_prepare, text, resolving) = {
            let shared = lock(&self.shared);
            let connection = shared
                .running_connection()
                .ok_or(LanguageServerError::NotRunning)?;
            let document = shared
                .documents
                .get(relative)
                .ok_or(LanguageServerError::NotOpen)?;

            if !kind.is_supported(&shared.capabilities) {
                return Err(LanguageServerError::Unsupported);
            }

            let resolving = match kind {
                RequestKind::CompletionResolve => Some(document.completion_item(options)?),
                _ => None,
            };
            let text = (kind == RequestKind::PrepareRename).then(|| document.text.clone());
            // * A server without `prepareProvider` cannot be asked; the word under the cursor is the answer.
            let without_prepare = kind == RequestKind::PrepareRename
                && shared
                    .capabilities
                    .pointer("/renameProvider/prepareProvider")
                    != Some(&Value::Bool(true));

            (
                connection,
                document.uri.clone(),
                without_prepare,
                text,
                resolving,
            )
        };

        if without_prepare {
            let position = position.ok_or(LanguageServerError::BadRequest)?;

            return Ok(convert::prepare_rename(
                &json!({ "defaultBehavior": true }),
                text.as_deref().unwrap_or_default(),
                position,
            ));
        }

        let (method, params) = kind.build(&uri, position, options, resolving)?;
        // * A newer completion, hover or signature request replaces the one still waiting.
        let key = matches!(
            kind,
            RequestKind::Completion | RequestKind::Hover | RequestKind::SignatureHelp
        )
        .then(|| format!("{relative}|{method}"));
        let result = connection
            .request_keyed(method, params, self.limits.request, key.as_deref())
            .inspect_err(|error| self.log(format!("{method} failed: {}", error.key())))?;

        match kind {
            RequestKind::Completion => Ok(self.completion_answer(relative, result)),
            RequestKind::CompletionResolve => {
                convert::completion_item(&result, options.resolve_key.clone())
                    .ok_or(LanguageServerError::RequestFailed)
            }
            RequestKind::Hover => Ok(convert::hover(&result)),
            RequestKind::SignatureHelp => Ok(convert::signature_help(&result)),
            RequestKind::Definition => Ok(self.definition_targets(&result)),
            RequestKind::PrepareRename => Ok(convert::prepare_rename(
                &result,
                text.as_deref().unwrap_or_default(),
                position.ok_or(LanguageServerError::BadRequest)?,
            )),
            RequestKind::Rename => self.rename_plan(&result),
            RequestKind::Formatting => Ok(convert::text_edits(&result)),
        }
    }

    /// The completion answer for the editor; the original items are kept on the document under a new generation so one can be resolved later.
    fn completion_answer(&self, relative: &str, result: Value) -> Value {
        let generation = lock(&self.shared)
            .documents
            .get(relative)
            .map_or(0, |document| document.completion_generation + 1);
        let (answer, originals) = convert::completion(result, MAX_COMPLETIONS, generation);

        if let Some(document) = lock(&self.shared).documents.get_mut(relative) {
            document.completion_generation = generation;
            document.last_completion = originals;
        }

        answer
    }

    /// `[{ path, external, range }]` from the shapes `textDocument/definition` can answer with. A place outside the project has no `path`, only a display path for the person.
    fn definition_targets(&self, result: &Value) -> Value {
        let items: Vec<&Value> = match result {
            Value::Array(items) => items.iter().collect(),
            Value::Object(_) => vec![result],
            _ => Vec::new(),
        };
        let targets: Vec<Value> = items
            .into_iter()
            .take(MAX_LOCATIONS)
            .filter_map(|item| {
                let uri = item
                    .get("targetUri")
                    .or_else(|| item.get("uri"))
                    .and_then(Value::as_str)?;
                let range = convert::editor_range(
                    item.get("targetSelectionRange")
                        .or_else(|| item.get("range"))?,
                )?;
                let path = uri_to_relative(&self.sandbox, uri);
                let external = match path {
                    Some(_) => None,
                    None => Some(display_path(&uri_to_path(uri)?)),
                };

                Some(json!({ "path": path, "external": external, "range": range }))
            })
            .collect();

        Value::Array(targets)
    }

    /// The edits of a rename grouped by project file: `{ files: [{ path, edits, expectedHash, editCount }], skipped: [{ display, reason }] }`. A file outside the project, closed to the AI (`.env`, `vendor/`, ...) or not readable as text is listed in `skipped` and never written. Creating, renaming and deleting files is not supported. `expectedHash` is the hash of the file on disk, to be sent back with the edits.
    fn rename_plan(&self, result: &Value) -> Result<Value> {
        // * Files in the order the server first named them; `position_of` finds one in O(1) instead of scanning the list.
        let mut by_uri: Vec<(String, Vec<Value>)> = Vec::new();
        let mut position_of: HashMap<String, usize> = HashMap::new();
        let mut add = |uri: &str, edits: &[Value]| {
            let edits = edits.iter().filter_map(convert::text_edit);

            match position_of.get(uri) {
                Some(&index) => by_uri[index].1.extend(edits),
                None => {
                    position_of.insert(uri.to_string(), by_uri.len());
                    by_uri.push((uri.to_string(), edits.collect()));
                }
            }
        };

        // * `documentChanges` wins over `changes` when the server sends both.
        match result.get("documentChanges").and_then(Value::as_array) {
            Some(changes) => {
                for change in changes {
                    match (
                        change.pointer("/textDocument/uri").and_then(Value::as_str),
                        change.get("edits").and_then(Value::as_array),
                    ) {
                        (Some(uri), Some(edits)) => add(uri, edits),
                        _ => return Err(LanguageServerError::Unsupported),
                    }
                }
            }
            None => {
                if let Some(changes) = result.get("changes").and_then(Value::as_object) {
                    for (uri, edits) in changes {
                        add(uri, edits.as_array().map(Vec::as_slice).unwrap_or_default());
                    }
                }
            }
        }

        let workspace = Workspace::open(&self.key.root).ok();
        let mut files = Vec::new();
        let mut skipped = Vec::new();

        for (uri, edits) in by_uri {
            let Some(path) = uri_to_relative(&self.sandbox, &uri) else {
                skipped.push(json!({
                    "display": uri_to_path(&uri).map_or(uri, |path| display_path(&path)),
                    "reason": LanguageServerError::BadPath.key(),
                }));

                continue;
            };
            let read = match workspace.as_ref() {
                Some(workspace) => workspace
                    .read(&path)
                    .map_err(workspace::WorkspaceError::message),
                None => Err(workspace::WorkspaceError::UnknownRoot.message()),
            };

            match read {
                Ok(content) => files.push(json!({
                    "path": path,
                    "editCount": edits.len(),
                    "edits": edits,
                    "expectedHash": workspace::hash(&content),
                })),
                Err(reason) => skipped.push(json!({ "display": path, "reason": reason })),
            }
        }

        Ok(json!({ "files": files, "skipped": skipped }))
    }
}

impl Document {
    /// The original completion item `options.resolve_key` (`"<generation>:<index>"`) names; the key is stale after the next completion.
    fn completion_item(&self, options: &RequestOptions) -> Result<Value> {
        let (generation, index) = options
            .resolve_key
            .as_deref()
            .and_then(|key| key.split_once(':'))
            .and_then(|(generation, index)| {
                Some((
                    generation.parse::<u64>().ok()?,
                    index.parse::<usize>().ok()?,
                ))
            })
            .ok_or(LanguageServerError::BadRequest)?;

        if generation != self.completion_generation {
            return Err(LanguageServerError::Cancelled);
        }

        self.last_completion
            .get(index)
            .cloned()
            .ok_or(LanguageServerError::BadRequest)
    }
}

/// A file path for the person to read: the home folder is shown as `~`.
fn display_path(path: &Path) -> String {
    let home = std::env::var_os("HOME").map(PathBuf::from);

    match home
        .as_deref()
        .and_then(|home| path.strip_prefix(home).ok())
    {
        Some(rest)
            if !home
                .as_deref()
                .is_some_and(|home| home.as_os_str().is_empty()) =>
        {
            Path::new("~").join(rest).display().to_string()
        }
        _ => path.display().to_string(),
    }
}

/// One diagnostic in editor form; one without a usable range or message is dropped. Related locations carry file URIs of this machine and are not passed on.
fn diagnostic(diagnostic: &Value) -> Option<Value> {
    let code = diagnostic.get("code").and_then(|code| match code {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    });

    Some(json!({
        "range": convert::editor_range(diagnostic.get("range")?)?,
        "severity": diagnostic
            .get("severity")
            .and_then(Value::as_u64)
            .filter(|severity| (1..=4).contains(severity))
            .unwrap_or(1),
        "message": diagnostic.get("message")?.as_str()?,
        "source": diagnostic.get("source").and_then(Value::as_str),
        "code": code,
    }))
}

/// Whether the server wants range changes: `textDocumentSync` is `2` or an object with `change: 2`.
fn incremental_sync(capabilities: &Value) -> bool {
    let sync = capabilities.get("textDocumentSync");

    sync.and_then(Value::as_u64) == Some(2)
        || sync
            .and_then(|sync| sync.get("change"))
            .and_then(Value::as_u64)
            == Some(2)
}

fn did_open_params(document: &Document) -> Value {
    json!({ "textDocument": {
        "uri": document.uri,
        "languageId": document.language_id,
        "version": document.version,
        "text": document.text,
    } })
}

fn did_change_params(document: &Document, changes: Vec<Value>) -> Value {
    json!({
        "textDocument": { "uri": document.uri, "version": document.version },
        "contentChanges": changes,
    })
}

/// The sessions of every project, as one cheap-to-clone handle.
#[derive(Clone)]
pub struct LanguageServers {
    inner: Arc<Inner>,
}

struct Inner {
    servers: Mutex<HashMap<Key, Arc<Server>>>,
    sink: Arc<dyn EventSink>,
    limits: Limits,
}

impl LanguageServers {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self::with_limits(sink, Limits::default())
    }

    pub fn with_limits(sink: Arc<dyn EventSink>, limits: Limits) -> Self {
        Self {
            inner: Arc::new(Inner {
                servers: Mutex::new(HashMap::new()),
                sink,
                limits,
            }),
        }
    }

    /// Starts the server `id` for the project at `root` from a plan the catalog built, unless it is already there (any state). The handshake runs on its own thread: this returns at once and the state is `Starting`.
    ///
    /// # Errors
    /// Fails for an unknown server, a root that is not a folder, or when 8 servers already run.
    pub fn start(&self, root: &Path, id: &str, plan: LaunchPlan) -> Result<()> {
        self.start_with_documents(root, id, plan, HashMap::new())
    }

    fn start_with_documents(
        &self,
        root: &Path,
        id: &str,
        plan: LaunchPlan,
        documents: HashMap<String, Document>,
    ) -> Result<()> {
        let spec = catalog::spec(id).ok_or(LanguageServerError::BadRequest)?;
        let sandbox = Sandbox::open(root).ok_or(LanguageServerError::BadPath)?;
        let options = plan.initialization_options.clone();
        let launcher = Arc::new(ProcessLauncher {
            plan,
            root: sandbox.root().to_path_buf(),
        });

        self.start_with(sandbox, spec.id, launcher, options, documents)
            .map(|_| ())
    }

    fn start_with(
        &self,
        sandbox: Sandbox,
        id: &'static str,
        launcher: Arc<dyn Launcher>,
        initialization_options: Value,
        documents: HashMap<String, Document>,
    ) -> Result<Arc<Server>> {
        let key = Key {
            root: sandbox.root().to_path_buf(),
            id,
        };
        let mut servers = lock(&self.inner.servers);
        let mut documents = documents;

        if let Some(existing) = servers.get(&key) {
            if !existing.is_stopping() {
                return Ok(existing.clone());
            }

            // * A slot the person stopped starts again with the documents it kept.
            documents.extend(std::mem::take(&mut lock(&existing.shared).documents));
            servers.remove(&key);
        }

        let active = servers
            .values()
            .filter(|server| {
                !server.is_stopping()
                    && matches!(
                        lock(&server.shared).state(),
                        ServerState::Starting | ServerState::Running
                    )
            })
            .count();

        if active >= MAX_SERVERS {
            return Err(LanguageServerError::TooMany);
        }

        let server = Arc::new(Server {
            key: key.clone(),
            sandbox,
            launcher,
            initialization_options,
            sink: self.inner.sink.clone(),
            limits: self.inner.limits.clone(),
            stopping: AtomicBool::new(false),
            order: Mutex::new(()),
            shared: Mutex::new(Shared {
                state: Some(ServerState::Starting),
                documents,
                ..Shared::default()
            }),
            supervisor: Mutex::new(None),
        });
        let running = server.clone();

        // * The supervisor handle is stored under the map lock, before anyone can call `stop` on this server.
        *lock(&server.supervisor) = Some(thread::spawn(move || running.supervise()));
        servers.insert(key, server.clone());

        Ok(server)
    }

    fn find(&self, root: &Path, id: &str) -> Option<Arc<Server>> {
        lock(&self.inner.servers)
            .iter()
            .find(|(key, _)| key.root == root && key.id == id)
            .map(|(_, server)| server.clone())
    }

    /// The state of the server and the key of its last error; `Stopped` when there is no session.
    pub fn status(&self, root: &Path, id: &str) -> (ServerState, Option<&'static str>) {
        self.find(root, id)
            .map_or((ServerState::Stopped, None), |server| {
                let shared = lock(&server.shared);

                (shared.state(), shared.last_error)
            })
    }

    /// Whether the server of this project has a session in any state.
    pub fn has_session(&self, root: &Path, id: &str) -> bool {
        self.find(root, id).is_some()
    }

    /// The last 500 log lines (the server's stderr, its log messages and our notes).
    pub fn log(&self, root: &Path, id: &str) -> Vec<String> {
        self.find(root, id)
            .map(|server| lock(&server.shared).log.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Opens a document (or replaces the text of an open one) and returns its version.
    ///
    /// # Errors
    /// Fails when there is no session, the path is not a file of the project, or the text is over the size limit.
    pub fn open_document(
        &self,
        root: &Path,
        id: &str,
        relative: &str,
        language_id: &str,
        text: String,
    ) -> Result<i64> {
        self.session(root, id)?
            .open_document(relative, language_id, text)
    }

    /// Applies change events to the mirror and forwards them; returns the new version.
    ///
    /// # Errors
    /// Fails when the document is not open or a range does not fit the text (the front end must open the document again).
    pub fn change_document(
        &self,
        root: &Path,
        id: &str,
        relative: &str,
        changes: &[ContentChange],
    ) -> Result<i64> {
        self.session(root, id)?.change_document(relative, changes)
    }

    /// Tells the server the document was saved, after sending the saved text first when it differs from the mirror.
    ///
    /// # Errors
    /// Fails when the document is not open.
    pub fn save_document(
        &self,
        root: &Path,
        id: &str,
        relative: &str,
        text: Option<String>,
    ) -> Result<i64> {
        self.session(root, id)?.save_document(relative, text)
    }

    pub fn close_document(&self, root: &Path, id: &str, relative: &str) {
        if let Some(server) = self.find(root, id) {
            server.close_document(relative);
        }
    }

    /// Asks the server about an open document.
    ///
    /// # Errors
    /// Fails when the server is not running, the document is not open, the server cannot do it, or it does not answer in time.
    pub fn request(
        &self,
        root: &Path,
        id: &str,
        relative: &str,
        kind: RequestKind,
        position: Option<Position>,
        options: &RequestOptions,
    ) -> Result<Value> {
        self.session(root, id)?
            .request(relative, kind, position, options)
    }

    fn session(&self, root: &Path, id: &str) -> Result<Arc<Server>> {
        self.find(root, id).ok_or(LanguageServerError::NotRunning)
    }

    /// Stops the session and starts it again from `plan`, with the open documents.
    ///
    /// # Errors
    /// Fails like [`LanguageServers::start`].
    pub fn restart(&self, root: &Path, id: &str, plan: LaunchPlan) -> Result<()> {
        let documents = self.stop_taking_documents(root, id);

        self.start_with_documents(root, id, plan, documents)
    }

    fn stop_taking_documents(&self, root: &Path, id: &str) -> HashMap<String, Document> {
        let Some(server) = self.remove(root, id) else {
            return HashMap::new();
        };

        server.stop();

        let documents = std::mem::take(&mut lock(&server.shared).documents);

        documents
    }

    fn remove(&self, root: &Path, id: &str) -> Option<Arc<Server>> {
        let mut servers = lock(&self.inner.servers);
        let key = servers
            .keys()
            .find(|key| key.root == root && key.id == id)
            .cloned()?;

        servers.remove(&key)
    }

    /// Stops one server of one project (shutdown, then kill after the limit). The slot stays, `Stopped`, with its open documents, so they are sent again by a restart; `is_stopped` tells a later open not to start it.
    pub fn stop(&self, root: &Path, id: &str) {
        if let Some(server) = self.find(root, id) {
            server.stop();
        }
    }

    /// The projects that have a slot for server `id`, and whether the slot holds open documents.
    pub fn slots_of(&self, id: &str) -> Vec<(PathBuf, bool)> {
        lock(&self.inner.servers)
            .iter()
            .filter(|(key, _)| key.id == id)
            .map(|(key, server)| (key.root.clone(), !lock(&server.shared).documents.is_empty()))
            .collect()
    }

    /// Stops the server and drops the slot with its documents.
    pub fn forget(&self, root: &Path, id: &str) {
        if let Some(server) = self.remove(root, id) {
            server.stop();
        }
    }

    /// Whether the person stopped this server and has not restarted it.
    pub fn is_stopped(&self, root: &Path, id: &str) -> bool {
        self.find(root, id)
            .is_some_and(|server| server.is_stopping())
    }

    /// Waits while the server starts; returns its state and last error then (at most `timeout`).
    pub fn wait_started(
        &self,
        root: &Path,
        id: &str,
        timeout: Duration,
    ) -> (ServerState, Option<&'static str>) {
        let started = Instant::now();

        loop {
            let status = self.status(root, id);

            if status.0 != ServerState::Starting || started.elapsed() >= timeout {
                return status;
            }

            thread::sleep(Duration::from_millis(20));
        }
    }

    /// The features of a running server, `None` otherwise.
    pub fn features(&self, root: &Path, id: &str) -> Option<ServerFeatures> {
        let server = self.find(root, id)?;
        let shared = lock(&server.shared);

        (shared.state() == ServerState::Running)
            .then(|| ServerFeatures::from_capabilities(&shared.capabilities))
    }

    /// Stops every server of the project at `root`.
    pub fn stop_root(&self, root: &Path) {
        self.stop_where(|key| key.root == root);
    }

    /// Stops the server `id` in every project (it was switched off or its source changed).
    pub fn stop_id(&self, id: &str) {
        self.stop_where(|key| key.id == id);
    }

    /// Stops everything, all servers at the same time: the app is closing.
    pub fn stop_all(&self) {
        self.stop_where(|_| true);
    }

    fn stop_where(&self, matches: impl Fn(&Key) -> bool) {
        let stopped: Vec<Arc<Server>> = {
            let mut servers = lock(&self.inner.servers);
            let keys: Vec<Key> = servers.keys().filter(|key| matches(key)).cloned().collect();

            keys.iter().filter_map(|key| servers.remove(key)).collect()
        };

        thread::scope(|scope| {
            for server in &stopped {
                scope.spawn(|| server.stop());
            }
        });
    }
}

#[cfg(test)]
#[path = "../tests/unit/language_server.rs"]
mod tests;
