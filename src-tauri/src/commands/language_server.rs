//! Tauri commands for the language servers: what the settings tab lists and switches, and what the editor sends about the files it shows. Thin over [`crate::language_server`]; every failure is a fixed `language_server.*` (or `workspace.*`) key. The contract with the front end is in `docs/system/language-servers.md` section 8.
//!
//! The front end only names a server id, a project (`root`) and project-relative paths, with Monaco coordinates (one-based). Which program runs, and from where, is decided here from the catalog and the person's saved choice.

use super::blocking;
use super::state::AppState;
use crate::language_server::{
    apply_file_edits, ApplyReport, ContentChange, DiagnosticsEvent, EventSink, FileEdit,
    LanguageServers, RequestKind, RequestOptions, ServerFeatures, ServerState, StatusEvent,
    TextEditInput,
};
use crate::language_server_catalog::{
    self as catalog, Candidate, InstallHint, LaunchPlan, Locator, ServerSpec, SourceChoice,
};
use crate::language_server_config::{LanguageServerConfigStore, ServerSetting};
use crate::language_server_convert::{DocumentChange, EditorPosition, TextEdit};
use crate::validation;
use crate::vscode_extensions::ExtensionOrigin;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const UNAVAILABLE: &str = "language_server.unavailable";
const DISABLED: &str = "language_server.disabled";
const NOT_INSTALLED: &str = "language_server.not_installed";
const INVALID: &str = "language_server.invalid";
const UNKNOWN_SERVER: &str = "language_server.unknown_server";
const BAD_REQUEST: &str = "language_server.bad_request";
const TOO_LARGE: &str = "language_server.too_large";
const NOT_OPEN: &str = "language_server.not_open";

/// Longest wait for a server to finish starting when a file is opened.
const START_WAIT: Duration = Duration::from_secs(60);

/// Text one `document_change` call may carry, as for a whole document.
const MAX_CHANGE_BYTES: usize = 100_000;

/// Files and edits per file one `apply_edit` call may carry.
const MAX_EDIT_FILES: usize = 500;
const MAX_EDITS_PER_FILE: usize = 10_000;

/// Sends the events of the servers to the window. `enabled` in a status event is read from the saved setting.
pub struct WindowSink {
    pub app: AppHandle,
    pub config: LanguageServerConfigStore,
}

impl EventSink for WindowSink {
    fn diagnostics(&self, event: DiagnosticsEvent) {
        let _ = self.app.emit("language-server-diagnostics", event);
    }

    fn status(&self, mut event: StatusEvent) {
        event.enabled = self
            .config
            .setting(&event.server_id)
            .is_some_and(|setting| setting.enabled);

        let _ = self.app.emit("language-server-status", event);
    }
}

/// One server as the settings tab shows it (`LanguageServerInfo` in the front end).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub languages: Vec<&'static str>,
    pub file_extensions: Vec<&'static str>,
    pub enabled: bool,
    pub source: SourceChoice,
    pub extension_root: Option<String>,
    /// Every place the server was found, extensions first; the ones that cannot be used say why.
    pub candidates: Vec<Candidate>,
    /// Index in `candidates` of the one that runs with the current choice.
    pub selected: Option<usize>,
    pub state: ServerState,
    pub last_error: Option<&'static str>,
    /// Set when nothing usable was found: what to install.
    pub install_hint: Option<InstallHint>,
    /// True when nothing usable was found and the app can install the server itself (it has an `npm` package and Node is there).
    pub can_download: bool,
}

