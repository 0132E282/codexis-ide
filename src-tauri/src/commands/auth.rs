use super::blocking;
use crate::auth::{self, ClaudeAuth, GithubAuth, GithubProfile, LimitUsage, ProviderStatus};
use crate::cli::{CliKind, Environment};
use crate::profiles::{self, ProfileStore};
use tauri::{AppHandle, Manager};

/// Sign-in state of the AI CLIs (under their active account) and GitHub; runs the tools' status commands off the UI thread.
#[tauri::command]
pub async fn auth_status(app: AppHandle) -> Result<Vec<ProviderStatus>, String> {
    blocking("auth.status_failed", move || {
        let profiles = app.state::<ProfileStore>();

        Ok(auth::status_all(|kind| {
            profiles.active_environment(kind.name())
        }))
    })
    .await
}

/// Sign-in state of one AI CLI under the account `profile`.
#[tauri::command]
pub async fn auth_status_profile(
    app: AppHandle,
    provider: String,
    profile: i64,
) -> Result<ProviderStatus, String> {
    let provider = parse_provider(&provider)?;

    blocking("auth.status_failed", move || {
        let environment = profile_environment(&app, provider, profile)?;

        Ok(provider.auth().status(&environment))
    })
    .await
}

/// Profile (login, display name, public email, avatar) of the GitHub account `gh` is signed in with; runs `gh` and `curl` off the UI thread.
#[tauri::command]
pub async fn github_profile(app: AppHandle) -> Result<GithubProfile, String> {
    blocking("github.profile_unreadable", move || {
        let environment = profile_environment(&app, CliKind::Github, profiles::DEFAULT_PROFILE)?;

        GithubAuth.profile(&environment)
    })
    .await
}

/// Plan usage (session and week limits) of a Claude account, from the CLI's own `/usage`; can take several seconds.
#[tauri::command]
pub async fn claude_usage_profile(
    app: AppHandle,
    profile: i64,
) -> Result<Option<Vec<LimitUsage>>, String> {
    blocking("auth.usage_failed", move || {
        let environment = profile_environment(&app, CliKind::Claude, profile)?;

        Ok(ClaudeAuth.usage(&environment))
    })
    .await
}

/// Starts the login flow of `provider` (`claude`, `codex`, `gemini`, `antigravity` or `github`), for the account `profile` of an AI CLI (the default one when absent); GitHub returns the one-time code to type in the browser; Antigravity returns its sign-in URL and then waits for `auth_submit_code`.
#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    provider: String,
    profile: Option<i64>,
) -> Result<Option<String>, String> {
    let provider = parse_provider(&provider)?;

    blocking("auth.login_failed", move || {
        let environment =
            profile_environment(&app, provider, profile.unwrap_or(profiles::DEFAULT_PROFILE))?;

        provider.auth().start_login(&environment)
    })
    .await
}

/// Gives the authorization code of the sign-in page to the login of `provider` left waiting by `auth_login` (Antigravity); fails when the code is refused.
#[tauri::command]
pub async fn auth_submit_code(
    app: AppHandle,
    provider: String,
    profile: Option<i64>,
    code: String,
) -> Result<(), String> {
    let provider = parse_provider(&provider)?;

    blocking("auth.code_failed", move || {
        let environment =
            profile_environment(&app, provider, profile.unwrap_or(profiles::DEFAULT_PROFILE))?;

        provider.auth().submit_code(&environment, &code)
    })
    .await
}

/// Stops the login of `provider` left waiting by `auth_login`.
#[tauri::command]
pub async fn auth_cancel_login(
    app: AppHandle,
    provider: String,
    profile: Option<i64>,
) -> Result<(), String> {
    let provider = parse_provider(&provider)?;

    blocking("auth.login_failed", move || {
        let environment =
            profile_environment(&app, provider, profile.unwrap_or(profiles::DEFAULT_PROFILE))?;

        provider.auth().cancel_login(&environment);

        Ok(())
    })
    .await
}

/// Signs the account `profile` of `provider` out with the tool's own logout command.
#[tauri::command]
pub async fn auth_logout(
    app: AppHandle,
    provider: String,
    profile: Option<i64>,
) -> Result<(), String> {
    let provider = parse_provider(&provider)?;

    blocking("auth.logout_failed", move || {
        let environment =
            profile_environment(&app, provider, profile.unwrap_or(profiles::DEFAULT_PROFILE))?;

        provider.auth().logout(&environment)
    })
    .await
}

fn parse_provider(name: &str) -> Result<CliKind, String> {
    CliKind::parse(name).ok_or_else(|| "auth.unsupported".to_string())
}

/// Environment of the account `profile` for `kind`.
fn profile_environment(
    app: &AppHandle,
    kind: CliKind,
    profile: i64,
) -> Result<Environment, String> {
    app.state::<ProfileStore>()
        .environment(kind.name(), profile)
        .map_err(|error| error.to_string())
}
