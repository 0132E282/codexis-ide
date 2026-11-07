use super::*;
use crate::language_server_protocol::file_uri;
use std::fs;
use std::sync::atomic::AtomicUsize;
use tempfile::TempDir;

const DEADLINE: Duration = Duration::from_secs(10);

// ---- in-memory pipes -------------------------------------------------------

struct PipeReader {
    receiver: Receiver<Vec<u8>>,
    pending: Vec<u8>,
    at: usize,
}

impl Read for PipeReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.at >= self.pending.len() {
            match self.receiver.recv() {
                Ok(chunk) => {
                    self.pending = chunk;
                    self.at = 0;
                }
                Err(_) => return Ok(0),
            }
        }

        let count = buffer.len().min(self.pending.len() - self.at);

        buffer[..count].copy_from_slice(&self.pending[self.at..self.at + count]);
        self.at += count;

        Ok(count)
    }
}

struct PipeWriter(Sender<Vec<u8>>);

impl Write for PipeWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.0
            .send(buffer.to_vec())
            .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;

        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn pipe() -> (PipeWriter, PipeReader) {
    let (sender, receiver) = mpsc::channel();

    (
        PipeWriter(sender),
        PipeReader {
            receiver,
            pending: Vec::new(),
            at: 0,
        },
    )
}

// ---- a scripted server -----------------------------------------------------

/// The server's side of the connection.
struct Ends {
    incoming: MessageReader<PipeReader>,
    outgoing: PipeWriter,
    stderr: PipeWriter,
}

impl Ends {
    fn receive(&mut self) -> Option<Value> {
        self.incoming.next_message().ok().flatten()
    }

    fn send(&mut self, message: &Value) {
        let _ = write_message(&mut self.outgoing, message);
    }

    fn reply(&mut self, id: &Value, result: Value) {
        self.send(&response_message(id, result));
    }
}

type Received = Arc<Mutex<Vec<Value>>>;

type Behaviour = Arc<dyn Fn(usize, Ends, Received) + Send + Sync>;

/// Launches scripted servers over in-memory pipes and records everything the client sent.
struct FakeLauncher {
    behaviour: Behaviour,
    launches: AtomicUsize,
    received: Received,
}

impl FakeLauncher {
    fn new(behaviour: impl Fn(usize, Ends, Received) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            behaviour: Arc::new(behaviour),
            launches: AtomicUsize::new(0),
            received: Arc::new(Mutex::new(Vec::new())),
        })
    }

    /// A server that completes the handshake and answers requests with `answer` (`None` = no answer).
    fn serving(
        capabilities: Value,
        answer: impl Fn(&str, &Value) -> Option<Value> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Self::new(move |_, mut ends, received| {
            serve(&mut ends, &received, &capabilities, &answer, |_| {});
        })
    }

    fn launches(&self) -> usize {
        self.launches.load(Ordering::SeqCst)
    }

    fn messages(&self) -> Vec<Value> {
        self.received.lock().unwrap().clone()
    }

    fn methods(&self) -> Vec<String> {
        self.messages()
            .iter()
            .filter_map(|message| message.get("method")?.as_str().map(str::to_string))
            .collect()
    }

    fn first(&self, method: &str) -> Option<Value> {
        self.messages()
            .into_iter()
            .find(|message| message.get("method").and_then(Value::as_str) == Some(method))
    }

    fn all(&self, method: &str) -> Vec<Value> {
        self.messages()
            .into_iter()
            .filter(|message| message.get("method").and_then(Value::as_str) == Some(method))
            .collect()
    }
}

impl Launcher for FakeLauncher {
    fn launch(&self) -> io::Result<Transport> {
        let launch = self.launches.fetch_add(1, Ordering::SeqCst);
        let (client_writer, server_reader) = pipe();
        let (server_writer, client_reader) = pipe();
        let (stderr_writer, stderr_reader) = pipe();
        let ends = Ends {
            incoming: MessageReader::new(server_reader),
            outgoing: server_writer,
            stderr: stderr_writer,
        };
        let behaviour = self.behaviour.clone();
        let received = self.received.clone();

        thread::spawn(move || behaviour(launch, ends, received));

        Ok(Transport {
            reader: Box::new(client_reader),
            writer: Box::new(client_writer),
            stderr: Some(Box::new(stderr_reader)),
            child: None,
        })
    }
}

fn record(received: &Received, message: &Value) {
    received.lock().unwrap().push(message.clone());
}

/// Handshake, then `after_initialized`, then answers requests until `exit` or the end of the stream. `shutdown` is answered with `null`.
fn serve(
    ends: &mut Ends,
    received: &Received,
    capabilities: &Value,
    answer: &dyn Fn(&str, &Value) -> Option<Value>,
    after_initialized: impl FnOnce(&mut Ends),
) {
    let mut after_initialized = Some(after_initialized);

    while let Some(message) = ends.receive() {
        record(received, &message);

        match classify(&message) {
            Some(Incoming::Request { id, method, params }) => match method.as_str() {
                "initialize" => ends.reply(&id, json!({ "capabilities": capabilities })),
                "shutdown" => ends.reply(&id, Value::Null),
                _ => {
                    if let Some(result) = answer(&method, &params) {
                        ends.reply(&id, result);
                    }
                }
            },
            Some(Incoming::Notification { method, .. }) => match method.as_str() {
                "initialized" => {
                    if let Some(action) = after_initialized.take() {
                        action(ends);
                    }
                }
                "exit" => return,
                _ => {}
            },
            _ => {}
        }
    }
}

fn silent(_: &str, _: &Value) -> Option<Value> {
    None
}

// ---- recording sink and fixtures --------------------------------------------

#[derive(Default)]
struct RecordingSink {
    diagnostics: Mutex<Vec<DiagnosticsEvent>>,
    statuses: Mutex<Vec<StatusEvent>>,
}

impl EventSink for RecordingSink {
    fn diagnostics(&self, event: DiagnosticsEvent) {
        self.diagnostics.lock().unwrap().push(event);
    }

    fn status(&self, event: StatusEvent) {
        self.statuses.lock().unwrap().push(event);
    }
}

impl RecordingSink {
    fn states(&self) -> Vec<ServerState> {
        self.statuses
            .lock()
            .unwrap()
            .iter()
            .map(|event| event.state)
            .collect()
    }
}

fn limits() -> Limits {
    Limits {
        request: Duration::from_millis(400),
        initialize: Duration::from_secs(10),
        shutdown: Duration::from_millis(300),
        restart_window: Duration::from_secs(60),
        max_restarts: 3,
        restart_delay: Duration::ZERO,
    }
}

struct Fixture {
    dir: TempDir,
    root: PathBuf,
    servers: LanguageServers,
    sink: Arc<RecordingSink>,
}

impl Fixture {
    fn new() -> Self {
        Self::with_limits(limits())
    }

    fn with_limits(limits: Limits) -> Self {
        let dir = TempDir::new().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let sink = Arc::new(RecordingSink::default());

        fs::write(root.join("a.rs"), "fn main() {}\n").unwrap();

        Self {
            dir,
            root,
            servers: LanguageServers::with_limits(sink.clone(), limits),
            sink,
        }
    }

    fn start(&self, launcher: &Arc<FakeLauncher>) {
        self.start_in(&self.root, launcher).unwrap();
    }

    fn start_in(&self, root: &Path, launcher: &Arc<FakeLauncher>) -> Result<()> {
        self.servers
            .start_with(
                Sandbox::open(root).unwrap(),
                "rust-analyzer",
                launcher.clone(),
                Value::Null,
                HashMap::new(),
            )
            .map(|_| ())
    }

    fn state(&self) -> ServerState {
        self.servers.status(&self.root, "rust-analyzer").0
    }

    fn wait_for(&self, state: ServerState) {
        wait_until(&format!("state {state:?}"), || self.state() == state);
    }

    fn running(launcher: &Arc<FakeLauncher>) -> Self {
        let fixture = Self::new();

        fixture.start(launcher);
        fixture.wait_for(ServerState::Running);

        fixture
    }

    fn open(&self, text: &str) -> Result<i64> {
        self.servers.open_document(
            &self.root,
            "rust-analyzer",
            "a.rs",
            "rust",
            text.to_string(),
        )
    }

    fn request(
        &self,
        kind: RequestKind,
        position: Option<Position>,
        options: &RequestOptions,
    ) -> Result<Value> {
        self.servers
            .request(&self.root, "rust-analyzer", "a.rs", kind, position, options)
    }

    fn mirror(&self) -> Option<(String, i64)> {
        let server = self.servers.find(&self.root, "rust-analyzer")?;
        let shared = lock(&server.shared);
        let document = shared.documents.get("a.rs")?;

        Some((document.text.clone(), document.version))
    }

    fn uri(&self) -> String {
        file_uri(&self.root.join("a.rs"))
    }
}