/// The listing of one server. `session` is its state in the open project, `None` when nothing runs.
pub fn listing(
    spec: &'static ServerSpec,
    setting: &ServerSetting,
    locator: &Locator,
    session: Option<(ServerState, Option<&'static str>)>,
) -> LanguageServerInfo {
    let candidates = catalog::candidates(spec, locator, true);
    let selected = catalog::select(
        &candidates,
        setting.source,
        setting
            .extension_root
            .as_deref()
            .and_then(ExtensionOrigin::parse),
    );
    let (state, last_error) = session.unwrap_or(if selected.is_some() {
        (ServerState::Stopped, None)
    } else {
        (ServerState::Missing, None)
    });
    let nothing_usable = candidates.iter().all(|candidate| !candidate.is_usable());
    let install_hint = nothing_usable.then(|| catalog::install_hint(spec));
    let can_download = nothing_usable && spec.install.is_some() && locator.node().is_some();

    LanguageServerInfo {
        id: spec.id,
        name: spec.name,
        languages: spec.language_ids(),
        file_extensions: spec.file_extensions(),
        enabled: setting.enabled,
        source: setting.source,
        extension_root: setting.extension_root.clone(),
        candidates,
        selected,
        state,
        last_error,
        install_hint,
        can_download,
    }
}

/// What to run for the server with the person's choice, `None` when no usable source matches it. Does not run `--version`.
pub fn launch_plan(
    spec: &ServerSpec,
    setting: &ServerSetting,
    locator: &Locator,
    storage: &Path,
) -> Option<LaunchPlan> {
    let candidates = catalog::candidates(spec, locator, false);
    let index = catalog::select(
        &candidates,
        setting.source,
        setting
            .extension_root
            .as_deref()
            .and_then(ExtensionOrigin::parse),
    )?;
    let mut plan = candidates.into_iter().nth(index)?.launch?;

    plan.initialization_options = catalog::initialization_options(spec, storage);

    Some(plan)
}

/// Folder a server may keep its own files in for the project at `root`, inside the app's data folder.
fn storage_folder(app: &AppHandle, spec: &ServerSpec, root: &Path) -> Option<std::path::PathBuf> {
    let digest = format!("{:x}", Sha256::digest(root.to_string_lossy().as_bytes()));
    let folder = app
        .path()
        .app_data_dir()
        .ok()?
        .join("language-servers")
        .join(spec.id)
        .join(&digest[..12]);

    fs::create_dir_all(&folder).ok()?;

    Some(folder)
}

/// This machine's locator that also finds the servers the app installed into its data folder.
fn system_locator(app: &AppHandle) -> Option<Locator> {
    let locator = Locator::system()?;

    Some(match app.path().app_data_dir() {
        Ok(directory) => {
            locator.with_installed_dir(directory.join("language-servers").join("installed"))
        }
        Err(_) => locator,
    })
}

fn plan_for(
    app: &AppHandle,
    spec: &'static ServerSpec,
    setting: &ServerSetting,
    root: &Path,
) -> Result<LaunchPlan, String> {
    let locator = system_locator(app).ok_or(UNAVAILABLE)?;
    let storage = storage_folder(app, spec, root).unwrap_or_default();

    launch_plan(spec, setting, &locator, &storage).ok_or_else(|| NOT_INSTALLED.to_string())
}

fn known(id: &str) -> Result<&'static ServerSpec, String> {
    catalog::spec(id).ok_or_else(|| UNKNOWN_SERVER.to_string())
}

fn session_of(
    servers: &LanguageServers,
    root: &Path,
    id: &str,
) -> Option<(ServerState, Option<&'static str>)> {
    servers
        .has_session(root, id)
        .then(|| servers.status(root, id))
}

fn info_for(
    servers: &LanguageServers,
    root: Option<&Path>,
    spec: &'static ServerSpec,
    setting: &ServerSetting,
    locator: &Locator,
) -> LanguageServerInfo {
    let session = root.and_then(|root| session_of(servers, root, spec.id));

    listing(spec, setting, locator, session)
}

/// The servers with what was found for each and their state in the project at `root` (the open project when absent). Runs `--version` of programs found in `PATH`, so it is on the blocking pool.
#[tauri::command]
pub async fn language_server_list(
    app: AppHandle,
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    root: Option<String>,
) -> Result<Vec<LanguageServerInfo>, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let servers = servers.inner().clone();
    let settings = config.get();

    blocking(UNAVAILABLE, move || {
        let locator = system_locator(&app).ok_or(UNAVAILABLE)?;

        Ok(catalog::SERVERS
            .iter()
            .zip(&settings)
            .map(|(spec, setting)| {
                info_for(&servers, Some(workspace.root()), spec, setting, &locator)
            })
            .collect())
    })
    .await
}

