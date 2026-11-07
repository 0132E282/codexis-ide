pub mod agent;
pub mod app_update;
pub mod attachments;
pub mod auth;
pub mod background;
pub mod chats;
pub mod cli;
pub mod commands;
pub mod context;
pub mod credentials;
pub mod db;
pub mod formatter;
pub mod git;
pub mod migrations;
pub mod permission;
pub mod plan;
pub mod plan_store;
pub mod profiles;
pub mod project_data;
pub mod projects;
pub mod relay;
pub mod remote;
pub mod run_log;
pub mod seeders;
pub mod session_rail;
pub mod settings;
pub mod sql;
pub mod terminal;
pub mod tools;
pub mod usage;
pub mod validation;
pub mod vscode;
pub mod window_buttons;
pub mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let database = db::path(&app.path().app_data_dir()?);
            let store = projects::ProjectStore::load(database.clone());
            let chats = chats::ChatStore::open(database.clone());

            app.manage(commands::AppState::new(store, chats));
            app.manage(terminal::Terminals::default());
            app.manage(commands::agent::TurnRegistry::default());
            app.manage(commands::background::BackgroundStore::new(
                app.path().app_data_dir()?,
            ));
            app.manage(remote::Remote::default());
            app.manage(app_update::UpdateState::default());
            app_update::start(app.handle());
            credentials::setup(app, &database)?;
            profiles::setup(app, &database)?;
            usage::setup(app, &database)?;
            settings::setup(app, &database)?;
            tools::setup(app, &database)?;
            window_buttons::hide_at_startup(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::files::workspace_info,
            commands::projects::projects_list,
            commands::projects::projects_add,
            commands::projects::projects_remove,
            commands::projects::projects_select,
            commands::files::workspace_tree,
            commands::files::workspace_read,
            commands::files::workspace_read_media,
            commands::files::workspace_write,
            commands::files::format_code,
            commands::files::open_in_vscode,
            commands::terminal::terminal_open,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::remote::remote_start,
            commands::remote::remote_stop,
            commands::remote::remote_status,
            commands::session_rail::session_rail_environment,
            commands::session_rail::session_rail_outputs,
            commands::session_rail::session_rail_github,
            commands::session_rail::session_rail_usage,
            commands::files::local_put_file,
            commands::files::workspace_rename,
            commands::git::local_changes,
            commands::git::local_branches,
            commands::git::local_head,
            commands::git::local_discard,
            commands::git::local_commit,
            commands::git::local_commit_message,
            commands::inline_ask::inline_ask,
            commands::agent::agent_send,
            commands::agent::agent_permission,
            commands::agent::agent_stop,
            commands::background::background_list,
            commands::background::background_stop,
            commands::background::background_clear,
            commands::attachments::attachment_save,
            commands::attachments::attachment_read,
            commands::auth::auth_status,
            commands::auth::auth_status_profile,
            commands::auth::claude_usage_profile,
            commands::auth::auth_login,
            commands::auth::github_profile,
            commands::auth::auth_logout,
            commands::chat::chat_load,
            commands::plan::plan_load,
            profiles::profiles_list,
            profiles::profile_add,
            profiles::profile_remove,
            profiles::profile_rename,
            profiles::profile_select,
            credentials::credential_status,
            credentials::credential_save,
            credentials::credential_remove,
            usage::usage_record,
            usage::usage_stats,
            usage::usage_stats_profile,
            settings::settings_get,
            settings::settings_save,
            tools::tools_skills,
            tools::tools_agents,
            tools::tools_mcp,
            tools::tools_rules,
            tools::tools_hooks,
            commands::chat::chat_new,
            commands::chat::chat_list,
            commands::chat::chat_delete,
            commands::chat::chat_save_turn,
            commands::chat::chat_save_session,
            window_buttons::window_buttons_visible,
            commands::app_update::update_pending,
            commands::app_update::update_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Codexis IDE")
        .run(|app, event| {
            // * No turn may outlive the app: its CLI (and the background tasks it holds) is stopped.
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<commands::agent::TurnRegistry>().stop_all();
                app.state::<commands::background::BackgroundStore>()
                    .stop_all();
            }
        });
}