fn wait_until(what: &str, condition: impl Fn() -> bool) {
    let started = Instant::now();

    while !condition() {
        assert!(started.elapsed() < DEADLINE, "timed out waiting for {what}");

        thread::sleep(Duration::from_millis(5));
    }
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

fn change(range: Option<Range>, text: &str) -> ContentChange {
    ContentChange {
        range,
        text: text.to_string(),
    }
}

fn incremental() -> Value {
    json!({ "textDocumentSync": { "change": 2 } })
}

fn everything() -> Value {
    json!({
        "textDocumentSync": 2,
        "completionProvider": { "resolveProvider": true },
        "hoverProvider": true,
        "signatureHelpProvider": {},
        "definitionProvider": true,
        "renameProvider": { "prepareProvider": true },
        "documentFormattingProvider": true,
    })
}

// ---- lifecycle ---------------------------------------------------------------

#[test]
fn the_handshake_makes_the_server_running_and_stop_ends_it_politely() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);

    assert_eq!(
        launcher.methods()[..2],
        ["initialize".to_string(), "initialized".to_string()]
    );

    let initialize = launcher.first("initialize").unwrap();
    let root_uri = file_uri(&fixture.root);

    assert_eq!(initialize["params"]["rootUri"], root_uri.as_str());
    assert_eq!(
        initialize["params"]["workspaceFolders"][0]["uri"],
        root_uri.as_str()
    );
    assert_eq!(
        initialize["params"]["capabilities"]["general"]["positionEncodings"],
        json!(["utf-16"])
    );
    assert_eq!(
        initialize["params"]["capabilities"]["workspace"]["applyEdit"],
        false
    );
    assert_eq!(
        initialize["params"]["capabilities"]["workspace"]["workspaceEdit"]["resourceOperations"],
        json!([])
    );

    fixture.servers.stop(&fixture.root, "rust-analyzer");

    wait_until("exit", || launcher.methods().contains(&"exit".to_string()));

    let methods = launcher.methods();
    let shutdown = methods
        .iter()
        .position(|method| method == "shutdown")
        .unwrap();
    let exit = methods.iter().position(|method| method == "exit").unwrap();

    assert!(shutdown < exit);
    assert!(fixture.servers.is_stopped(&fixture.root, "rust-analyzer"));
    assert_eq!(fixture.state(), ServerState::Stopped);
    assert_eq!(
        fixture.sink.states(),
        vec![
            ServerState::Starting,
            ServerState::Running,
            ServerState::Stopped
        ]
    );
}

#[test]
fn starting_twice_keeps_one_process_and_another_project_gets_its_own() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);

    fixture.start(&launcher);
    fixture.start(&launcher);

    let other = Fixture::new();
    let other_launcher = FakeLauncher::serving(incremental(), silent);

    fixture.start_in(&other.root, &other_launcher).unwrap();

    wait_until("second project", || {
        fixture.servers.status(&other.root, "rust-analyzer").0 == ServerState::Running
    });

    assert_eq!(launcher.launches(), 1);
    assert_eq!(other_launcher.launches(), 1);

    fixture.servers.stop_all();
}

#[test]
fn at_most_eight_servers_run_at_once() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::new();
    let folders: Vec<TempDir> = (0..9).map(|_| TempDir::new().unwrap()).collect();

    for folder in &folders[..8] {
        fixture.start_in(folder.path(), &launcher).unwrap();
    }

    assert_eq!(
        fixture.start_in(folders[8].path(), &launcher),
        Err(LanguageServerError::TooMany)
    );

    fixture.servers.stop_all();

    // * Stopped servers free their places.
    assert!(fixture.start_in(folders[8].path(), &launcher).is_ok());

    fixture.servers.stop_all();
}

#[test]
fn documents_opened_while_the_server_starts_are_sent_after_the_handshake() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        // * The document is opened right after `start`, usually while the handshake is still going on.
        serve(&mut ends, &received, &incremental(), &silent, |_| {});
    });
    let fixture = Fixture::new();

    fixture.start(&launcher);
    assert_eq!(fixture.open("fn main() {}\n").unwrap(), 1);
    fixture.wait_for(ServerState::Running);
    wait_until("didOpen", || {
        launcher.first("textDocument/didOpen").is_some()
    });

    let methods = launcher.methods();
    let open = launcher.first("textDocument/didOpen").unwrap();

    assert!(
        methods
            .iter()
            .position(|method| method == "initialized")
            .unwrap()
            < methods
                .iter()
                .position(|method| method == "textDocument/didOpen")
                .unwrap()
    );
    assert_eq!(
        open["params"]["textDocument"]["uri"],
        fixture.uri().as_str()
    );
    assert_eq!(open["params"]["textDocument"]["languageId"], "rust");
    assert_eq!(open["params"]["textDocument"]["version"], 1);
    assert_eq!(open["params"]["textDocument"]["text"], "fn main() {}\n");
    assert_eq!(launcher.all("textDocument/didOpen").len(), 1);

    fixture.servers.stop_all();
}

#[test]
fn opening_an_open_document_again_replaces_its_text_and_bumps_the_version() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);

    assert_eq!(fixture.open("one").unwrap(), 1);
    assert_eq!(fixture.open("two").unwrap(), 2);
    wait_until("didChange", || {
        launcher.first("textDocument/didChange").is_some()
    });

    let replaced = launcher.first("textDocument/didChange").unwrap();

    assert_eq!(replaced["params"]["textDocument"]["version"], 2);
    assert_eq!(
        replaced["params"]["contentChanges"],
        json!([{ "text": "two" }])
    );
    assert_eq!(fixture.mirror(), Some(("two".to_string(), 2)));

    fixture.servers.stop_all();
}

// ---- document sync -----------------------------------------------------------

#[test]
fn changes_bump_the_version_and_the_mirror_follows_the_editor() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);
    let mut editor = "fn à() {\r\n    \"😀\";\r\n}\r\n".to_string();

    fixture.open(&editor).unwrap();

    let edits = [
        change(Some(range((1, 5), (1, 7))), "ả😀"),
        change(Some(range((0, 0), (0, 0))), "// tiêu đề\r\n"),
        change(Some(range((3, 0), (3, 1))), "}\r\n// end"),
    ];

    for (index, edit) in edits.iter().enumerate() {
        let version = fixture
            .servers
            .change_document(
                &fixture.root,
                "rust-analyzer",
                "a.rs",
                std::slice::from_ref(edit),
            )
            .unwrap();

        assert_eq!(version, i64::try_from(index).unwrap() + 2);

        // * The editor applies the same edit by its own offsets.
        let start = crate::language_server_protocol::offset_of(&editor, edit.range.unwrap().start);
        let end = crate::language_server_protocol::offset_of(&editor, edit.range.unwrap().end);

        editor.replace_range(start..end, &edit.text);
    }

    assert_eq!(fixture.mirror().unwrap(), (editor, 4));

    wait_until("three changes", || {
        launcher.all("textDocument/didChange").len() == 3
    });

    let versions: Vec<i64> = launcher
        .all("textDocument/didChange")
        .iter()
        .map(|message| {
            message["params"]["textDocument"]["version"]
                .as_i64()
                .unwrap()
        })
        .collect();

    assert_eq!(versions, vec![2, 3, 4]);
    assert_eq!(
        launcher.all("textDocument/didChange")[0]["params"]["contentChanges"],
        json!([{ "range": { "start": { "line": 1, "character": 5 }, "end": { "line": 1, "character": 7 } }, "text": "ả😀" }])
    );

    fixture.servers.stop_all();
}

#[test]
fn a_server_that_wants_the_whole_text_gets_it_from_the_mirror() {
    let launcher = FakeLauncher::serving(json!({ "textDocumentSync": 1 }), silent);
    let fixture = Fixture::running(&launcher);

    fixture.open("hello").unwrap();
    fixture
        .servers
        .change_document(
            &fixture.root,
            "rust-analyzer",
            "a.rs",
            &[change(Some(range((0, 5), (0, 5))), " world")],
        )
        .unwrap();
    wait_until("didChange", || {
        launcher.first("textDocument/didChange").is_some()
    });

    assert_eq!(
        launcher.first("textDocument/didChange").unwrap()["params"]["contentChanges"],
        json!([{ "text": "hello world" }])
    );

    fixture.servers.stop_all();
}

#[test]
fn saving_sends_the_saved_text_first_when_it_differs_then_didsave() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);

    fixture.open("let a=1;").unwrap();

    let save = |text: Option<&str>| {
        fixture
            .servers
            .save_document(
                &fixture.root,
                "rust-analyzer",
                "a.rs",
                text.map(str::to_string),
            )
            .unwrap()
    };

    assert_eq!(save(Some("let a = 1;")), 2);
    assert_eq!(save(Some("let a = 1;")), 2);
    assert_eq!(save(None), 2);

    wait_until("three saves", || {
        launcher.all("textDocument/didSave").len() == 3
    });

    let relevant: Vec<String> = launcher
        .methods()
        .into_iter()
        .filter(|method| method.starts_with("textDocument/did") && method != "textDocument/didOpen")
        .collect();

    assert_eq!(
        relevant,
        vec![
            "textDocument/didChange",
            "textDocument/didSave",
            "textDocument/didSave",
            "textDocument/didSave"
        ]
    );
    assert_eq!(
        launcher.first("textDocument/didSave").unwrap()["params"]["textDocument"]["uri"],
        fixture.uri().as_str()
    );

    fixture.servers.stop_all();
}

#[test]
fn closing_forgets_the_document_and_tells_the_server() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);

    fixture.open("x").unwrap();
    fixture
        .servers
        .close_document(&fixture.root, "rust-analyzer", "a.rs");
    wait_until("didClose", || {
        launcher.first("textDocument/didClose").is_some()
    });

    assert_eq!(fixture.mirror(), None);
    assert_eq!(
        fixture.servers.change_document(
            &fixture.root,
            "rust-analyzer",
            "a.rs",
            &[change(None, "y")]
        ),
        Err(LanguageServerError::NotOpen)
    );
    assert_eq!(
        fixture
            .servers
            .save_document(&fixture.root, "rust-analyzer", "a.rs", None),
        Err(LanguageServerError::NotOpen)
    );

    fixture.servers.stop_all();
}