/// Switches a server on or off and chooses where it is taken from. Switched off, it is stopped in every project; with another source, the servers that have open files start again from the new one.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // * Four states plus the command's own fields; the flat argument names are the contract with the front end (section 8 of the design doc).
pub async fn language_server_configure(
    app: AppHandle,
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    id: String,
    enabled: bool,
    source: String,
    extension_root: Option<String>,
) -> Result<LanguageServerInfo, String> {
    let spec = known(&id)?;
    let source: SourceChoice =
        serde_json::from_value(Value::String(source)).map_err(|_| INVALID.to_string())?;
    let before = config.setting(&id);
    let after = config
        .save(&id, enabled, source, extension_root.as_deref())
        .map_err(|error| error.to_string())?;
    let open_root = state
        .workspace_for(None)
        .ok()
        .map(|workspace| workspace.root().to_path_buf());
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        let changed = before.as_ref() != Some(&after);
        let enabled_changed = before.as_ref().map(|before| before.enabled) != Some(after.enabled);

        if changed && !after.enabled {
            servers.stop_id(spec.id);
        } else if changed {
            restart_open_slots(&app, &servers, spec, &after);
        }

        let locator = system_locator(&app).ok_or(UNAVAILABLE)?;
        let info = info_for(&servers, open_root.as_deref(), spec, &after, &locator);

        if enabled_changed {
            // * The setting is global, not tied to a project: the event has no root.
            let _ = app.emit(
                "language-server-status",
                StatusEvent {
                    root: None,
                    server_id: spec.id.to_string(),
                    state: if info.selected.is_some() {
                        ServerState::Stopped
                    } else {
                        ServerState::Missing
                    },
                    enabled: after.enabled,
                    last_error: None,
                    features: None,
                },
            );
        }

        Ok(info)
    })
    .await
}

/// Installs the server with `npm` into the app's data folder, then switches it to that source when nothing else is usable. Takes a while with a slow network, so it is on the blocking pool.
#[tauri::command]
pub async fn language_server_install(
    app: AppHandle,
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    id: String,
) -> Result<LanguageServerInfo, String> {
    let spec = known(&id)?;
    let setting = config
        .setting(&id)
        .ok_or_else(|| UNKNOWN_SERVER.to_string())?;
    let open_root = state
        .workspace_for(None)
        .ok()
        .map(|workspace| workspace.root().to_path_buf());
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        let locator = system_locator(&app).ok_or(UNAVAILABLE)?;

        crate::language_server_install::install(spec, &locator).map_err(str::to_string)?;
        restart_open_slots(&app, &servers, spec, &setting);

        Ok(info_for(
            &servers,
            open_root.as_deref(),
            spec,
            &setting,
            &locator,
        ))
    })
    .await
}

/// Removes the server the app installed; the servers of VS Code and `PATH` are never touched.
#[tauri::command]
pub async fn language_server_uninstall(
    app: AppHandle,
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    id: String,
) -> Result<LanguageServerInfo, String> {
    let spec = known(&id)?;
    let setting = config
        .setting(&id)
        .ok_or_else(|| UNKNOWN_SERVER.to_string())?;
    let open_root = state
        .workspace_for(None)
        .ok()
        .map(|workspace| workspace.root().to_path_buf());
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        let locator = system_locator(&app).ok_or(UNAVAILABLE)?;

        servers.stop_id(spec.id);
        crate::language_server_install::uninstall(spec, &locator).map_err(str::to_string)?;

        Ok(info_for(
            &servers,
            open_root.as_deref(),
            spec,
            &setting,
            &locator,
        ))
    })
    .await
}

/// After the source of a server changed: a project with open files gets the server again from the new source, one without is simply forgotten.
fn restart_open_slots(
    app: &AppHandle,
    servers: &LanguageServers,
    spec: &'static ServerSpec,
    setting: &ServerSetting,
) {
    for (root, has_documents) in servers.slots_of(spec.id) {
        match plan_for(app, spec, setting, &root) {
            Ok(plan) if has_documents => {
                let _ = servers.restart(&root, spec.id, plan);
            }
            _ => servers.forget(&root, spec.id),
        }
    }
}

/// Stops the server of the project and starts it again, with the documents it had. Clears a manual stop.
#[tauri::command]
pub async fn language_server_restart(
    app: AppHandle,
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    root: Option<String>,
    id: String,
) -> Result<(), String> {
    let spec = known(&id)?;
    let workspace = state.workspace_for(root.as_deref())?;
    let setting = config.setting(&id).ok_or(UNKNOWN_SERVER)?;

    if !setting.enabled {
        return Err(DISABLED.to_string());
    }

    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        let plan = plan_for(&app, spec, &setting, workspace.root())?;

        servers
            .restart(workspace.root(), spec.id, plan)
            .map_err(|error| error.key().to_string())
    })
    .await
}

