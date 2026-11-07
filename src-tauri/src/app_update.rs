//! Self-update from GitHub Releases: a silent check at startup and every few hours, an `update-available` event when a newer
//! version is published, and an install command (download, install, restart) that reports `update-progress`.
//! A failed check (offline, no release yet, bad signature) is logged only; the person is never told.
//! Dev builds never check: the endpoint serves signed release bundles, which a dev run is not.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Pause between two automatic checks.
pub const CHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);
/// Two checks never run closer than this, whoever asks.
pub const MIN_CHECK_GAP: Duration = Duration::from_secs(60);

/// A newer version the person can install now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub current_version: String,
    /// Release notes of the version, when the release has any.
    pub notes: Option<String>,
}

/// Download progress of an install; `percent` is `None` while the size is unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: Option<u8>,
}

/// What the check found and what is waiting to be installed.
#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    announced: Mutex<Option<String>>,
    last_check: Mutex<Option<u64>>,
}

/// Numeric parts of `1.2.3` (a leading `v` and a `-pre`/`+build` tail are ignored); `None` when it is not a version.
fn parse_version(text: &str) -> Option<Vec<u64>> {
    let core = text.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next()?;

    core.split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect()
}

/// Whether `candidate` is a higher version than `current`; anything unreadable is not newer.
pub fn is_newer(current: &str, candidate: &str) -> bool {
    let (Some(mut current), Some(mut candidate)) =
        (parse_version(current), parse_version(candidate))
    else {
        return false;
    };
    let length = current.len().max(candidate.len());

    current.resize(length, 0);
    candidate.resize(length, 0);

    candidate > current
}

/// Whether `version` still has to be announced: it is newer than the running one and not the one announced last.
pub fn should_announce(current: &str, announced: Option<&str>, version: &str) -> bool {
    is_newer(current, version) && announced != Some(version)
}

/// Whether a check may run now: never ran, or the gap since the last one has passed (a clock that went back counts as due).
pub fn is_check_due(last_check: Option<u64>, now: u64, gap: Duration) -> bool {
    match last_check {
        None => true,
        Some(last) => now < last || now - last >= gap.as_secs(),
    }
}

/// Download progress as the payload of `update-progress`; never above 100%.
pub fn progress(downloaded: u64, total: Option<u64>) -> UpdateProgress {
    let percent = total
        .filter(|total| *total > 0)
        .map(|total| (downloaded.saturating_mul(100) / total).min(100) as u8);

    UpdateProgress {
        downloaded,
        total,
        percent,
    }
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The update waiting to be installed, if a check found one (the window may open after the event was sent).
pub fn pending(state: &UpdateState) -> Option<AvailableUpdate> {
    lock(&state.pending).as_ref().map(describe)
}

fn describe(update: &Update) -> AvailableUpdate {
    AvailableUpdate {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
    }
}

/// Asks GitHub for a newer release and announces it once. Every failure is only logged.
pub async fn check(app: &AppHandle) {
    let state = app.state::<UpdateState>();
    let now = now_seconds();

    {
        let mut last_check = lock(&state.last_check);

        if !is_check_due(*last_check, now, MIN_CHECK_GAP) {
            return;
        }

        *last_check = Some(now);
    }

    let found = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => {
            eprintln!("update check unavailable: {error}");
            return;
        }
    };

    let update = match found {
        Ok(Some(update)) => update,
        Ok(None) => return,
        Err(error) => {
            eprintln!("update check failed: {error}");
            return;
        }
    };

    let available = describe(&update);
    let announce = {
        let mut announced = lock(&state.announced);
        let due = should_announce(
            &available.current_version,
            announced.as_deref(),
            &available.version,
        );

        if due {
            *announced = Some(available.version.clone());
        }

        due
    };

    *lock(&state.pending) = Some(update);

    if announce {
        let _ = app.emit("update-available", &available);
    }
}

/// Checks at startup and then every `CHECK_INTERVAL`, for as long as the app runs. Does nothing in a dev build.
pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            check(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

/// Downloads and installs the pending update, reporting `update-progress`, then restarts the app (so it only returns on failure).
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let update = lock(&app.state::<UpdateState>().pending)
        .clone()
        .ok_or("update.nothing_pending")?;
    let mut downloaded: u64 = 0;
    let progress_app = app.clone();

    update
        .download_and_install(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = progress_app.emit("update-progress", progress(downloaded, total));
            },
            || {},
        )
        .await
        .map_err(|error| {
            eprintln!("update install failed: {error}");
            "update.install_failed".to_string()
        })?;

    app.restart()
}

#[cfg(test)]
#[path = "../tests/unit/app_update.rs"]
mod tests;