#[test]
fn documents_that_cannot_be_sent_are_refused() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);
    let outside = TempDir::new().unwrap();

    fs::write(outside.path().join("secret.rs"), "x").unwrap();

    #[cfg(unix)]
    std::os::unix::fs::symlink(
        outside.path().join("secret.rs"),
        fixture.root.join("link.rs"),
    )
    .unwrap();

    let open = |path: &str, text: String| {
        fixture
            .servers
            .open_document(&fixture.root, "rust-analyzer", path, "rust", text)
    };

    for path in ["../a.rs", "/etc/passwd", "missing.rs", "", "a/../a.rs"] {
        assert_eq!(
            open(path, "x".into()),
            Err(LanguageServerError::BadPath),
            "{path:?}"
        );
    }

    #[cfg(unix)]
    assert_eq!(
        open("link.rs", "x".into()),
        Err(LanguageServerError::BadPath)
    );

    assert_eq!(
        open("a.rs", "x".repeat(MAX_WRITE_BYTES + 1)),
        Err(LanguageServerError::TooLarge)
    );
    assert!(open("a.rs", "x".repeat(MAX_WRITE_BYTES)).is_ok());

    fixture.servers.stop_all();
}

#[test]
fn a_change_that_does_not_fit_leaves_the_document_alone() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);

    fixture.open("abc").unwrap();

    let backwards = change(Some(range((0, 2), (0, 1))), "x");
    let fine = change(Some(range((0, 0), (0, 1))), "A");

    assert_eq!(
        fixture.servers.change_document(
            &fixture.root,
            "rust-analyzer",
            "a.rs",
            &[fine.clone(), backwards]
        ),
        Err(LanguageServerError::OutOfSync)
    );
    assert_eq!(fixture.mirror(), Some(("abc".to_string(), 1)));
    assert_eq!(
        fixture.servers.change_document(
            &fixture.root,
            "rust-analyzer",
            "a.rs",
            &[change(None, &"x".repeat(MAX_WRITE_BYTES + 1))]
        ),
        Err(LanguageServerError::TooLarge)
    );
    assert_eq!(fixture.mirror(), Some(("abc".to_string(), 1)));
    assert_eq!(
        fixture
            .servers
            .change_document(&fixture.root, "rust-analyzer", "a.rs", &[fine])
            .unwrap(),
        2
    );

    fixture.servers.stop_all();
}

#[test]
fn documents_are_capped_per_server() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);

    for index in 0..MAX_DOCUMENTS {
        fs::write(fixture.root.join(format!("f{index}.rs")), "x").unwrap();
        fixture
            .servers
            .open_document(
                &fixture.root,
                "rust-analyzer",
                &format!("f{index}.rs"),
                "rust",
                "x".into(),
            )
            .unwrap();
    }

    assert_eq!(fixture.open("x"), Err(LanguageServerError::TooMany));

    // * One that is already open can still be replaced.
    assert!(fixture
        .servers
        .open_document(&fixture.root, "rust-analyzer", "f0.rs", "rust", "y".into())
        .is_ok());

    fixture.servers.stop_all();
}

// ---- requests ----------------------------------------------------------------

#[test]
fn answers_are_matched_to_requests_by_id_even_when_they_arrive_in_reverse() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        let mut held: Vec<Value> = Vec::new();

        while let Some(message) = ends.receive() {
            record(&received, &message);

            let Some(Incoming::Request { id, method, .. }) = classify(&message) else {
                continue;
            };

            match method.as_str() {
                "initialize" => ends.reply(&id, json!({ "capabilities": everything() })),
                "shutdown" => ends.reply(&id, Value::Null),
                other => {
                    held.push(json!({ "id": id, "method": other }));

                    // * Both requests are in: answer the second one first.
                    if held.len() == 2 {
                        for request in held.iter().rev() {
                            ends.reply(&request["id"], json!({ "contents": request["method"] }));
                        }
                    }
                }
            }
        }
    });
    let fixture = Fixture::running(&launcher);

    fixture.open("x").unwrap();

    let slow = RequestOptions::default();
    let (hover, definition) = thread::scope(|scope| {
        let hover =
            scope.spawn(|| fixture.request(RequestKind::Hover, Some(position(0, 0)), &slow));
        let definition = scope.spawn(|| {
            // * The hover is sent first.
            wait_until("hover sent", || {
                launcher.first("textDocument/hover").is_some()
            });
            fixture.request(RequestKind::Definition, Some(position(0, 0)), &slow)
        });

        (hover.join().unwrap(), definition.join().unwrap())
    });

    assert_eq!(
        hover.unwrap(),
        json!({ "contents": "textDocument/hover", "range": null })
    );
    assert_eq!(
        definition.unwrap(),
        json!([]),
        "a definition answer that is not a location list becomes an empty list"
    );

    fixture.servers.stop_all();
}

#[test]
fn a_request_without_an_answer_times_out_and_is_cancelled() {
    let launcher = FakeLauncher::serving(everything(), silent);
    let fixture = Fixture::running(&launcher);

    fixture.open("x").unwrap();

    let started = Instant::now();
    let result = fixture.request(
        RequestKind::Hover,
        Some(position(0, 0)),
        &RequestOptions::default(),
    );

    assert_eq!(result, Err(LanguageServerError::Timeout));
    assert!(started.elapsed() < Duration::from_secs(5));

    wait_until("cancel", || launcher.first("$/cancelRequest").is_some());

    let hover = launcher.first("textDocument/hover").unwrap();

    assert_eq!(
        launcher.first("$/cancelRequest").unwrap()["params"]["id"],
        hover["id"]
    );

    // * The session is still usable.
    assert_eq!(fixture.state(), ServerState::Running);

    fixture.servers.stop_all();
}

#[test]
fn a_server_error_is_a_failed_request_not_a_crash() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        while let Some(message) = ends.receive() {
            record(&received, &message);

            if let Some(Incoming::Request { id, method, .. }) = classify(&message) {
                match method.as_str() {
                    "initialize" => ends.reply(&id, json!({ "capabilities": everything() })),
                    "shutdown" => ends.reply(&id, Value::Null),
                    _ => ends.send(&error_response_message(&id, -32603, "internal error")),
                }
            }
        }
    });
    let fixture = Fixture::running(&launcher);

    fixture.open("x").unwrap();

    assert_eq!(
        fixture.request(
            RequestKind::Hover,
            Some(position(0, 0)),
            &RequestOptions::default()
        ),
        Err(LanguageServerError::RequestFailed)
    );
    assert_eq!(fixture.state(), ServerState::Running);

    fixture.servers.stop_all();
}

#[test]
fn requests_are_refused_before_the_server_runs_and_for_what_it_cannot_do() {
    let launcher = FakeLauncher::serving(json!({ "hoverProvider": true }), silent);
    let fixture = Fixture::new();

    assert_eq!(
        fixture.request(
            RequestKind::Hover,
            Some(position(0, 0)),
            &RequestOptions::default()
        ),
        Err(LanguageServerError::NotRunning)
    );

    fixture.start(&launcher);
    fixture.wait_for(ServerState::Running);

    let options = RequestOptions::default();

    assert_eq!(
        fixture.request(RequestKind::Hover, Some(position(0, 0)), &options),
        Err(LanguageServerError::NotOpen)
    );

    fixture.open("x").unwrap();

    for kind in [
        RequestKind::Completion,
        RequestKind::CompletionResolve,
        RequestKind::SignatureHelp,
        RequestKind::Definition,
        RequestKind::PrepareRename,
        RequestKind::Rename,
        RequestKind::Formatting,
    ] {
        assert_eq!(
            fixture.request(kind, Some(position(0, 0)), &options),
            Err(LanguageServerError::Unsupported),
            "{kind:?}"
        );
    }

    // * What the server can do still needs its inputs.
    assert_eq!(
        fixture.request(RequestKind::Hover, None, &options),
        Err(LanguageServerError::BadRequest)
    );

    fixture.servers.stop_all();
}

#[test]
fn every_kind_of_request_builds_its_lsp_call() {
    let launcher = FakeLauncher::serving(everything(), |method, _| {
        Some(match method {
            "textDocument/definition" | "textDocument/rename" => Value::Null,
            "textDocument/completion" => json!({ "items": [{ "label": "push" }] }),
            "completionItem/resolve" => json!({ "label": "push", "detail": "resolved" }),
            _ => json!({ "ok": method }),
        })
    });
    let fixture = Fixture::running(&launcher);
    let at = Some(position(2, 5));

    fixture.open("x").unwrap();

    let context = json!({ "triggerKind": 2, "triggerCharacter": "." });
    let signature_context =
        json!({ "triggerKind": 2, "triggerCharacter": ".", "isRetrigger": false });
    let options = RequestOptions {
        trigger_kind: Some(2),
        trigger_character: Some(".".into()),
        is_retrigger: false,
        resolve_key: Some("1:0".into()),
        new_name: Some("renamed".into()),
        tab_size: Some(2),
        insert_spaces: Some(false),
    };
    let item = json!({ "label": "push" });

    for kind in [
        RequestKind::Completion,
        RequestKind::CompletionResolve,
        RequestKind::Hover,
        RequestKind::SignatureHelp,
        RequestKind::PrepareRename,
        RequestKind::Formatting,
    ] {
        assert!(fixture.request(kind, at, &options).is_ok(), "{kind:?}");
    }

    fixture
        .request(RequestKind::Definition, at, &options)
        .unwrap();
    fixture.request(RequestKind::Rename, at, &options).unwrap();

    let document = json!({ "uri": fixture.uri() });
    let position_json = json!({ "line": 2, "character": 5 });
    let params = |method: &str| launcher.first(method).unwrap()["params"].clone();

    assert_eq!(
        params("textDocument/completion"),
        json!({ "textDocument": document, "position": position_json, "context": context })
    );
    assert_eq!(params("completionItem/resolve"), item);
    assert_eq!(
        params("textDocument/hover"),
        json!({ "textDocument": document, "position": position_json })
    );
    assert_eq!(
        params("textDocument/signatureHelp"),
        json!({ "textDocument": document, "position": position_json, "context": signature_context })
    );
    assert_eq!(
        params("textDocument/rename"),
        json!({ "textDocument": document, "position": position_json, "newName": "renamed" })
    );
    assert_eq!(
        params("textDocument/formatting"),
        json!({ "textDocument": document, "options": { "tabSize": 2, "insertSpaces": false } })
    );
    assert!(launcher.first("textDocument/prepareRename").is_some());

    fixture.servers.stop_all();
}

