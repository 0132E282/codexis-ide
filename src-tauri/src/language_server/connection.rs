//! One process of a language server: the writer, reader and stderr threads around it, request bookkeeping and the way to end it.

use super::{lock, LanguageServerError, Result, Server, Transport, EXIT_GRACE};
use crate::language_server_protocol::{
    error_response_message, notification_message, request_message, response_message, write_message,
    RpcError,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// One process of a server: the way to talk to it and to end it.
pub(super) struct Connection {
    outgoing: Sender<Option<Value>>,
    pending: Mutex<HashMap<u64, Sender<std::result::Result<Value, RpcError>>>>,
    next_id: AtomicU64,
    /// The newest request of each `key` (see `request_keyed`): an older one still waiting is cancelled.
    latest: Mutex<HashMap<String, u64>>,
    closed: Arc<AtomicBool>,
    child: Mutex<Option<Child>>,
}

impl Connection {
    /// Starts the writer, reader and stderr threads. The receiver gets a message when the reader ends.
    pub(super) fn open(transport: Transport, server: &Arc<Server>) -> (Arc<Self>, Receiver<()>) {
        let Transport {
            reader,
            mut writer,
            stderr,
            child,
        } = transport;
        let (outgoing, queue) = mpsc::channel::<Option<Value>>();
        let closed = Arc::new(AtomicBool::new(false));
        let connection = Arc::new(Self {
            outgoing,
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
            latest: Mutex::new(HashMap::new()),
            closed: closed.clone(),
            child: Mutex::new(child),
        });

        thread::spawn(move || {
            while let Ok(Some(message)) = queue.recv() {
                if write_message(&mut writer, &message).is_err() {
                    closed.store(true, Ordering::SeqCst);

                    break;
                }
            }
        });

        let (closed_signal, closed_receiver) = mpsc::channel();
        let reader_server = server.clone();
        let reader_connection = connection.clone();

        thread::spawn(move || {
            reader_server.read_loop(&reader_connection, reader);
            reader_connection.close();

            let _ = closed_signal.send(());
        });

        if let Some(stderr) = stderr {
            let stderr_server = server.clone();

            thread::spawn(move || stderr_server.pump_stderr(stderr));
        }

        (connection, closed_receiver)
    }

    pub(super) fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    fn lock_pending(
        &self,
    ) -> MutexGuard<'_, HashMap<u64, Sender<std::result::Result<Value, RpcError>>>> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_child(&self) -> MutexGuard<'_, Option<Child>> {
        self.child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Marks the connection ended: waiting requests fail at once and the writer stops.
    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.lock_pending().clear();

        let _ = self.outgoing.send(None);
    }

    fn send(&self, message: Value) {
        if !self.is_closed() {
            let _ = self.outgoing.send(Some(message));
        }
    }

    pub(super) fn notify(&self, method: &str, params: Value) {
        self.send(notification_message(method, params));
    }

    pub(super) fn respond(&self, id: &Value, result: Value) {
        self.send(response_message(id, result));
    }

    pub(super) fn respond_error(&self, id: &Value, code: i64, message: &str) {
        self.send(error_response_message(id, code, message));
    }

    /// Sends a request and waits for its answer. After `timeout` the request is cancelled on the server and `Timeout` is returned.
    pub(super) fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value> {
        self.request_keyed(method, params, timeout, None)
    }

    /// Like `request`; a newer request with the same `key` cancels this one (it returns `Cancelled`), so typing fast never queues answers nobody wants.
    pub(super) fn request_keyed(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
        key: Option<&str>,
    ) -> Result<Value> {
        if self.is_closed() {
            return Err(LanguageServerError::NotRunning);
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (answer, answered) = mpsc::channel();

        self.lock_pending().insert(id, answer);

        // * Checked again after registering: a connection that closed in between would never answer.
        if self.is_closed() {
            self.lock_pending().remove(&id);

            return Err(LanguageServerError::NotRunning);
        }

        if let Some(key) = key {
            let previous = lock(&self.latest).insert(key.to_string(), id);

            if let Some(previous) = previous {
                self.resolve(
                    previous,
                    Err(RpcError {
                        code: REQUEST_CANCELLED,
                        message: "superseded".to_string(),
                    }),
                );
                self.notify("$/cancelRequest", json!({ "id": previous }));
            }
        }

        self.send(request_message(id, method, params));

        let outcome = answered.recv_timeout(timeout);

        if let Some(key) = key {
            let mut latest = lock(&self.latest);

            if latest.get(key) == Some(&id) {
                latest.remove(key);
            }
        }

        match outcome {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(error)) => Err(if is_cancellation(error.code) {
                LanguageServerError::Cancelled
            } else {
                LanguageServerError::RequestFailed
            }),
            Err(RecvTimeoutError::Timeout) => {
                self.lock_pending().remove(&id);
                self.notify("$/cancelRequest", json!({ "id": id }));

                Err(LanguageServerError::Timeout)
            }
            Err(RecvTimeoutError::Disconnected) => Err(LanguageServerError::NotRunning),
        }
    }

    pub(super) fn resolve(&self, id: u64, result: std::result::Result<Value, RpcError>) {
        let answer = self.lock_pending().remove(&id);

        if let Some(answer) = answer {
            let _ = answer.send(result);
        }
    }

    /// Whether the process has exited (false when there is no process).
    pub(super) fn child_exited(&self) -> bool {
        self.lock_child()
            .as_mut()
            .is_some_and(|child| matches!(child.try_wait(), Ok(Some(_))))
    }

    /// Asks the server to shut down (`shutdown`, then `exit`), gives it a moment, then kills whatever is left.
    pub(super) fn shutdown(&self, timeout: Duration) {
        if !self.is_closed() {
            let _ = self.request("shutdown", Value::Null, timeout);
            self.notify("exit", Value::Null);
        }

        self.close();
        self.reap(EXIT_GRACE);
    }

    /// Ends the process now.
    pub(super) fn kill(&self) {
        self.close();
        self.reap(Duration::ZERO);
    }

    /// Waits up to `grace` for the process to exit by itself, then kills its whole process group and collects it.
    fn reap(&self, grace: Duration) {
        let started = Instant::now();

        loop {
            {
                let mut child = self.lock_child();
                let Some(process) = child.as_mut() else {
                    return;
                };

                if matches!(process.try_wait(), Ok(Some(_))) {
                    child.take();

                    return;
                }
            }

            if started.elapsed() >= grace {
                break;
            }

            thread::sleep(Duration::from_millis(10));
        }

        if let Some(mut process) = self.lock_child().take() {
            kill_group(process.id());

            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

/// LSP `RequestCancelled` and `ServerCancelled`.
const REQUEST_CANCELLED: i64 = -32800;
const SERVER_CANCELLED: i64 = -32802;
const CONTENT_MODIFIED: i64 = -32801;

fn is_cancellation(code: i64) -> bool {
    matches!(
        code,
        REQUEST_CANCELLED | CONTENT_MODIFIED | SERVER_CANCELLED
    )
}

/// Kills the process group the server leads (its helpers included). Best effort: the group may be gone already.
fn kill_group(leader: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("/bin/kill")
            .args(["-KILL", "--", &format!("-{leader}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(unix))]
    let _ = leader;
}