/// Stops the server of the project. A later open of a file does not start it; "restart" does.
#[tauri::command]
pub async fn language_server_stop(
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    root: Option<String>,
    id: String,
) -> Result<(), String> {
    let spec = known(&id)?;
    let workspace = state.workspace_for(root.as_deref())?;
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        servers.stop(workspace.root(), spec.id);

        Ok(())
    })
    .await
}

/// The last 500 log lines of the server in the project.
#[tauri::command]
pub fn language_server_log(
    state: State<AppState>,
    servers: State<LanguageServers>,
    root: Option<String>,
    id: String,
) -> Result<Vec<String>, String> {
    let spec = known(&id)?;
    let workspace = state.workspace_for(root.as_deref())?;

    Ok(servers.log(workspace.root(), spec.id))
}

/// Answer of `document_open`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpened {
    /// The project folder events carry as `root`.
    pub root: String,
    pub server_id: &'static str,
    pub state: ServerState,
    /// `None` until the server is running.
    pub features: Option<ServerFeatures>,
}

/// The server for a file of the project, when one is switched on: the project, the server and the language id.
fn target_for(
    state: &AppState,
    config: &LanguageServerConfigStore,
    root: Option<&str>,
    path: &str,
) -> Result<
    Option<(
        crate::workspace::Workspace,
        &'static ServerSpec,
        &'static str,
    )>,
    String,
> {
    validation::relative_path(path)?;

    let Some((spec, language_id)) = catalog::spec_for_path(path) else {
        return Ok(None);
    };

    if !config
        .setting(spec.id)
        .is_some_and(|setting| setting.enabled)
    {
        return Ok(None);
    }

    Ok(Some((state.workspace_for(root)?, spec, language_id)))
}

/// Tells the server of the file's language about an open file, starting the server on the first one, and waits until it runs (60 s at most). `None` when no server handles the file (none for its language, switched off, or no usable source): the editor then works as before. After a manual stop the file is only remembered and the state is `stopped`.
#[tauri::command]
pub async fn language_server_document_open(
    app: AppHandle,
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    root: Option<String>,
    path: String,
    text: String,
) -> Result<Option<DocumentOpened>, String> {
    let Some((workspace, spec, language_id)) = target_for(&state, &config, root.as_deref(), &path)?
    else {
        return Ok(None);
    };
    let setting = config.setting(spec.id).ok_or(UNKNOWN_SERVER)?;
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        let root = workspace.root();
        let mut spawned = false;

        if !servers.has_session(root, spec.id) {
            let Ok(plan) = plan_for(&app, spec, &setting, root) else {
                return Ok(None);
            };

            servers
                .start(root, spec.id, plan)
                .map_err(|error| error.key().to_string())?;
            spawned = true;
        }

        servers
            .open_document(root, spec.id, &path, language_id, text)
            .map_err(|error| error.key().to_string())?;

        let (state, last_error) = if servers.is_stopped(root, spec.id) {
            (ServerState::Stopped, None)
        } else {
            servers.wait_started(root, spec.id, START_WAIT)
        };

        // * Only the call that started the server reports why it did not come up; later opens see the state.
        if let (true, ServerState::Error, Some(key)) = (spawned, state, last_error) {
            if matches!(
                key,
                "language_server.start_failed" | "language_server.timeout"
            ) {
                return Err(key.to_string());
            }
        }

        Ok(Some(DocumentOpened {
            root: root.display().to_string(),
            server_id: spec.id,
            state,
            features: servers.features(root, spec.id),
        }))
    })
    .await
}

/// Forwards the editor's changes (Monaco ranges, or the whole text when a change has no range).
#[tauri::command]
pub async fn language_server_document_change(
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    root: Option<String>,
    path: String,
    changes: Vec<DocumentChange>,
) -> Result<(), String> {
    if changes.is_empty() {
        return Ok(());
    }

    if changes
        .iter()
        .map(|change| change.text.len())
        .sum::<usize>()
        > MAX_CHANGE_BYTES
    {
        return Err(TOO_LARGE.to_string());
    }

    let (workspace, spec, _) =
        target_for(&state, &config, root.as_deref(), &path)?.ok_or_else(|| NOT_OPEN.to_string())?;
    let changes = changes
        .into_iter()
        .map(|change| {
            Ok(ContentChange {
                range: match change.range {
                    Some(range) => Some(range.to_lsp().ok_or(BAD_REQUEST)?),
                    None => None,
                },
                text: change.text,
            })
        })
        .collect::<Result<Vec<_>, &str>>()
        .map_err(str::to_string)?;
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        servers
            .change_document(workspace.root(), spec.id, &path, &changes)
            .map(|_| ())
            .map_err(|error| error.key().to_string())
    })
    .await
}