#[test]
fn rename_and_formatting_inputs_are_checked() {
    let launcher = FakeLauncher::serving(everything(), |_, _| Some(Value::Null));
    let fixture = Fixture::running(&launcher);

    fixture.open("x").unwrap();

    let rename = |name: Option<&str>| {
        fixture.request(
            RequestKind::Rename,
            Some(position(0, 0)),
            &RequestOptions {
                new_name: name.map(str::to_string),
                ..RequestOptions::default()
            },
        )
    };
    let too_long = "n".repeat(MAX_NEW_NAME_CHARS + 1);

    for bad in [None, Some(""), Some("a\nb"), Some(too_long.as_str())] {
        assert_eq!(rename(bad), Err(LanguageServerError::BadRequest), "{bad:?}");
    }

    assert!(rename(Some("ok")).is_ok());

    for tab_size in [0, 17] {
        assert_eq!(
            fixture.request(
                RequestKind::Formatting,
                None,
                &RequestOptions {
                    tab_size: Some(tab_size),
                    ..RequestOptions::default()
                }
            ),
            Err(LanguageServerError::BadRequest)
        );
    }

    assert!(fixture
        .request(RequestKind::Formatting, None, &RequestOptions::default())
        .is_ok());
    assert_eq!(
        launcher.first("textDocument/formatting").unwrap()["params"]["options"],
        json!({ "tabSize": 4, "insertSpaces": true })
    );

    fixture.servers.stop_all();
}

#[test]
fn definitions_come_back_as_project_paths_or_external_paths() {
    let fixture_dir = Fixture::new();
    let uri_in = file_uri(&fixture_dir.root.join("a.rs"));
    let answer_in = uri_in.clone();
    let launcher = FakeLauncher::serving(everything(), move |method, _| {
        (method == "textDocument/definition").then(|| {
            json!([
                { "uri": answer_in, "range": { "start": { "line": 3, "character": 1 }, "end": { "line": 3, "character": 4 } } },
                {
                    "targetUri": "file:///usr/lib/rustlib/src/lib.rs",
                    "targetRange": { "start": { "line": 0, "character": 0 }, "end": { "line": 9, "character": 0 } },
                    "targetSelectionRange": { "start": { "line": 1, "character": 1 }, "end": { "line": 1, "character": 3 } },
                },
                { "uri": "http://example.com/x", "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 0 } } },
            ])
        })
    });

    fixture_dir.start(&launcher);
    fixture_dir.wait_for(ServerState::Running);
    fixture_dir.open("x").unwrap();

    let reply = fixture_dir
        .request(
            RequestKind::Definition,
            Some(position(0, 0)),
            &RequestOptions::default(),
        )
        .unwrap();

    assert_eq!(
        reply,
        json!([
            { "path": "a.rs", "external": null, "range": { "startLineNumber": 4, "startColumn": 2, "endLineNumber": 4, "endColumn": 5 } },
            { "path": null, "external": "/usr/lib/rustlib/src/lib.rs", "range": { "startLineNumber": 2, "startColumn": 2, "endLineNumber": 2, "endColumn": 4 } },
        ])
    );

    fixture_dir.servers.stop_all();
}

/// Runs a rename against a server that answers with `answer`; `b.rs` and `.env` exist next to the fixture's `a.rs`.
fn rename_with(answer: impl FnOnce(&Fixture) -> Value) -> (Fixture, Result<Value>) {
    let fixture = Fixture::new();

    fs::write(fixture.root.join("b.rs"), "let b = 1;\n").unwrap();
    fs::write(fixture.root.join(".env"), "SECRET=1\n").unwrap();

    let answer = answer(&fixture);
    let launcher = FakeLauncher::serving(everything(), move |method, _| {
        (method == "textDocument/rename").then(|| answer.clone())
    });

    fixture.start(&launcher);
    fixture.wait_for(ServerState::Running);
    fixture.open("fn main() {}\n").unwrap();

    let reply = fixture.request(
        RequestKind::Rename,
        Some(position(0, 0)),
        &RequestOptions {
            new_name: Some("new".into()),
            ..RequestOptions::default()
        },
    );

    fixture.servers.stop_all();

    (fixture, reply)
}

fn edit_at(line: u32) -> Value {
    json!({ "range": { "start": { "line": line, "character": 0 }, "end": { "line": line, "character": 2 } }, "newText": "new" })
}

#[test]
fn a_rename_is_returned_as_edits_per_project_file_and_nothing_is_written() {
    let (fixture, reply) = rename_with(|fixture| {
        let uri = |name: &str| file_uri(&fixture.root.join(name));

        json!({ "changes": {
            uri("a.rs"): [edit_at(0)],
            uri(".env"): [edit_at(0)],
            "file:///etc/hosts": [edit_at(0)],
            uri("gone.rs"): [edit_at(0)],
        } })
    });
    let reply = reply.unwrap();
    let files = reply["files"].as_array().unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], "a.rs");
    assert_eq!(files[0]["expectedHash"], workspace::hash("fn main() {}\n"));
    assert_eq!(files[0]["editCount"], 1);
    assert_eq!(files[0]["edits"][0]["text"], "new");
    assert_eq!(files[0]["edits"][0]["range"]["startLineNumber"], 1);
    assert_eq!(files[0]["edits"][0]["range"]["endColumn"], 3);

    let skipped: Vec<(&str, &str)> = reply["skipped"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            (
                entry["display"].as_str().unwrap(),
                entry["reason"].as_str().unwrap(),
            )
        })
        .collect();

    assert!(skipped.contains(&("/etc/hosts", "workspace.bad_path")));
    assert!(skipped.contains(&(".env", "workspace.denied")));
    assert!(skipped.contains(&("gone.rs", "workspace.not_found")));
    assert_eq!(skipped.len(), 3);

    // * The rename only described changes.
    assert_eq!(
        fs::read_to_string(fixture.root.join("b.rs")).unwrap(),
        "let b = 1;\n"
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("a.rs")).unwrap(),
        "fn main() {}\n"
    );
}

#[test]
fn document_changes_win_over_changes_and_resource_operations_are_unsupported() {
    let (_, reply) = rename_with(|fixture| {
        let uri = |name: &str| file_uri(&fixture.root.join(name));

        json!({
            "changes": { uri("a.rs"): [edit_at(0)] },
            "documentChanges": [{
                "textDocument": { "uri": uri("b.rs"), "version": null },
                "edits": [edit_at(0), { "range": edit_at(1)["range"], "newText": "again", "annotationId": "x" }],
            }],
        })
    });
    let reply = reply.unwrap();
    let files = reply["files"].as_array().unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], "b.rs");
    assert_eq!(files[0]["editCount"], 2);
    assert_eq!(files[0]["edits"][1]["text"], "again");

    let (_, reply) = rename_with(|fixture| {
        let uri = file_uri(&fixture.root.join("b.rs"));

        json!({ "documentChanges": [
            { "textDocument": { "uri": uri, "version": null }, "edits": [edit_at(0)] },
            { "kind": "rename", "oldUri": uri, "newUri": format!("{uri}2") },
        ] })
    });

    assert_eq!(reply, Err(LanguageServerError::Unsupported));
}

// ---- what the server sends on its own ----------------------------------------

#[test]
fn requests_from_the_server_are_answered_and_it_may_not_edit_files() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        serve(&mut ends, &received, &incremental(), &silent, |ends| {
            ends.send(&request_message(
                101,
                "workspace/configuration",
                json!({ "items": [{}, {}] }),
            ));
            ends.send(&request_message(
                102,
                "client/registerCapability",
                json!({ "registrations": [] }),
            ));
            ends.send(&request_message(
                103,
                "window/workDoneProgress/create",
                json!({ "token": 1 }),
            ));
            ends.send(&request_message(
                104,
                "workspace/applyEdit",
                json!({ "edit": { "changes": {} } }),
            ));
            ends.send(&request_message(105, "custom/unknown", Value::Null));
            ends.send(&request_message(
                106,
                "workspace/diagnostic/refresh",
                Value::Null,
            ));
            ends.send(&notification_message(
                "window/logMessage",
                json!({ "type": 3, "message": "indexing done" }),
            ));
            ends.send(&notification_message("$/progress", json!({ "token": 1 })));
            let _ = write!(ends.stderr, "boom: something\nsecond line");
        });
    });
    let fixture = Fixture::running(&launcher);

    wait_until("six answers", || {
        launcher
            .messages()
            .iter()
            .filter(|message| message.get("method").is_none() && message.get("id").is_some())
            .count()
            >= 6
    });

    let answer = |id: u64| {
        launcher
            .messages()
            .into_iter()
            .find(|message| {
                message.get("id") == Some(&json!(id)) && message.get("method").is_none()
            })
            .unwrap()
    };

    assert_eq!(answer(101)["result"], json!([null, null]));
    assert_eq!(answer(102)["result"], Value::Null);
    assert_eq!(answer(103)["result"], Value::Null);
    assert_eq!(answer(104)["result"]["applied"], false);
    assert_eq!(answer(105)["error"]["code"], METHOD_NOT_FOUND);
    assert_eq!(answer(106)["result"], Value::Null);

    wait_until("log lines", || {
        let log = fixture.servers.log(&fixture.root, "rust-analyzer");

        log.iter().any(|line| line == "indexing done")
            && log.iter().any(|line| line == "stderr: boom: something")
    });

    fixture.servers.stop_all();
}

