/** English texts of the group `shell-settings`: key → English. */
export const shellSettingsEnglish: Record<string, string> = {
    'advanced_tab.appearance': 'Appearance',
    'advanced_tab.appearance_dark': 'Dark',
    'advanced_tab.appearance_hint':
        'System: switches between light and dark with the screen of the machine.',
    'advanced_tab.appearance_light': 'Light',
    'advanced_tab.appearance_system': 'System',
    'advanced_tab.code_colors': 'Code colors',
    'advanced_tab.code_colors_auto': 'Same as the interface',
    'advanced_tab.code_colors_dark_cb': 'Dark (colorblind-friendly)',
    'advanced_tab.code_colors_light_cb': 'Light (colorblind-friendly)',
    'advanced_tab.code_colors_hint':
        'Colors of the code in the editor and in the diff view.',
    'advanced_tab.accounts': 'accounts',
    'advanced_tab.accounts_remaining': 'accounts · Remaining:',
    'advanced_tab.ask_every_time': 'Ask every time',
    'advanced_tab.claude_model': 'Claude model',
    'advanced_tab.cli_default': 'CLI default',
    'advanced_tab.codex_model': 'Codex model',
    'advanced_tab.default_cli': 'Default CLI',
    'advanced_tab.display_language_of_the':
        'Display language of the interface.',
    'advanced_tab.language': 'Language',
    'advanced_tab.leave_the_model_empty':
        'Leave the model empty and the CLI picks its own default model.',
    'advanced_tab.move_name_down': 'Move {name} down',
    'advanced_tab.move_name_up': 'Move {name} up',
    'advanced_tab.out_of_tokens': 'Out of tokens:',
    'advanced_tab.switch_ai_automatically_when':
        'Switch AI automatically when the limit is reached',
    'advanced_tab.when_an_ai_reports':
        'When an AI reports its limit is reached, the message is sent again to the next AI in the list. When the whole list is used up, an error is shown. A new AI starts its own conversation, so it does not see earlier turns.',
    'agent_tab.no_agents_configured_yet': 'No agents configured yet.',
    'agent_tab.tools': 'Tools',
    'api_key_section.claude_api_key': 'Claude API key',
    'api_key_section.enter_anew_key': 'Enter a new key to replace it',
    'api_key_section.no_key_yet': 'No key yet',
    'api_key_section.saved_hint': 'Saved ····{hint}',
    'api_key_section.the_api_key_is':
        "The API key is stored in Codexis's database (readable only by the machine owner) and passed to `claude` when chatting. With a key, the CLI is billed through the API instead of the signed-in plan.",
    'character_tab.assistant_name': 'Assistant name',
    'character_tab.assistant_picture': 'Assistant picture',
    'character_tab.choose_apicture': 'Choose a picture',
    'character_tab.could_not_update_the': 'Could not update the picture.',
    'character_tab.count_max_characters': '{count} / {max} characters.',
    'character_tab.custom_instructions': 'Custom instructions',
    'character_tab.email': 'Email',
    'character_tab.username': 'Username',
    'character_tab.for_example_answer_briefly':
        'For example: Answer briefly, prefer Rust examples.',
    'character_tab.hello_iam_your': 'Hello, I am your assistant.',
    'character_tab.name_the_ai_calls': 'Name the AI calls you',
    'character_tab.preview_voice': 'Preview voice',
    'character_tab.remove_picture': 'Remove picture',
    'character_tab.system_default': 'System default',
    'character_tab.upload_picture': 'Upload picture',
    'character_tab.voice': 'Voice',
    'character_tab.voices_available_on_this':
        'Voices available on this machine.',
    'common.ai_assistant': 'AI assistant',
    'common.command': 'Command',
    'common.default': 'Default',
    'common.description': 'Description',
    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.source': 'Source',
    'common.type': 'Type',
    'connect_tab.checking': 'Checking...',
    'connect_tab.phone': 'Phone',
    'connect_tab.scan_the_qr_code':
        'Scan the QR code to control the AI chat from a phone on the same Wi-Fi.',
    'connect_tab.sign_in_runs_each':
        "Sign-in runs each tool's own command (`claude`, `codex`, `gh`); Codexis never sees your password or token.",
    'hook_tab.event': 'Event',
    'hook_tab.no_hooks_configured_yet': 'No hooks configured yet.',
    'ide_settings.could_not_process_the': 'Could not process the image.',
    'ide_settings.the_file_is_not': 'The file is not an image.',
    'mcp_tab.command_url': 'Command / URL',
    'mcp_tab.no_mcp_servers_configured': 'No MCP servers configured yet.',
    'rules_tab.beginning_of_content': 'Beginning of content',
    'rules_tab.no_rules_files_yet': 'No rules files yet.',
    'settings_dialog.advanced': 'Advanced',
    'settings_dialog.advanced_settings': 'Advanced settings',
    'character_tab.could_not_load_github':
        'Could not load the GitHub picture. The name was filled in.',
    'character_tab.use_github_profile': 'Use GitHub profile',
    'settings_dialog.character': 'Profile',
    'settings_dialog.character_advanced_options_skills':
        'Profile, advanced options, skills, agents, MCP, rules and hooks.',
    'settings_dialog.character_settings': 'Profile settings',
    'settings_dialog.saving': 'Saving...',
    'settings_dialog.settings_sections': 'Settings sections',
    'skill_tab.no_skills_configured_yet': 'No skills configured yet.',
    'tool_table.filter_by_name': 'Filter by name...',
    'tool_table.no_items_match_the': 'No items match the filter.',
    'tool_table.this_machine': 'This machine',
    'errors.auth.detail.status': 'Status',
    'errors.auth.detail.version': 'Version',
    'errors.auth.detail.path': 'Path',
    'errors.auth.detail.account': 'Account',
    'errors.auth.detail.auth_method': 'Authentication method',
    'errors.auth.detail.api_provider': 'API provider',
    'errors.auth.detail.organization': 'Organization',
    'errors.auth.detail.plan': 'Plan',
    'errors.auth.detail.git_protocol': 'Git protocol',
    'errors.auth.gh_missing': '`gh` is not installed.',
    'errors.auth.gh_failed': 'Could not run `gh`.',
    'errors.auth.github_signed_out': 'Not signed in to GitHub.',
    'errors.github.profile_unreadable': 'Could not read the GitHub profile.',
    'errors.auth.github_code_failed':
        'Could not get the GitHub verification code.',
    'errors.auth.logout_failed': 'Could not disconnect.',
    'errors.auth.command_missing':
        'Command `{value}` not found. Install it and try again.',
    'errors.auth.command_failed': 'Could not run `{value}`.',
    'errors.auth.status_failed': 'Could not read the sign-in status.',
    'errors.auth.usage_failed': 'Could not read the usage.',
    'errors.auth.login_failed': 'Could not start the sign-in.',
    'errors.auth.unsupported': 'This account is not supported yet.',
    'errors.credentials.invalid': 'The key is not valid.',
    'errors.credentials.save_failed': 'Could not save the key.',
    'errors.credentials.load_failed': 'Could not read the saved key.',
    'errors.profiles.invalid': 'The account name or type is not valid.',
    'errors.profiles.too_many':
        'The maximum number of accounts for this CLI is reached.',
    'errors.profiles.not_found': 'Account not found.',
    'errors.profiles.failed': 'Could not process the account.',
    'errors.settings.invalid': 'The settings are not valid.',
    'errors.settings.save_failed': 'Could not save the settings.',
    'errors.settings.load_failed': 'Could not read the saved settings.',
    'errors.settings.bad_plans_dir':
        'The plans folder must be a relative path inside the project.',
    'errors.activity.load_failed': 'Could not read the saved activity.',
    'errors.activity.save_failed':
        'Could not save the activity to the database.',
    'errors.activity.delete_failed': 'Could not delete the records.',
    'errors.activity.too_many_ids': 'Too many records at once (1000 at most).',
    'errors.chat_images.not_image': 'The file is not a picture.',
    'errors.chat_images.too_large': 'The picture is too large (8 MB at most).',
    'errors.chat_images.not_found': 'The picture is no longer saved.',
    'errors.plan_save.empty': 'There is no plan to save.',
    'errors.plan_save.bad_directory':
        'The plans folder must be a relative path inside the project.',
    'errors.storage.confirm_required': 'Confirm before deleting data.',
    'errors.storage.bad_kind': 'This kind of data cannot be cleaned up.',
    'errors.storage.read_failed': 'Could not measure the stored data.',
    'errors.storage.cleanup_failed': 'Could not clean up the data.',
    'errors.usage.unavailable': 'Could not read the AI statistics.',
    'errors.usage.invalid': 'The AI statistics data is not valid.',
    'speech_engine.label': 'Reading engine',
    'speech_engine.system': 'System',
    'speech_engine.vieneu': 'VieNeu-TTS (local)',
    'speech_engine.hint':
        'System voices often cannot read Vietnamese. VieNeu-TTS reads Vietnamese; other languages still use the system voice.',
    'speech_engine.url': 'VieNeu-TTS server address',
    'speech_engine.check': 'Check connection',
    'speech_engine.checking': 'Checking…',
    'speech_engine.connected': 'Connected, {count} voices.',
    'speech_engine.not_connected': 'Could not reach the server.',
    'speech_engine.voice': 'VieNeu-TTS voice',
    'speech_engine.default_voice': 'Server default',
    'speech_engine.guide':
        'The app does not install or run VieNeu-TTS: you run the server on this machine with `uv sync` then `uv run python -m apps.openai_speech` (port 8000). Only loopback addresses (127.0.0.1, localhost, ::1) are accepted.',
    'speech_engine.license':
        'You install VieNeu-TTS yourself and are responsible for the license of the VieNeu model and voices.',
    'speech_engine.voice_hint':
        "A voice's region shows only when the server says it (a region/accent field or description); otherwise the app keeps the server's default voice.",
    'extensions_tab.title': 'Extensions',
    'extensions_tab.intro':
        'The app shares the language servers of the VS Code extensions already installed on this machine (read-only, no separate download); without one it uses the copy on PATH.',
    'extensions_tab.language': 'Language',
    'extensions_tab.server': 'Server',
    'extensions_tab.source_in_use': 'Source in use',
    'extensions_tab.state': 'State',
    'extensions_tab.enabled': 'On',
    'extensions_tab.not_installed': 'Not installed',
    'extensions_tab.origin_vscode': 'VS Code',
    'extensions_tab.origin_insiders': 'VS Code Insiders',
    'extensions_tab.origin_cursor': 'Cursor',
    'extensions_tab.origin_vscodium': 'VSCodium',
    'extensions_tab.origin_path': 'PATH',
    'extensions_tab.origin_download': 'Download',
    'extensions_tab.source_setting': 'Source',
    'extensions_tab.source_auto': 'Automatic',
    'extensions_tab.source_vscode': 'VS Code extension',
    'extensions_tab.source_path': 'PATH',
    'extensions_tab.source_download': 'Download',
    'extensions_tab.extension_root': 'Editor',
    'extensions_tab.root_any': 'Any',
    'extensions_tab.restart': 'Restart',
    'extensions_tab.stop': 'Stop',
    'extensions_tab.show_log': 'Show log',
    'extensions_tab.found': 'Found',
    'extensions_tab.none_found': 'No source found.',
    'extensions_tab.in_use': 'In use',
    'extensions_tab.log': 'Server log',
    'extensions_tab.log_empty': 'No log yet.',
    'extensions_tab.load_failed': 'Could not load the server list.',
    'extensions_tab.enable_title': 'Turn on {name}?',
    'extensions_tab.enable_warning':
        "A language server may run the project's own build scripts, proc-macros or MSBuild tasks on your machine. Turn it on only for projects you trust.",
    'extensions_tab.intelephense_license':
        'Intelephense has its own license terms from its author.',
    'extensions_tab.enable_action': 'Turn on',
    'extensions_tab.enable_server': 'Turn on {name}',
    'extensions_tab.state_missing': 'Not installed',
    'extensions_tab.state_stopped': 'Stopped',
    'extensions_tab.state_starting': 'Starting',
    'extensions_tab.state_running': 'Running',
    'extensions_tab.state_error': 'Error',
    'language_server.hint_install_extension':
        'Install the {name} extension in VS Code, then reopen this tab.',
    'language_server.hint_install_program':
        'Install {name} and make sure it runs from PATH.',
    'language_server.cannot_rename': 'Cannot rename at this position.',
    'language_server.rename_nothing': 'The server proposed no change.',
    'language_server.rename_title': 'Rename in several places?',
    'language_server.rename_description':
        'These files will be edited: {files}.',
    'language_server.rename_skipped':
        'Skipped (outside the project or blocked): {skipped}.',
    'language_server.rename_action': 'Rename',
    'language_server.external_definition':
        'The definition is outside the project: {path}',
    'errors.language_server.unknown_server':
        'That language server is not in the catalog.',
    'errors.language_server.invalid': 'The source or editor is not valid.',
    'errors.language_server.load_failed':
        'Could not read the language server settings.',
    'errors.language_server.save_failed':
        'Could not save the language server settings.',
    'errors.language_server.disabled': 'The server is not turned on.',
    'errors.language_server.not_installed':
        'No usable server was found to run.',
    'errors.language_server.node_missing':
        'Node.js was not found (Intelephense needs it).',
    'errors.language_server.start_failed': 'The server could not be started.',
    'errors.language_server.too_many':
        'The limit of 8 servers running at once is reached.',
    'errors.language_server.not_running': 'The server is not running.',
    'errors.language_server.not_open': 'The file is not open with the server.',
    'errors.language_server.out_of_sync':
        'The file text is out of step with the server.',
    'errors.language_server.too_large':
        'The file or data is too large for the server.',
    'errors.language_server.timeout': 'The server answered too slowly.',
    'errors.language_server.cancelled': 'The request was cancelled.',
    'errors.language_server.request_failed':
        'The server reported an error for the request.',
    'errors.language_server.unsupported':
        'The server does not support this action.',
    'errors.language_server.bad_request':
        'The request sent to the server is not valid.',
    'errors.language_server.bad_message':
        'The server sent data in a wrong format.',
    'errors.language_server.bad_header':
        'The server sent a wrong message header.',
    'errors.language_server.message_too_large':
        'The server sent a message that is too large.',
    'errors.language_server.closed': 'The server closed the connection.',
    'errors.language_server.encoding_unsupported':
        'The server does not use the UTF-16 encoding the app needs.',
    'errors.language_server.crashed':
        'The server kept failing and was stopped. Restart it.',
    'errors.language_server.extension_changed':
        'The server file changed (the extension was just updated). Restart it.',
    'errors.language_server.unavailable':
        'The language server service is temporarily unavailable.',
    'errors.language_server.obsolete': 'This version is too old.',
    'errors.language_server.platform_mismatch':
        'This build is not for the current operating system.',
    'errors.language_server.symlink_outside':
        'The file is a link pointing outside the extension folder.',
    'errors.language_server.bad_manifest':
        'The extension information could not be read.',
    'errors.language_server.not_executable': 'The server file cannot be run.',
    'errors.language_server.version_check_failed':
        'The server version could not be checked.',
    'errors.language_server.path_name_rejected':
        'The file name found on PATH is not accepted.',
};