/// Tells the server the file was saved; `text` is what is on disk, sent first when it differs from what the server has.
#[tauri::command]
pub async fn language_server_document_save(
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    root: Option<String>,
    path: String,
    text: String,
) -> Result<(), String> {
    let Some((workspace, spec, _)) = target_for(&state, &config, root.as_deref(), &path)? else {
        return Ok(());
    };
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        if !servers.has_session(workspace.root(), spec.id) {
            return Ok(());
        }

        servers
            .save_document(workspace.root(), spec.id, &path, Some(text))
            .map(|_| ())
            .map_err(|error| error.key().to_string())
    })
    .await
}

#[tauri::command]
pub async fn language_server_document_close(
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    root: Option<String>,
    path: String,
) -> Result<(), String> {
    validation::relative_path(&path)?;

    let Some((spec, _)) = catalog::spec_for_path(&path) else {
        return Ok(());
    };
    let workspace = state.workspace_for(root.as_deref())?;
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        servers.close_document(workspace.root(), spec.id, &path);

        Ok(())
    })
    .await
}

/// Asks the server about a position of an open file. `kind` and `options` are checked here; the answer is the normalised one the editor takes (see `docs/system/language-servers.md` section 8.2).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // * One flat argument per field: the names are the command's contract with the front end.
pub async fn language_server_request(
    state: State<'_, AppState>,
    servers: State<'_, LanguageServers>,
    config: State<'_, LanguageServerConfigStore>,
    root: Option<String>,
    path: String,
    kind: String,
    position: Option<EditorPosition>,
    options: Option<Value>,
) -> Result<Value, String> {
    let kind: RequestKind =
        serde_json::from_value(Value::String(kind)).map_err(|_| BAD_REQUEST.to_string())?;
    let position = match position {
        Some(position) => Some(position.to_lsp().ok_or(BAD_REQUEST)?),
        None => None,
    };
    let options: RequestOptions = match options {
        None | Some(Value::Null) => RequestOptions::default(),
        Some(value) => serde_json::from_value(value).map_err(|_| BAD_REQUEST.to_string())?,
    };
    let (workspace, spec, _) =
        target_for(&state, &config, root.as_deref(), &path)?.ok_or_else(|| NOT_OPEN.to_string())?;
    let servers = servers.inner().clone();

    blocking(UNAVAILABLE, move || {
        servers
            .request(workspace.root(), spec.id, &path, kind, position, &options)
            .map_err(|error| error.key().to_string())
    })
    .await
}

/// The edits of one file, as the rename confirmation listed them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEdits {
    pub path: String,
    pub edits: Vec<TextEdit>,
    pub expected_hash: Option<String>,
}

/// Writes the rename edits of files that are not open in the editor, after the person confirmed. Each file is written only if it passes the project's rules and still has the hash it had when the edits were computed; one that does not is reported in `failed` and the others are still written.
#[tauri::command]
pub async fn language_server_apply_edit(
    state: State<'_, AppState>,
    root: Option<String>,
    files: Vec<FileEdits>,
) -> Result<ApplyReport, String> {
    if files.len() > MAX_EDIT_FILES
        || files
            .iter()
            .any(|file| file.edits.len() > MAX_EDITS_PER_FILE)
    {
        return Err(TOO_LARGE.to_string());
    }

    let workspace = state.workspace_for(root.as_deref())?;
    let files = files
        .into_iter()
        .map(|file| {
            Ok(FileEdit {
                path: file.path,
                expected_hash: file.expected_hash,
                edits: file
                    .edits
                    .into_iter()
                    .map(|edit| {
                        Ok(TextEditInput {
                            range: edit.range.to_lsp().ok_or(BAD_REQUEST)?,
                            text: edit.text,
                        })
                    })
                    .collect::<Result<Vec<_>, &str>>()?,
            })
        })
        .collect::<Result<Vec<_>, &str>>()
        .map_err(str::to_string)?;

    blocking(UNAVAILABLE, move || {
        Ok(apply_file_edits(&workspace, &files))
    })
    .await
}

#[cfg(test)]
#[path = "../../tests/unit/commands_language_server.rs"]
mod tests;