#[test]
fn diagnostics_become_project_relative_events_and_outside_files_are_dropped() {
    let fixture = Fixture::new();
    let uri = file_uri(&fixture.root.join("a.rs"));
    let outside = "file:///etc/hosts".to_string();
    let launcher = FakeLauncher::new(move |_, mut ends, received| {
        let (uri, outside) = (uri.clone(), outside.clone());

        serve(&mut ends, &received, &incremental(), &silent, move |ends| {
            let diagnostic = json!({
                "range": { "start": { "line": 0, "character": 3 }, "end": { "line": 0, "character": 7 } },
                "severity": 1,
                "message": "mismatched types",
                "relatedInformation": [{ "location": { "uri": "file:///Users/someone/x.rs" }, "message": "here" }],
            });

            ends.send(&notification_message(
                "textDocument/publishDiagnostics",
                json!({ "uri": outside, "diagnostics": [diagnostic.clone()] }),
            ));
            ends.send(&notification_message(
                "textDocument/publishDiagnostics",
                json!({ "uri": uri, "diagnostics": [diagnostic] }),
            ));
            ends.send(&notification_message(
                "textDocument/publishDiagnostics",
                json!({ "uri": uri, "diagnostics": [] }),
            ));
        });
    });

    fixture.start(&launcher);
    wait_until("two events", || {
        fixture.sink.diagnostics.lock().unwrap().len() == 2
    });

    let events = fixture.sink.diagnostics.lock().unwrap().clone();

    assert_eq!(events[0].path, "a.rs");
    assert_eq!(events[0].server_id, "rust-analyzer");
    assert_eq!(events[0].root, fixture.root.display().to_string());
    assert_eq!(events[0].diagnostics.len(), 1);
    assert_eq!(events[0].diagnostics[0]["message"], "mismatched types");
    assert!(events[0].diagnostics[0].get("relatedInformation").is_none());
    assert!(events[1].diagnostics.is_empty());

    fixture.servers.stop_all();
}

// ---- failures ---------------------------------------------------------------

#[test]
fn a_server_that_dies_is_restarted_with_its_open_documents() {
    let launcher = FakeLauncher::new(|launch, mut ends, received| {
        if launch == 0 {
            // * The first process dies as soon as it hears of the document.
            let mut handshake_done = false;

            while let Some(message) = ends.receive() {
                record(&received, &message);

                match classify(&message) {
                    Some(Incoming::Request { id, method, .. }) if method == "initialize" => {
                        ends.reply(&id, json!({ "capabilities": incremental() }));
                    }
                    Some(Incoming::Notification { method, .. }) if method == "initialized" => {
                        handshake_done = true;
                    }
                    Some(Incoming::Notification { method, .. })
                        if handshake_done && method == "textDocument/didOpen" =>
                    {
                        return;
                    }
                    _ => {}
                }
            }
        } else {
            serve(&mut ends, &received, &incremental(), &silent, |_| {});
        }
    });
    let fixture = Fixture::running(&launcher);

    fixture.open("fn main() {}\n").unwrap();

    wait_until("second process", || launcher.launches() == 2);
    wait_until("document sent again", || {
        launcher.all("textDocument/didOpen").len() == 2
    });
    fixture.wait_for(ServerState::Running);

    let opens = launcher.all("textDocument/didOpen");

    assert_eq!(opens[1]["params"]["textDocument"]["text"], "fn main() {}\n");
    assert_eq!(
        opens[1]["params"]["textDocument"]["uri"],
        fixture.uri().as_str()
    );
    assert_eq!(fixture.mirror(), Some(("fn main() {}\n".to_string(), 1)));
    assert_eq!(
        fixture.sink.states(),
        vec![
            ServerState::Starting,
            ServerState::Running,
            ServerState::Starting,
            ServerState::Running
        ]
    );

    fixture.servers.stop_all();
}

#[test]
fn a_server_that_keeps_dying_ends_in_error_after_three_restarts() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        // * Handshake, then gone.
        while let Some(message) = ends.receive() {
            record(&received, &message);

            if let Some(Incoming::Request { id, method, .. }) = classify(&message) {
                if method == "initialize" {
                    ends.reply(&id, json!({ "capabilities": incremental() }));
                }
            }

            if message.get("method").and_then(Value::as_str) == Some("initialized") {
                return;
            }
        }
    });
    let fixture = Fixture::new();

    fixture.start(&launcher);
    fixture.wait_for(ServerState::Error);

    assert_eq!(launcher.launches(), 4);
    assert_eq!(
        fixture.servers.status(&fixture.root, "rust-analyzer"),
        (ServerState::Error, Some("language_server.crashed"))
    );

    // * Editing goes on without a server: documents can still be opened, requests say it is not ready.
    assert!(fixture.open("x").is_ok());
    assert_eq!(
        fixture.request(
            RequestKind::Hover,
            Some(position(0, 0)),
            &RequestOptions::default()
        ),
        Err(LanguageServerError::NotRunning)
    );

    fixture.servers.stop_all();
}

#[test]
fn a_failed_handshake_is_an_error_at_once_without_restarts() {
    let rejected = FakeLauncher::new(|_, mut ends, received| {
        while let Some(message) = ends.receive() {
            record(&received, &message);

            if let Some(Incoming::Request { id, .. }) = classify(&message) {
                ends.send(&error_response_message(&id, -32603, "no"));
            }
        }
    });
    let fixture = Fixture::new();

    fixture.start(&rejected);
    fixture.wait_for(ServerState::Error);

    assert_eq!(
        fixture.servers.status(&fixture.root, "rust-analyzer").1,
        Some("language_server.start_failed")
    );
    assert_eq!(rejected.launches(), 1);

    let no_capabilities = FakeLauncher::new(|_, mut ends, received| {
        while let Some(message) = ends.receive() {
            record(&received, &message);

            if let Some(Incoming::Request { id, .. }) = classify(&message) {
                ends.reply(&id, json!({ "nothing": true }));
            }
        }
    });
    let other = Fixture::new();

    other.start(&no_capabilities);
    other.wait_for(ServerState::Error);

    assert_eq!(
        other.servers.status(&other.root, "rust-analyzer").1,
        Some("language_server.start_failed")
    );
}

#[test]
fn a_handshake_that_never_finishes_times_out() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        while let Some(message) = ends.receive() {
            record(&received, &message);
        }
    });
    let fixture = Fixture::with_limits(Limits {
        initialize: Duration::from_millis(300),
        ..limits()
    });

    fixture.start(&launcher);
    fixture.wait_for(ServerState::Error);

    assert_eq!(
        fixture.servers.status(&fixture.root, "rust-analyzer").1,
        Some("language_server.timeout")
    );
    assert_eq!(launcher.launches(), 1);
}

#[test]
fn a_broken_stream_closes_the_session_and_the_last_error_is_the_protocol_one() {
    for (garbage, key) in [
        (
            "Content-Length: nope\r\n\r\n{}".to_string(),
            "language_server.bad_header",
        ),
        (
            format!("Content-Length: {}\r\n\r\n", 17 * 1024 * 1024),
            "language_server.message_too_large",
        ),
        (
            "Content-Length: 4\r\n\r\nabcd".to_string(),
            "language_server.bad_message",
        ),
    ] {
        let launcher = FakeLauncher::new(move |_, mut ends, received| {
            let garbage = garbage.clone();

            serve(&mut ends, &received, &incremental(), &silent, move |ends| {
                let _ = ends.outgoing.write_all(garbage.as_bytes());
            });
        });
        let fixture = Fixture::new();

        fixture.start(&launcher);
        fixture.wait_for(ServerState::Error);

        assert_eq!(
            fixture.servers.status(&fixture.root, "rust-analyzer").1,
            Some(key)
        );
        assert!(fixture
            .servers
            .log(&fixture.root, "rust-analyzer")
            .iter()
            .any(|line| line.starts_with("protocol error")));
    }
}

#[test]
fn restart_keeps_the_documents_and_starts_a_new_process() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);

    fixture.open("fn main() {}\n").unwrap();

    let old_documents = fixture
        .servers
        .stop_taking_documents(&fixture.root, "rust-analyzer");

    assert_eq!(old_documents.len(), 1);
    assert!(!fixture.servers.has_session(&fixture.root, "rust-analyzer"));

    fixture
        .servers
        .start_with(
            Sandbox::open(&fixture.root).unwrap(),
            "rust-analyzer",
            launcher.clone(),
            Value::Null,
            old_documents,
        )
        .unwrap();
    fixture.wait_for(ServerState::Running);
    wait_until("document sent to the new process", || {
        launcher.all("textDocument/didOpen").len() == 2
    });

    assert_eq!(launcher.launches(), 2);
    assert_eq!(fixture.mirror(), Some(("fn main() {}\n".to_string(), 1)));

    fixture.servers.stop_all();
}

// ---- stopping ----------------------------------------------------------------

#[test]
fn a_server_that_ignores_shutdown_is_not_waited_for_longer_than_the_limit() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        while let Some(message) = ends.receive() {
            record(&received, &message);

            if let Some(Incoming::Request { id, method, .. }) = classify(&message) {
                if method == "initialize" {
                    ends.reply(&id, json!({ "capabilities": incremental() }));
                }
            }
        }
    });
    let fixture = Fixture::running(&launcher);
    let started = Instant::now();

    fixture.servers.stop(&fixture.root, "rust-analyzer");

    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(fixture.state(), ServerState::Stopped);

    wait_until("exit", || launcher.methods().contains(&"exit".to_string()));
}

