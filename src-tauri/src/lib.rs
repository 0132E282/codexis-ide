pub mod activity;
pub mod agent;
pub mod app_menu;
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
pub mod git_history;
pub mod language_server;
pub mod language_server_catalog;
pub mod language_server_config;
pub mod language_server_convert;
pub mod language_server_install;
pub mod language_server_protocol;
pub mod linter;
pub mod migrations;
pub mod models;
pub mod permission;
pub mod plans;
pub mod profiles;
pub mod project_data;
pub mod projects;
pub mod relay;
pub mod remote;
pub mod run_log;
pub mod seeders;
pub mod session_rail;
pub mod settings;
pub mod speech;
pub mod sql;
pub mod storage;
pub mod terminal;
pub mod tools;
pub mod usage;
pub mod validation;
pub mod vscode;
pub mod vscode_extensions;
pub mod window_buttons;
pub mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(app_menu::build)
        .on_menu_event(|app, event| app_menu::handle_event(app, &event))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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

            app.manage(language_server::LanguageServers::new(std::sync::Arc::new(
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
            commands::files::lint_code,
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
            commands::files::workspace_create,
            commands::files::workspace_copy,
            commands::files::workspace_move,
            commands::files::workspace_import,
            commands::git::local_changes,
            commands::git::local_branches,
            commands::git::local_head,
            commands::git::local_discard,
            commands::git::local_commit,
            commands::git::local_commit_message,
            commands::git::local_pull,
            commands::git::local_git_preview,
            commands::git::git_log,
            commands::git::git_commit_files,
            commands::git::git_commit_file_diff,
            commands::git::git_file_history,
            commands::git::git_blame,
            commands::git::git_branches_info,
            commands::git::git_branch_compare,
            commands::git::git_checkout,
            commands::git::git_merge,
            commands::git::git_pull,
            commands::git::git_outgoing,
            commands::git::git_push,
            commands::inline_ask::inline_ask,
            commands::language_server::language_server_list,
            commands::language_server::language_server_configure,
            commands::language_server::language_server_install,
            commands::language_server::language_server_uninstall,
            commands::language_server::language_server_restart,
            commands::language_server::language_server_stop,
            commands::language_server::language_server_log,
            commands::language_server::language_server_document_open,
            commands::language_server::language_server_document_change,
            commands::language_server::language_server_document_save,
            commands::language_server::language_server_document_close,
            commands::language_server::language_server_request,
            commands::language_server::language_server_apply_edit,
            commands::agent::agent_send,
            commands::agent::agent_permission,
            commands::agent::agent_stop,
            commands::background::background_list,
            commands::background::background_stop,
            commands::background::background_clear,
            commands::attachments::attachment_save,
            commands::attachments::attachment_read,
            commands::attachments::chat_image_read,
            commands::auth::auth_status,
            commands::auth::auth_status_profile,
            commands::auth::claude_usage_profile,
            commands::auth::auth_login,
            commands::auth::github_profile,
            commands::auth::auth_logout,
            commands::chat::chat_load,
            commands::plan::plan_load,
            commands::plan::plan_docs_list,
            commands::plan::plan_doc_read,
            commands::plan::plan_doc_set_status,
            commands::plan::plan_doc_delete,
            commands::activity::file_events_list,
            commands::activity::file_events_delete,
            commands::activity::file_events_clear,
            commands::activity::chat_images_list,
            commands::activity::chat_image_get,
            commands::activity::chat_images_delete,
            commands::activity::plan_records_list,
            commands::activity::plan_records_delete,
            commands::activity::plan_records_sync,
            commands::activity::plan_save_to_project,
            commands::storage::storage_usage,
            commands::storage::storage_cleanup,
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
            commands::speech::speech_status,
            commands::agent::agent_models,
            commands::speech::speech_synthesize,
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
            commands::chat::chat_grid_get,
            commands::chat::chat_grid_save,
            window_buttons::window_buttons_visible,
            window_buttons::window_is_fullscreen,
            commands::app_update::update_pending,
            commands::app_update::update_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Codexis IDE")
        .run(|app, event| {
            // * No turn may outlive the app: its CLI (and the background tasks it holds) is stopped.
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<commands::agent::TurnRegistry>().stop_all();
                app.state::<language_server::LanguageServers>().stop_all();
                app.state::<commands::background::BackgroundStore>()
                    .stop_all();
            }
        });
}
