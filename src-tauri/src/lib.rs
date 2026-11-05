pub mod agent;
pub mod attachments;
pub mod auth;
pub mod chats;
pub mod commands;
pub mod credentials;
pub mod db;
pub mod git;
pub mod profiles;
pub mod projects;
pub mod settings;
pub mod tools;
pub mod usage;
pub mod vscode;
pub mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database = db::path(&app.path().app_data_dir()?);
            let store = projects::ProjectStore::load(database.clone());
            let chats = chats::ChatStore::open(database.clone());

            app.manage(commands::AppState::new(store, chats));
            credentials::setup(app, &database)?;
            profiles::setup(app, &database)?;
            usage::setup(app, &database)?;
            settings::setup(app, &database)?;
            tools::setup(app, &database)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace_info,
            commands::projects_list,
            commands::projects_add,
            commands::projects_remove,
            commands::projects_select,
            commands::workspace_tree,
            commands::workspace_read,
            commands::workspace_read_media,
            commands::workspace_write,
            commands::open_in_vscode,
            commands::local_put_file,
            commands::local_changes,
            commands::local_branches,
            commands::local_head,
            commands::local_discard,
            commands::local_commit,
            commands::local_commit_message,
            commands::agent_send,
            commands::attachment_save,
            commands::attachment_read,
            commands::auth_status,
            commands::auth_status_profile,
            commands::claude_usage_profile,
            commands::auth_login,
            commands::auth_logout,
            commands::chat_load,
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
            commands::chat_new,
            commands::chat_list,
            commands::chat_delete,
            commands::chat_save_turn,
            commands::chat_save_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Codexis IDE");
}