#[test]
fn stop_all_stops_every_server_at_the_same_time() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        while let Some(message) = ends.receive() {
            record(&received, &message);

            if let Some(Incoming::Request { id, method, .. }) = classify(&message) {
                if method == "initialize" {
                    ends.reply(&id, json!({ "capabilities": incremental() }));
                }
            }
        }
    });
    let fixture = Fixture::with_limits(Limits {
        shutdown: Duration::from_millis(500),
        ..limits()
    });
    let folders: Vec<TempDir> = (0..4).map(|_| TempDir::new().unwrap()).collect();

    for folder in &folders {
        fixture.start_in(folder.path(), &launcher).unwrap();
    }

    wait_until("all running", || {
        folders.iter().all(|folder| {
            fixture
                .servers
                .status(&fs::canonicalize(folder.path()).unwrap(), "rust-analyzer")
                .0
                == ServerState::Running
        })
    });

    let started = Instant::now();

    fixture.servers.stop_all();

    // * Four servers that never answer `shutdown`, 0.5 s each: one after the other would take 2 s.
    assert!(
        started.elapsed() < Duration::from_millis(1800),
        "{:?}",
        started.elapsed()
    );

    for folder in &folders {
        assert!(!fixture
            .servers
            .has_session(&fs::canonicalize(folder.path()).unwrap(), "rust-analyzer"));
    }
}

#[test]
fn stopping_a_project_leaves_the_others_and_stopping_a_server_id_stops_it_everywhere() {
    let launcher = FakeLauncher::serving(incremental(), silent);
    let fixture = Fixture::running(&launcher);
    let other = TempDir::new().unwrap();
    let other_root = fs::canonicalize(other.path()).unwrap();

    fixture.start_in(&other_root, &launcher).unwrap();
    wait_until("other running", || {
        fixture.servers.status(&other_root, "rust-analyzer").0 == ServerState::Running
    });

    fixture.servers.stop_root(&other_root);

    assert!(!fixture.servers.has_session(&other_root, "rust-analyzer"));
    assert_eq!(fixture.state(), ServerState::Running);

    fixture.start_in(&other_root, &launcher).unwrap();
    fixture.servers.stop_id("intelephense");

    assert!(fixture.servers.has_session(&other_root, "rust-analyzer"));

    fixture.servers.stop_id("rust-analyzer");

    assert!(!fixture.servers.has_session(&other_root, "rust-analyzer"));
    assert!(!fixture.servers.has_session(&fixture.root, "rust-analyzer"));
}

#[test]
fn a_server_stopped_while_it_is_still_starting_does_not_linger() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        // * Never answers `initialize`.
        while let Some(message) = ends.receive() {
            record(&received, &message);
        }
    });
    let fixture = Fixture::with_limits(Limits {
        initialize: Duration::from_secs(30),
        ..limits()
    });

    fixture.start(&launcher);
    wait_until("initialize sent", || launcher.first("initialize").is_some());

    let started = Instant::now();

    fixture.servers.stop(&fixture.root, "rust-analyzer");

    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(launcher.launches(), 1);
    assert!(fixture.servers.is_stopped(&fixture.root, "rust-analyzer"));
}

// ---- applying a rename -------------------------------------------------------

fn workspace_with(files: &[(&str, &str)]) -> (TempDir, Workspace) {
    let dir = TempDir::new().unwrap();

    for (path, content) in files {
        let full = dir.path().join(path);

        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }

    let workspace = Workspace::open(dir.path()).unwrap();

    (dir, workspace)
}

/// Start and end (line, character) of an edit, and its new text.
type Edit<'a> = ((u32, u32), (u32, u32), &'a str);

fn file_edit(path: &str, content: &str, edits: &[Edit]) -> FileEdit {
    FileEdit {
        path: path.to_string(),
        expected_hash: Some(workspace::hash(content)),
        edits: edits
            .iter()
            .map(|(start, end, new_text)| TextEditInput {
                range: range(*start, *end),
                text: (*new_text).to_string(),
            })
            .collect(),
    }
}

#[test]
fn confirmed_edits_are_written_with_the_hash_they_were_computed_against() {
    let (dir, workspace) =
        workspace_with(&[("a.rs", "let old = old + 1;\n"), ("src/b.rs", "old();\n")]);
    let report = apply_file_edits(
        &workspace,
        &[
            file_edit(
                "a.rs",
                "let old = old + 1;\n",
                &[((0, 4), (0, 7), "new"), ((0, 10), (0, 13), "new")],
            ),
            file_edit("src/b.rs", "old();\n", &[((0, 0), (0, 3), "new")]),
        ],
    );

    assert_eq!(report.written, vec!["a.rs", "src/b.rs"]);
    assert!(report.failed.is_empty());
    assert_eq!(
        fs::read_to_string(dir.path().join("a.rs")).unwrap(),
        "let new = new + 1;\n"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("src/b.rs")).unwrap(),
        "new();\n"
    );
}

#[test]
fn a_file_that_changed_since_or_is_off_limits_is_not_written_and_the_others_are() {
    let (dir, workspace) = workspace_with(&[
        ("a.rs", "one\n"),
        ("b.rs", "two\n"),
        (".env", "SECRET=1\n"),
        ("vendor/c.rs", "three\n"),
    ]);

    // * b.rs was edited after the rename was computed; a.rs is fine and still written.
    fs::write(dir.path().join("b.rs"), "two edited\n").unwrap();

    let report = apply_file_edits(
        &workspace,
        &[
            file_edit("a.rs", "one\n", &[((0, 0), (0, 3), "uno")]),
            file_edit("b.rs", "two\n", &[((0, 0), (0, 3), "dos")]),
            file_edit(".env", "SECRET=1\n", &[((0, 0), (0, 6), "X")]),
            file_edit("vendor/c.rs", "three\n", &[((0, 0), (0, 5), "tres")]),
            file_edit("../outside.rs", "x", &[]),
            file_edit("missing.rs", "x", &[]),
        ],
    );

    assert_eq!(report.written, vec!["a.rs"]);
    assert_eq!(
        report.failed,
        vec![
            FailedEdit {
                path: "b.rs".into(),
                error: "workspace.conflict"
            },
            FailedEdit {
                path: ".env".into(),
                error: "workspace.denied"
            },
            FailedEdit {
                path: "vendor/c.rs".into(),
                error: "workspace.denied"
            },
            FailedEdit {
                path: "../outside.rs".into(),
                error: "workspace.bad_path"
            },
            FailedEdit {
                path: "missing.rs".into(),
                error: "workspace.not_found"
            },
        ]
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("a.rs")).unwrap(),
        "uno\n"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("b.rs")).unwrap(),
        "two edited\n"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join(".env")).unwrap(),
        "SECRET=1\n"
    );
}

#[test]
fn overlapping_edits_and_oversized_results_are_refused() {
    let (dir, workspace) = workspace_with(&[("a.rs", "abcdef\n")]);
    let overlapping = file_edit(
        "a.rs",
        "abcdef\n",
        &[((0, 0), (0, 3), "x"), ((0, 2), (0, 4), "y")],
    );
    let huge = file_edit(
        "a.rs",
        "abcdef\n",
        &[((0, 0), (0, 1), &"z".repeat(MAX_WRITE_BYTES))],
    );

    assert_eq!(
        apply_file_edits(&workspace, &[overlapping]).failed,
        vec![FailedEdit {
            path: "a.rs".into(),
            error: "language_server.bad_request"
        }]
    );
    assert_eq!(
        apply_file_edits(&workspace, &[huge]).failed,
        vec![FailedEdit {
            path: "a.rs".into(),
            error: "workspace.too_large"
        }]
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("a.rs")).unwrap(),
        "abcdef\n"
    );
}

// ---- real processes ----------------------------------------------------------

/// Runs a real program like production does and remembers its process id.
#[cfg(unix)]
struct SpyLauncher {
    inner: ProcessLauncher,
    pids: Mutex<Vec<u32>>,
}

#[cfg(unix)]
impl Launcher for SpyLauncher {
    fn launch(&self) -> io::Result<Transport> {
        let transport = self.inner.launch()?;

        if let Some(child) = &transport.child {
            self.pids.lock().unwrap().push(child.id());
        }

        Ok(transport)
    }
}

#[cfg(unix)]
fn plan(program: &str, arguments: &[&str]) -> LaunchPlan {
    LaunchPlan {
        program: PathBuf::from(program),
        arguments: arguments
            .iter()
            .map(|argument| (*argument).to_string())
            .collect(),
        extra_path: Vec::new(),
        initialization_options: Value::Null,
    }
}

#[cfg(unix)]
fn start_real(fixture: &Fixture, plan: LaunchPlan) -> Arc<SpyLauncher> {
    let launcher = Arc::new(SpyLauncher {
        inner: ProcessLauncher {
            plan,
            root: fixture.root.clone(),
        },
        pids: Mutex::new(Vec::new()),
    });

    fixture
        .servers
        .start_with(
            Sandbox::open(&fixture.root).unwrap(),
            "rust-analyzer",
            launcher.clone(),
            Value::Null,
            HashMap::new(),
        )
        .unwrap();

    launcher
}

