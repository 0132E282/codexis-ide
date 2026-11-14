use crate::{
    activity, app_update, chats, commands, credentials, db, git_history, language_server,
    language_server_config, profiles, projects, remote, settings, terminal, tools, usage,
};
use std::sync::Arc;
use tauri::Manager;

/// Opens the database and puts every store the commands share under Tauri's management, once at start-up.
pub fn register(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let database = db::path(&app.path().app_data_dir()?);
    let store = projects::ProjectStore::load(database.clone());
    let chats = chats::ChatStore::open(database.clone());

    app.manage(commands::AppState::new(store, chats));
    app.manage(terminal::Terminals::default());
    app.manage(git_history::HistoryCache::default());
    app.manage(commands::agent::TurnRegistry::default());
    app.manage(commands::background::BackgroundStore::new(
        app.path().app_data_dir()?,
    ));
    let language_server_settings = language_server_config::setup(app, &database)?;

    app.manage(language_server::LanguageServers::new(Arc::new(
        commands::language_server::WindowSink {
            app: app.handle().clone(),
            config: language_server_settings,
        },
    )));
    app.manage(remote::Remote::default());
    app.manage(app_update::UpdateState::default());
    app_update::start(app.handle());
    credentials::setup(app, &database)?;
    profiles::setup(app, &database)?;
    usage::setup(app, &database)?;
    settings::setup(app, &database)?;
    activity::setup(app, &database)?;
    tools::setup(app, &database)?;

    Ok(())
}
