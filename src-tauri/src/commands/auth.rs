use super::blocking;
use crate::auth::{self, Environment, LimitUsage, Provider, ProviderStatus};
use crate::profiles::{self, ProfileStore};
use tauri::{AppHandle, Manager};

/// Sign-in state of the AI CLIs (under their active account) and GitHub; runs the tools' status commands off the UI thread.
#[tauri::command]
pub async fn auth_status(app: AppHandle) -> Result<Vec<ProviderStatus>, String> {
    blocking(
        "Không đọc được trạng thái đăng nhập.",
        move || {
            let profiles = app.state::<ProfileStore>();

            Ok(auth::status_all(|provider| {
                provider
                    .cli()
                    .map(|cli| profiles.active_environment(cli))
                    .unwrap_or_default()
            }))
        },
    )
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

    blocking(
        "Không đọc được trạng thái đăng nhập.",
        move || {
            let environment = profile_environment(&app, provider, profile)?;

            Ok(auth::status(provider, &environment))
        },
    )
    .await
}

/// Plan usage (session and week limits) of a Claude account, from the CLI's own `/usage`; can take several seconds.
#[tauri::command]
pub async fn claude_usage_profile(
    app: AppHandle,
    profile: i64,
) -> Result<Option<Vec<LimitUsage>>, String> {
    blocking("Không đọc được usage.", move || {
        let environment = profile_environment(&app, Provider::Claude, profile)?;

        Ok(auth::claude_usage(&environment))
    })
    .await
}

/// Starts the login flow of `provider` (`claude`, `codex` or `github`), for the account `profile` of an AI CLI (the default one when absent); GitHub returns the one-time code to type in the browser.
#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    provider: String,
    profile: Option<i64>,
) -> Result<Option<String>, String> {
    let provider = parse_provider(&provider)?;

    blocking("Không bắt đầu được đăng nhập.", move || {
        let environment =
            profile_environment(&app, provider, profile.unwrap_or(profiles::DEFAULT_PROFILE))?;

        auth::start_login(provider, &environment)
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

    blocking("Không ngắt được kết nối.", move || {
        let environment =
            profile_environment(&app, provider, profile.unwrap_or(profiles::DEFAULT_PROFILE))?;

        auth::logout(provider, &environment)
    })
    .await
}

fn parse_provider(name: &str) -> Result<Provider, String> {
    Provider::parse(name).ok_or_else(|| "Chưa hỗ trợ tài khoản này.".to_string())
}

/// Environment of the account `profile` for `provider`.
fn profile_environment(
    app: &AppHandle,
    provider: Provider,
    profile: i64,
) -> Result<Environment, String> {
    let Some(cli) = provider.cli() else {
        return Ok(Vec::new());
    };

    app.state::<ProfileStore>()
        .environment(cli, profile)
        .map_err(|error| error.to_string())
}