#[cfg(unix)]
fn is_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(unix)]
#[test]
fn a_real_process_that_never_answers_the_handshake_is_an_error_and_is_gone() {
    let fixture = Fixture::with_limits(Limits {
        initialize: Duration::from_millis(300),
        ..limits()
    });
    let launcher = start_real(&fixture, plan("/bin/sleep", &["30"]));

    fixture.wait_for(ServerState::Error);

    assert_eq!(
        fixture.servers.status(&fixture.root, "rust-analyzer").1,
        Some("language_server.timeout")
    );

    let pid = launcher.pids.lock().unwrap()[0];

    wait_until("process gone", || !is_alive(pid));
}

#[cfg(unix)]
#[test]
fn a_real_process_that_echoes_our_messages_fails_the_handshake() {
    let fixture = Fixture::new();
    let launcher = start_real(&fixture, plan("/bin/cat", &[]));

    fixture.wait_for(ServerState::Error);

    // * `cat` sends our `initialize` back as if it were the server's request; we refuse it and it echoes that error as the answer.
    assert_eq!(
        fixture.servers.status(&fixture.root, "rust-analyzer").1,
        Some("language_server.start_failed")
    );

    let pid = launcher.pids.lock().unwrap()[0];

    wait_until("process gone", || !is_alive(pid));
}

#[cfg(unix)]
#[test]
fn a_program_that_is_gone_says_the_extension_changed() {
    let fixture = Fixture::new();

    start_real(&fixture, plan("/nonexistent/language-server", &[]));
    fixture.wait_for(ServerState::Error);

    assert_eq!(
        fixture.servers.status(&fixture.root, "rust-analyzer").1,
        Some("language_server.extension_changed")
    );
}

#[cfg(unix)]
#[test]
fn stop_all_leaves_no_process_behind_not_even_the_helpers_of_a_server() {
    let fixture = Fixture::new();
    let script = "pwd > cwd.txt; sleep 61 & echo $! > helper.pid; wait";
    let launcher = start_real(&fixture, plan("/bin/sh", &["-c", script]));

    wait_until("helper started", || {
        fixture.root.join("helper.pid").exists()
    });
    wait_until("helper pid written", || {
        fs::read_to_string(fixture.root.join("helper.pid"))
            .is_ok_and(|text| text.trim().parse::<u32>().is_ok())
    });

    let helper: u32 = fs::read_to_string(fixture.root.join("helper.pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let pid = launcher.pids.lock().unwrap()[0];

    // * The server runs in the project folder, with no shell around the command but the one it was given.
    assert_eq!(
        fs::read_to_string(fixture.root.join("cwd.txt"))
            .unwrap()
            .trim(),
        fixture.root.display().to_string()
    );
    assert!(is_alive(pid) && is_alive(helper));

    fixture.servers.stop_all();

    wait_until("server gone", || !is_alive(pid));
    wait_until("helper gone", || !is_alive(helper));
    assert!(!fixture.servers.has_session(&fixture.root, "rust-analyzer"));
}

#[test]
fn server_launches_take_only_catalog_plans() {
    let fixture = Fixture::new();
    let plan = LaunchPlan {
        program: PathBuf::from("/bin/sh"),
        arguments: Vec::new(),
        extra_path: Vec::new(),
        initialization_options: Value::Null,
    };

    // * An id outside the catalog never starts, whatever the plan.
    assert_eq!(
        fixture.servers.start(&fixture.root, "evil", plan.clone()),
        Err(LanguageServerError::BadRequest)
    );
    assert_eq!(
        fixture
            .servers
            .start(&fixture.root.join("missing"), "rust-analyzer", plan),
        Err(LanguageServerError::BadPath)
    );
}

#[test]
fn error_keys_are_fixed_language_server_keys() {
    for error in [
        LanguageServerError::NotRunning,
        LanguageServerError::NotOpen,
        LanguageServerError::Unsupported,
        LanguageServerError::Timeout,
        LanguageServerError::Cancelled,
        LanguageServerError::RequestFailed,
        LanguageServerError::BadPath,
        LanguageServerError::TooLarge,
        LanguageServerError::TooMany,
        LanguageServerError::OutOfSync,
        LanguageServerError::BadRequest,
        LanguageServerError::StartFailed,
        LanguageServerError::EncodingUnsupported,
        LanguageServerError::ExtensionChanged,
        LanguageServerError::NotFound,
        LanguageServerError::Crashed,
        LanguageServerError::Protocol(ProtocolError::TooLarge),
    ] {
        assert!(
            error.key().starts_with("language_server.") || error.key().starts_with("workspace."),
            "{error:?}"
        );
        assert_eq!(error.to_string(), error.key());
    }

    let _unused = Fixture::new().dir;
}

// ---- design contract: stop, features, conversions ---------------------------

#[test]
fn a_stopped_slot_keeps_its_documents_and_starts_again_with_them() {
    let launcher = FakeLauncher::serving(everything(), silent);
    let fixture = Fixture::running(&launcher);

    fixture.open("one").unwrap();
    fixture.servers.stop(&fixture.root, "rust-analyzer");

    assert!(fixture.servers.is_stopped(&fixture.root, "rust-analyzer"));
    assert_eq!(fixture.state(), ServerState::Stopped);
    assert!(fixture.servers.has_session(&fixture.root, "rust-analyzer"));
    assert_eq!(fixture.mirror(), Some(("one".to_string(), 1)));

    // * Opening a file in a stopped slot only mirrors it; the process is not started.
    fixture.open("two").unwrap();

    assert_eq!(launcher.launches(), 1);
    assert_eq!(fixture.mirror(), Some(("two".to_string(), 2)));

    // * A restart (a new start over the stopped slot) sends the mirrored text again.
    fixture.start(&launcher);
    fixture.wait_for(ServerState::Running);

    assert_eq!(launcher.launches(), 2);
    assert!(!fixture.servers.is_stopped(&fixture.root, "rust-analyzer"));

    let opened = launcher.all("textDocument/didOpen");

    assert_eq!(opened.len(), 2);
    assert_eq!(opened[1]["params"]["textDocument"]["text"], "two");

    fixture.servers.stop_all();
}

#[test]
fn slots_can_be_listed_by_server_and_forgotten() {
    let launcher = FakeLauncher::serving(everything(), silent);
    let fixture = Fixture::running(&launcher);

    assert_eq!(
        fixture.servers.slots_of("rust-analyzer"),
        vec![(fixture.root.clone(), false)]
    );

    fixture.open("x").unwrap();

    assert_eq!(
        fixture.servers.slots_of("rust-analyzer"),
        vec![(fixture.root.clone(), true)]
    );
    assert!(fixture.servers.slots_of("intelephense").is_empty());

    fixture.servers.forget(&fixture.root, "rust-analyzer");

    assert!(!fixture.servers.has_session(&fixture.root, "rust-analyzer"));
}

#[test]
fn only_slots_that_start_or_run_count_towards_the_limit_of_eight() {
    let launcher = FakeLauncher::serving(everything(), silent);
    let fixture = Fixture::new();
    let folders: Vec<TempDir> = (0..9).map(|_| TempDir::new().unwrap()).collect();

    for folder in &folders[..8] {
        fixture
            .start_in(&fs::canonicalize(folder.path()).unwrap(), &launcher)
            .unwrap();
    }

    assert_eq!(
        fixture.start_in(&fs::canonicalize(folders[8].path()).unwrap(), &launcher),
        Err(LanguageServerError::TooMany)
    );

    // * A stopped slot no longer counts.
    fixture.servers.stop(
        &fs::canonicalize(folders[0].path()).unwrap(),
        "rust-analyzer",
    );
    fixture
        .start_in(&fs::canonicalize(folders[8].path()).unwrap(), &launcher)
        .unwrap();

    fixture.servers.stop_all();
}

#[test]
fn the_running_state_carries_the_features_the_server_announced() {
    let launcher = FakeLauncher::serving(
        json!({
            "completionProvider": { "resolveProvider": true, "triggerCharacters": [".", ":"] },
            "hoverProvider": true,
            "signatureHelpProvider": { "triggerCharacters": ["("], "retriggerCharacters": [","] },
            "renameProvider": true,
        }),
        silent,
    );
    let fixture = Fixture::running(&launcher);
    let features = fixture
        .servers
        .features(&fixture.root, "rust-analyzer")
        .unwrap();

    assert!(features.completion && features.completion_resolve && features.hover);
    assert_eq!(features.completion_trigger_characters, vec![".", ":"]);
    assert_eq!(features.signature_trigger_characters, vec!["("]);
    assert_eq!(features.signature_retrigger_characters, vec![","]);
    assert!(features.rename && features.prepare_rename);
    assert!(!features.definition && !features.formatting);

    let statuses = fixture.sink.statuses.lock().unwrap().clone();
    let running = statuses
        .iter()
        .find(|event| event.state == ServerState::Running)
        .unwrap();

    assert_eq!(running.features.as_ref(), Some(&features));
    assert_eq!(
        running.root.as_deref(),
        Some(fixture.root.to_str().unwrap())
    );
    assert_eq!(running.server_id, "rust-analyzer");
    assert!(statuses
        .iter()
        .filter(|event| event.state != ServerState::Running)
        .all(|event| event.features.is_none()));

    fixture.servers.stop_all();
    assert_eq!(
        fixture.servers.features(&fixture.root, "rust-analyzer"),
        None
    );
}

#[test]
fn diagnostics_are_sent_in_editor_coordinates_and_cleared_on_close_and_stop() {
    let fixture = Fixture::new();
    let a = fixture.uri();
    let launcher = FakeLauncher::new(move |_, mut ends, received| {
        serve(&mut ends, &received, &everything(), &silent, |ends| {
            ends.send(&notification_message(
                    "textDocument/publishDiagnostics",
                    json!({
                        "uri": a,
                        "version": 3,
                        "diagnostics": [
                            {
                                "range": { "start": { "line": 0, "character": 3 }, "end": { "line": 0, "character": 4 } },
                                "severity": 2,
                                "message": "unused",
                                "source": "rustc",
                                "code": 42,
                                "relatedInformation": [{ "location": { "uri": "file:///secret" } }]
                            },
                            { "message": "no range" },
                            { "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 1 } }, "message": "x", "code": "E1" }
                        ]
                    }),
                ));
        });
    });

    fixture.start(&launcher);
    fixture.open("fn main() {}").unwrap();
    wait_until("diagnostics", || {
        !fixture.sink.diagnostics.lock().unwrap().is_empty()
    });

    let first = fixture.sink.diagnostics.lock().unwrap()[0].clone();

    assert_eq!(first.path, "a.rs");
    assert_eq!(first.version, Some(3));
    assert_eq!(first.server_id, "rust-analyzer");
    assert_eq!(first.diagnostics.len(), 2);
    assert_eq!(first.diagnostics[0]["range"]["startColumn"], 4);
    assert_eq!(first.diagnostics[0]["severity"], 2);
    assert_eq!(first.diagnostics[0]["code"], "42");
    assert_eq!(first.diagnostics[0]["source"], "rustc");
    assert!(first.diagnostics[0].get("relatedInformation").is_none());
    assert_eq!(first.diagnostics[1]["severity"], 1);
    assert_eq!(first.diagnostics[1]["code"], "E1");

    fixture
        .servers
        .close_document(&fixture.root, "rust-analyzer", "a.rs");

    let after_close = fixture
        .sink
        .diagnostics
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .clone();

    assert!(after_close.diagnostics.is_empty());
    assert_eq!(after_close.path, "a.rs");

    fixture.open("again").unwrap();
    fixture.servers.stop(&fixture.root, "rust-analyzer");

    let after_stop = fixture
        .sink
        .diagnostics
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .clone();

    assert!(after_stop.diagnostics.is_empty());
}

#[test]
fn completion_items_can_be_resolved_until_the_next_completion() {
    let launcher = FakeLauncher::serving(everything(), |method, params| {
        Some(match method {
            "textDocument/completion" => {
                json!([{ "label": "push", "data": 1 }, { "label": "pop" }])
            }
            "completionItem/resolve" => json!({
                "label": params["label"],
                "detail": "resolved",
                "documentation": { "kind": "markdown", "value": "docs" },
            }),
            _ => return None,
        })
    });
    let fixture = Fixture::running(&launcher);
    let at = Some(position(0, 0));
    let options = RequestOptions::default();

    fixture.open("x").unwrap();

    let first = fixture
        .request(RequestKind::Completion, at, &options)
        .unwrap();
    let key = first["items"][1]["resolveKey"]
        .as_str()
        .unwrap()
        .to_string();

    assert_eq!(key, "1:1");

    let resolve = |key: &str| {
        fixture.request(
            RequestKind::CompletionResolve,
            None,
            &RequestOptions {
                resolve_key: Some(key.to_string()),
                ..RequestOptions::default()
            },
        )
    };
    let resolved = resolve(&key).unwrap();

    assert_eq!(resolved["label"], "pop");
    assert_eq!(resolved["detail"], "resolved");
    assert_eq!(resolved["documentation"], "docs");
    assert_eq!(resolved["resolveKey"], key.as_str());

    // * The original item (with its `data`) goes back to the server.
    let sent = launcher.first("completionItem/resolve").unwrap();

    assert_eq!(sent["params"]["label"], "pop");

    for bad in ["", "1", "x:y", "1:9"] {
        assert_eq!(resolve(bad), Err(LanguageServerError::BadRequest), "{bad}");
    }

    // * A newer completion makes the old keys stale.
    fixture
        .request(RequestKind::Completion, at, &options)
        .unwrap();

    assert_eq!(resolve(&key), Err(LanguageServerError::Cancelled));
    assert!(resolve("2:0").is_ok());

    fixture.servers.stop_all();
}

#[test]
fn a_server_without_a_prepare_provider_is_answered_from_the_text() {
    let launcher = FakeLauncher::serving(json!({ "renameProvider": true }), silent);
    let fixture = Fixture::running(&launcher);

    fixture.open("let value = 1;").unwrap();

    let answer = fixture
        .request(
            RequestKind::PrepareRename,
            Some(position(0, 6)),
            &RequestOptions::default(),
        )
        .unwrap();

    assert_eq!(answer["placeholder"], "value");
    assert_eq!(answer["range"]["startColumn"], 5);
    assert_eq!(answer["range"]["endColumn"], 10);
    assert!(launcher.first("textDocument/prepareRename").is_none());

    let nothing = fixture
        .request(
            RequestKind::PrepareRename,
            Some(position(0, 3)),
            &RequestOptions::default(),
        )
        .unwrap();

    assert_eq!(nothing["placeholder"], "let");

    fixture.servers.stop_all();
}

#[test]
fn the_answers_of_hover_signature_and_formatting_are_normalised() {
    let launcher = FakeLauncher::serving(everything(), |method, _| {
        Some(match method {
            "textDocument/hover" => json!({
                "contents": { "kind": "markdown", "value": "docs" },
                "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 2 } },
            }),
            "textDocument/signatureHelp" => json!({
                "signatures": [{ "label": "f(a)", "parameters": [{ "label": "a" }] }],
                "activeParameter": 0,
            }),
            "textDocument/formatting" => json!([
                { "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 1 } }, "newText": "F" }
            ]),
            _ => return None,
        })
    });
    let fixture = Fixture::running(&launcher);
    let at = Some(position(0, 0));
    let options = RequestOptions::default();

    fixture.open("x").unwrap();

    let hover = fixture.request(RequestKind::Hover, at, &options).unwrap();

    assert_eq!(hover["contents"], "docs");
    assert_eq!(hover["range"]["endColumn"], 3);

    let help = fixture
        .request(RequestKind::SignatureHelp, at, &options)
        .unwrap();

    assert_eq!(help["signatures"][0]["parameters"][0]["label"], "a");

    let edits = fixture
        .request(RequestKind::Formatting, None, &options)
        .unwrap();

    assert_eq!(edits[0]["text"], "F");
    assert_eq!(edits[0]["range"]["startLineNumber"], 1);

    fixture.servers.stop_all();
}

#[test]
fn a_cancelled_answer_and_a_superseded_request_are_cancelled() {
    let launcher = FakeLauncher::new(|_, mut ends, received| {
        let mut hovers = 0;

        while let Some(message) = ends.receive() {
            record(&received, &message);

            if let Some(Incoming::Request { id, method, .. }) = classify(&message) {
                match method.as_str() {
                    "initialize" => ends.reply(&id, json!({ "capabilities": everything() })),
                    "shutdown" => ends.reply(&id, Value::Null),
                    "textDocument/definition" => {
                        ends.send(&error_response_message(&id, -32800, "cancelled"));
                    }
                    "textDocument/hover" => {
                        hovers += 1;

                        // * The first hover is never answered; the second one is.
                        if hovers == 2 {
                            ends.reply(&id, json!({ "contents": "second" }));
                        }
                    }
                    _ => {}
                }
            }
        }
    });
    let fixture = Fixture::with_limits(Limits {
        request: Duration::from_secs(5),
        ..limits()
    });

    fixture.start(&launcher);
    fixture.wait_for(ServerState::Running);
    fixture.open("x").unwrap();

    assert_eq!(
        fixture.request(
            RequestKind::Definition,
            Some(position(0, 0)),
            &RequestOptions::default()
        ),
        Err(LanguageServerError::Cancelled)
    );

    let (first, second) = thread::scope(|scope| {
        let first = scope.spawn(|| {
            fixture.request(
                RequestKind::Hover,
                Some(position(0, 0)),
                &RequestOptions::default(),
            )
        });

        wait_until("first hover sent", || {
            launcher.first("textDocument/hover").is_some()
        });

        let second = fixture.request(
            RequestKind::Hover,
            Some(position(0, 0)),
            &RequestOptions::default(),
        );

        (first.join().unwrap(), second)
    });

    assert_eq!(first, Err(LanguageServerError::Cancelled));
    assert_eq!(second.unwrap()["contents"], "second");
    assert!(launcher.first("$/cancelRequest").is_some());

    fixture.servers.stop_all();
}

#[test]
fn a_server_that_answers_in_another_position_encoding_is_refused() {
    let launcher = FakeLauncher::serving(json!({ "positionEncoding": "utf-8" }), silent);
    let fixture = Fixture::new();

    fixture.start(&launcher);
    fixture.wait_for(ServerState::Error);

    assert_eq!(
        fixture.servers.status(&fixture.root, "rust-analyzer").1,
        Some("language_server.encoding_unsupported")
    );
}

#[test]
fn wait_started_returns_once_the_server_runs() {
    let launcher = FakeLauncher::serving(everything(), silent);
    let fixture = Fixture::new();

    fixture.start(&launcher);

    let (state, error) =
        fixture
            .servers
            .wait_started(&fixture.root, "rust-analyzer", Duration::from_secs(10));

    assert_eq!((state, error), (ServerState::Running, None));

    fixture.servers.stop_all();
}

#[test]
fn request_options_check_the_trigger_kind() {
    let launcher = FakeLauncher::serving(everything(), |_, _| Some(Value::Null));
    let fixture = Fixture::running(&launcher);

    fixture.open("x").unwrap();

    for kind in [0, 4] {
        assert_eq!(
            fixture.request(
                RequestKind::Completion,
                Some(position(0, 0)),
                &RequestOptions {
                    trigger_kind: Some(kind),
                    ..RequestOptions::default()
                }
            ),
            Err(LanguageServerError::BadRequest)
        );
    }

    fixture.servers.stop_all();
}
