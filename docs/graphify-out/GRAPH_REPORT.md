# Graph Report - codexis-ide (2026-11-11)

## Corpus Check

- Large corpus: 587 files · ~378,650 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary

- 5300 nodes · 14381 edges · 220 communities (208 shown, 12 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 682 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)

- App Shell & Terminal
- Editor Toolbar & Dialogs
- UI Primitives & Forms
- Rich Editor & File Cards
- Code Viewer & Avatars
- Chat Images & Changes Panel
- Branch Popover & Helpers
- Rust Validation
- Markdown, Mermaid & Choices
- Speech & Networking (Rust)
- Frontend Dependencies
- PTY Terminal (Rust)
- Tools & Project Sandbox (Rust)
- Logos & Message List
- Language Server Catalog
- Git Changes (Rust)
- Agent Commands
- Language Server Commands
- VS Code Extensions
- Language Server Hook (TS)
- LSP Document Sync
- Settings Tabs
- Git History & Blame
- Chat Settings (Rust)
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 216
- Community 218

## God Nodes (most connected - your core abstractions)

1. `t()` - 293 edges
2. `cn()` - 214 edges
3. `react` - 173 edges
4. `Button()` - 147 edges
5. `AppState` - 130 edges
6. `lucide-react` - 89 edges
7. `Workspace` - 73 edges
8. `CliKind` - 63 edges
9. `LanguageServers` - 49 edges
10. `ActivityStore` - 47 edges

## Surprising Connections (you probably didn't know these)

- `(.claude copy) rust-best-practices skill` --semantically_similar_to--> `rust-best-practices skill` [INFERRED] [semantically similar]
  .claude/skills/rust-best-practices/SKILL.md → .agents/skills/rust-best-practices/SKILL.md
- `(.claude copy) Bevy digest` --semantically_similar_to--> `Bevy digest` [INFERRED] [semantically similar]
  .claude/skills/rust-best-practices/references/bevy.md → .agents/skills/rust-best-practices/references/bevy.md
- `(.claude copy) Effective Rust digest` --semantically_similar_to--> `Effective Rust digest` [INFERRED] [semantically similar]
  .claude/skills/rust-best-practices/references/effective-rust.md → .agents/skills/rust-best-practices/references/effective-rust.md
- `(.claude copy) Microsoft Pragmatic Rust Guidelines digest` --semantically_similar_to--> `Microsoft Pragmatic Rust Guidelines digest` [INFERRED] [semantically similar]
  .claude/skills/rust-best-practices/references/microsoft-rust-guidelines.md → .agents/skills/rust-best-practices/references/microsoft-rust-guidelines.md
- `(.claude copy) Rust API Guidelines digest` --semantically_similar_to--> `Rust API Guidelines digest` [INFERRED] [semantically similar]
  .claude/skills/rust-best-practices/references/rust-api-guidelines.md → .agents/skills/rust-best-practices/references/rust-api-guidelines.md

## Import Cycles

- 2-file cycle: `src-tauri/src/auth.rs -> src-tauri/src/auth/claude.rs -> src-tauri/src/auth.rs`
- 2-file cycle: `src-tauri/src/auth.rs -> src-tauri/src/auth/antigravity.rs -> src-tauri/src/auth.rs`
- 2-file cycle: `src-tauri/src/auth.rs -> src-tauri/src/auth/codex.rs -> src-tauri/src/auth.rs`
- 2-file cycle: `src-tauri/src/auth.rs -> src-tauri/src/auth/gemini.rs -> src-tauri/src/auth.rs`
- 2-file cycle: `src-tauri/src/auth.rs -> src-tauri/src/auth/github.rs -> src-tauri/src/auth.rs`
- 2-file cycle: `src-tauri/src/commands/agent.rs -> src-tauri/src/commands/background.rs -> src-tauri/src/commands/agent.rs`
- 2-file cycle: `src-tauri/src/agent.rs -> src-tauri/src/agent/claude.rs -> src-tauri/src/agent.rs`
- 2-file cycle: `src-tauri/src/agent.rs -> src-tauri/src/agent/codex.rs -> src-tauri/src/agent.rs`
- 2-file cycle: `src-tauri/src/agent.rs -> src-tauri/src/agent/antigravity.rs -> src-tauri/src/agent.rs`
- 2-file cycle: `src-tauri/src/agent.rs -> src-tauri/src/agent/ollama.rs -> src-tauri/src/agent.rs`
- 2-file cycle: `src-tauri/src/commands/projects.rs -> src-tauri/src/commands/state.rs -> src-tauri/src/commands/projects.rs`
- 2-file cycle: `src-tauri/src/language_server.rs -> src-tauri/src/language_server/connection.rs -> src-tauri/src/language_server.rs`
- 2-file cycle: `src-tauri/src/language_server.rs -> src-tauri/src/language_server/edits.rs -> src-tauri/src/language_server.rs`
- 2-file cycle: `src-tauri/src/language_server.rs -> src-tauri/src/language_server/request.rs -> src-tauri/src/language_server.rs`

## Hyperedges (group relationships)

- **Rust style guide digests feeding rust-best-practices** — agents_skills_rust_best_practices_references_effective_rust, agents_skills_rust_best_practices_references_google_rust_style_guide, agents_skills_rust_best_practices_references_microsoft_rust_guidelines, agents_skills_rust_best_practices_references_rust_api_guidelines, agents_skills_rust_best_practices_references_rust_design_patterns, agents_skills_rust_best_practices_skill [EXTRACTED 1.00]
- **Rust skills trio (best-practices, port, review)** — agents_skills_rust_best_practices_skill, agents_skills_rust_port_skill, agents_skills_rust_review_skill [EXTRACTED 1.00]
- **Design system doc set** — docs_design_design, docs_design_components, docs_design_design_field_rule, docs_design_components_field_component [INFERRED 0.85]
- **AI relay: role prompt, hop prompt, hop driver and limits** — prompts_chat_role, prompts_chat_relay_hop, docs_system_ai_relay_relay_drive, docs_system_ai_relay_hop_limits [EXTRACTED 0.95]
- **Dock panes sharing placement and per-project storage conventions** — docs_system_plan_pane, docs_system_background_tasks, docs_system_side_chat, docs_system_pane_placement, docs_system_session_rail [EXTRACTED 0.90]
- **New agent-event variants emitted from CLI parsing (Context, Plan, Background, Speaker)** — docs_system_context_panel_event_context, docs_system_plan_pane_event_plan, docs_system_background_tasks_system_events, docs_system_ai_relay_speaker_event [INFERRED 0.85]
- **Group layout evidence screenshots** — docs_plans_group_layout_20261108_evidence_g2wide, docs_plans_group_layout_20261108_evidence_g4wide, docs_plans_group_layout_20261108_evidence_wide, docs_plans_group_layout_20261108_evidence_wide_g02 [INFERRED 0.85]
- **Codexis app icon size variants** — src_tauri_icons_128x128, src_tauri_icons_128x128_2x, src_tauri_icons_32x32 [EXTRACTED 1.00]
- **Codexis icon size variants** — src_tauri_icons_64x64, src_tauri_icons_square107x107logo, src_tauri_icons_square142x142logo, src_tauri_icons_square150x150logo, src_tauri_icons_square284x284logo [EXTRACTED 0.95]
- **Codexis icon size/shape variants** — src_tauri_icons_storelogo, src_tauri_icons_android_mipmap_hdpi_ic_launcher, src_tauri_icons_android_mipmap_hdpi_ic_launcher_foreground, src_tauri_icons_android_mipmap_hdpi_ic_launcher_round, src_tauri_icons_android_mipmap_mdpi_ic_launcher [INFERRED 0.85]
- **Android launcher icon variants sharing code-brackets logo** — src_tauri_icons_android_mipmap_mdpi_ic_launcher_foreground, src_tauri_icons_android_mipmap_mdpi_ic_launcher_round, src_tauri_icons_android_mipmap_xhdpi_ic_launcher, src_tauri_icons_android_mipmap_xhdpi_ic_launcher_foreground, src_tauri_icons_android_mipmap_xhdpi_ic_launcher_round [INFERRED 0.85]
- **Codexis app icon set (same </> logo across platforms)** — src_tauri_icons_icon, src_tauri_icons_android_mipmap_xxxhdpi_ic_launcher_round, src_tauri_icons_ios_appicon_20x20_1x, src_tauri_icons_ios_appicon_20x20_2x_1, src_tauri_icons_ios_appicon_20x20_2x [INFERRED 0.95]
- **iOS AppIcon size variants** — src_tauri_icons_ios_appicon_60x60_2x, src_tauri_icons_ios_appicon_60x60_3x, src_tauri_icons_ios_appicon_76x76_1x, src_tauri_icons_ios_appicon_76x76_2x, src_tauri_icons_ios_appicon_83_5x83_5_2x [EXTRACTED 1.00]

## Communities (220 total, 12 thin omitted)

### Community 0 - "App Shell & Terminal"

Cohesion: 0.03
Nodes (110): App(), BottomHostSlot(), ActivityTerminal(), shellQuote(), ShellTerminal(), TerminalSessions, THEME, useTerminalSessions() (+102 more)

### Community 1 - "Editor Toolbar & Dialogs"

Cohesion: 0.05
Nodes (102): AssistantAvatar(), CursorPosition(), EditorToolbar(), RenameDialog(), CommitActions(), MessageForm, MessagePopup(), InlineAsk() (+94 more)

### Community 2 - "UI Primitives & Forms"

Cohesion: 0.05
Nodes (72): radix-ui, react, react-hook-form, FormRecordIdContext, useFormRecordId(), AutoSyncField(), AutoSyncFieldProps, CheckboxGroupField() (+64 more)

### Community 3 - "Rich Editor & File Cards"

Cohesion: 0.09
Nodes (69): lucide-react, @tiptap/react, EditorOptionsMenu(), FileBlock(), ICONS, ComposerTools(), Inert(), NOT_AVAILABLE (+61 more)

### Community 4 - "Code Viewer & Avatars"

Cohesion: 0.05
Nodes (69): AssistantIdentity, CodeViewer(), CHANGE_BADGES, CHANGES_PANEL_DEFAULT_WIDTH, CHAT_OPEN_WIDTH, FILE_PANEL_DEFAULT_WIDTH, LIVE_REFRESH_MS, SIDEBAR_WIDTH (+61 more)

### Community 5 - "Chat Images & Changes Panel"

Cohesion: 0.06
Nodes (74): axios, sonner, @tauri-apps/api, ChatImage(), LocalImage(), ChangesPanel(), OutgoingCommits(), buildTree() (+66 more)

### Community 6 - "Branch Popover & Helpers"

Cohesion: 0.05
Nodes (69): class-variance-authority, @tiptap/core, BranchName(), errorText(), fetchLocalBranches(), Heading(), LocalBranches, LocalBranchList() (+61 more)

### Community 7 - "Rust Validation"

Cohesion: 0.03
Nodes (79): api_key_rule(), ApiKey, Avatar, avatar_rule(), AVATAR_TYPES, base64_head(), branch_rule(), BranchName (+71 more)

### Community 8 - "Markdown, Mermaid & Choices"

Cohesion: 0.05
Nodes (65): isLocalImagePath(), ChoiceCard(), ChoiceHandlers, CodeBlock(), DiffView(), ROW_CLASS, baseComponents, buildComponents() (+57 more)

### Community 9 - "Speech & Networking (Rust)"

Cohesion: 0.06
Nodes (61): speech_status(), speech_synthesize(), BASE64_ALPHABET, base64_encode(), connect(), CONNECT_TIMEOUT, detect_region(), finish_response() (+53 more)

### Community 10 - "Frontend Dependencies"

Cohesion: 0.04
Nodes (69): dependencies, axios@^1.18.1, class-variance-authority@^0.7.1, clsx@^2.1.1, @hookform/resolvers@^5.4.0, @inertiajs/react@^3.0.0, lucide-react@^0.475.0, mermaid@^12.3.0 (+61 more)

### Community 11 - "PTY Terminal (Rust)"

Cohesion: 0.05
Nodes (36): terminal_close(), terminal_open(), terminal_resize(), terminal_window_open(), terminal_window_root(), terminal_write(), WINDOW_LABEL, WINDOW_TABS (+28 more)

### Community 12 - "Tools & Project Sandbox (Rust)"

Cohesion: 0.09
Nodes (48): allowed_project(), Base, clean_url(), collect(), entry(), excerpt(), front_matter(), home_folder() (+40 more)

### Community 13 - "Logos & Message List"

Cohesion: 0.08
Nodes (53): Codex logo (OpenAI-style knot icon, black on white), Codexis IDE logo (white code brackets on black rounded square), AttachmentView(), IMAGE_TYPES, MessageList, waitForSession(), READ_ONLY_CHOICES, SubagentView() (+45 more)

### Community 14 - "Language Server Catalog"

Cohesion: 0.06
Nodes (45): cached_version(), Candidate, CandidateOrigin, Cursor, Download, Insiders, Path, Vscode (+37 more)

### Community 15 - "Git Changes (Rust)"

Cohesion: 0.08
Nodes (32): ChangesReply, CommitMessage, git_blame(), git_branch_compare(), git_branches_info(), git_checkout(), git_commit_file_diff(), git_commit_files() (+24 more)

### Community 16 - "Agent Commands"

Cohesion: 0.06
Nodes (16): agent_send(), agent_stop(), AgentPayload, HopObserver, HopObserver<'a>, MAX_PENDING_EDITS, mode_for_hop(), ObservedProject (+8 more)

### Community 17 - "Language Server Commands"

Cohesion: 0.10
Nodes (41): BAD_REQUEST, DISABLED, DocumentOpened, FileEdits, info_for(), INVALID, known(), language_server_apply_edit() (+33 more)

### Community 18 - "VS Code Extensions"

Cohesion: 0.07
Nodes (47): compare_pre_release(), current_platform(), ExtensionOrigin, .ALL, Cursor, Insiders, Vscode, Vscodium (+39 more)

### Community 19 - "Language Server Hook (TS)"

Cohesion: 0.06
Nodes (54): renameDescription(), SUPPORTED, toChange(), useLanguageServer(), ApplyEditResult, CandidateOrigin, CompletionItem, CompletionResult (+46 more)

### Community 20 - "LSP Document Sync"

Cohesion: 0.09
Nodes (11): did_change_params(), did_open_params(), Document, incremental_sync(), Inner, Key, Limits, lock() (+3 more)

### Community 21 - "Settings Tabs"

Cohesion: 0.08
Nodes (47): AdvancedTab(), APPEARANCES, Choice(), CODE_COLORS, CharacterTab(), RATES, REGIONS, SpeechEngineSection() (+39 more)

### Community 22 - "Git History & Blame"

Cohesion: 0.05
Nodes (39): BlameLine, CacheInner, CacheKey, Blame, Branches, CommitFileDiff, CommitFiles, Log (+31 more)

### Community 23 - "Chat Settings (Rust)"

Cohesion: 0.08
Nodes (22): ChatSettings, CLAUDE_PLANS, CODEX_PLANS, KEY, MAX_AVATAR_BYTES, MAX_INSTRUCTIONS_CHARS, MAX_NAME_CHARS, MAX_URL_CHARS (+14 more)

### Community 24 - "Community 24"

Cohesion: 0.08
Nodes (21): account_in_log(), AntigravityAuth, check_code(), KEPT_OUTPUT_CHARS, latest_account(), log_folder(), Login, login_key() (+13 more)

### Community 25 - "Community 25"

Cohesion: 0.15
Nodes (9): Access, copy_entry(), file_name(), free_name(), in_denied_directory(), join_relative(), Result, Workspace (+1 more)

### Community 26 - "Community 26"

Cohesion: 0.11
Nodes (19): create_private_folder(), DEFAULT_NAME, DEFAULT_PROFILE, MAX_NAME_CHARS, MAX_PER_CLI, Profile, profile_add(), profile_remove() (+11 more)

### Community 27 - "Community 27"

Cohesion: 0.06
Nodes (28): CliKind, .AGENTS, .ALL, Antigravity, Claude, Codex, Gemini, Github (+20 more)

### Community 28 - "Community 28"

Cohesion: 0.08
Nodes (38): app_dirs(), bytes(), CHAT_HISTORY_CRITICAL_BYTES, CHAT_HISTORY_CRITICAL_COUNT, CHAT_HISTORY_WARNING_BYTES, CHAT_HISTORY_WARNING_COUNT, count(), database_bytes() (+30 more)

### Community 29 - "Community 29"

Cohesion: 0.09
Nodes (24): Branches, Change, ChangeStatus, Added, Deleted, Modified, git_changes(), GitError (+16 more)

### Community 30 - "Community 30"

Cohesion: 0.07
Nodes (27): diagnostic(), DiagnosticsEvent, display_path(), apply_file_edits(), ApplyReport, FailedEdit, FileEdit, prepare_edit() (+19 more)

### Community 31 - "Community 31"

Cohesion: 0.10
Nodes (22): checked_env(), EnvVar, LEGACY_IMPORTED, MAX_ENV_KEY_BYTES, MAX_ENV_VALUE_BYTES, MAX_ENV_VARS, MAX_FOLDERS, MAX_NAME_CHARS (+14 more)

### Community 32 - "Community 32"

Cohesion: 0.07
Nodes (14): AntigravityAgent, asks_person(), ClaudeAgent, CodexAgent, EventFilter, MODES, OllamaAgent, ANTIGRAVITY (+6 more)

### Community 33 - "Community 33"

Cohesion: 0.10
Nodes (35): Blocks(), checklistTask(), ItemList(), Load, PlanDetail(), Section(), EVIDENCE_GROUPS, EvidenceGroup (+27 more)

### Community 34 - "Community 34"

Cohesion: 0.12
Nodes (19): bind(), column_list(), delete_where(), execute(), find_by_key(), integer(), list_ordered(), query_all() (+11 more)

### Community 35 - "Community 35"

Cohesion: 0.08
Nodes (33): CHAT_ROLE, context_event(), cut(), file_change(), is_background_launch(), is_subagent_call(), MAX_TOOL_DETAIL_CHARS, MAX_TOOL_IMAGE_CHARS (+25 more)

### Community 36 - "Community 36"

Cohesion: 0.12
Nodes (13): ActivityError, DeleteFailed, ImageNotFound, ImageNotImage, ImageTooLarge, LoadFailed, SaveFailed, TooManyIds (+5 more)

### Community 37 - "Community 37"

Cohesion: 0.21
Nodes (18): checked_hash(), checked_local_branch(), checked_ref(), command(), ensure_repository(), GitHistory<'a>, is_hash(), log_format() (+10 more)

### Community 38 - "Community 38"

Cohesion: 0.10
Nodes (33): apply_change(), line_break_end(), offset_of(), path_to_uri(), uri_to_relative(), a_backwards_range_changes_nothing(), a_file_that_is_not_there_yet_is_still_judged_by_its_path(), a_length_at_the_limit_is_allowed() (+25 more)

### Community 39 - "Community 39"

Cohesion: 0.17
Nodes (33): candidates(), spec_for_path(), a_program_in_path_is_used_and_its_version_read(), a_program_whose_version_check_fails_is_not_used(), a_server_file_that_links_out_of_the_extension_is_left_out(), a_server_inside_a_vscode_extension_is_found_with_its_version_and_origin(), a_server_the_app_installed_is_found_and_taken_last(), a_server_without_the_execute_bit_is_left_out_with_a_reason() (+25 more)

### Community 40 - "Community 40"

Cohesion: 0.09
Nodes (11): AgentCli, CliKind, Done, is_result_line(), language_rule(), Responder, TurnObserver, TurnRequest (+3 more)

### Community 41 - "Community 41"

Cohesion: 0.08
Nodes (24): content_length(), FILE_SCHEME, find(), HEADER_END, Incoming, Notification, Request, Response (+16 more)

### Community 42 - "Community 42"

Cohesion: 0.10
Nodes (24): CHARACTERS_PER_TOKEN, CliUsage, DAY_SECONDS, DAYS_IN_WEEK, HOUR_SECONDS, HOURS_IN_DAY, INVALID, is_limit_error() (+16 more)

### Community 43 - "Community 43"

Cohesion: 0.15
Nodes (8): Connection, CONTENT_MODIFIED, is_cancellation(), kill_group(), REQUEST_CANCELLED, SERVER_CANCELLED, EXIT_GRACE, RpcError

### Community 44 - "Community 44"

Cohesion: 0.11
Nodes (27): completion(), completion_item(), DocumentChange, editor_range(), EditorPosition, EditorRange, escape_markdown(), hover() (+19 more)

### Community 45 - "Community 45"

Cohesion: 0.17
Nodes (28): a_change_that_does_not_fit_leaves_the_document_alone(), a_request_without_an_answer_times_out_and_is_cancelled(), a_server_that_wants_the_whole_text_gets_it_from_the_mirror(), a_server_without_a_prepare_provider_is_answered_from_the_text(), change(), changes_bump_the_version_and_the_mirror_follows_the_editor(), closing_forgets_the_document_and_tells_the_server(), completion_items_can_be_resolved_until_the_next_completion() (+20 more)

### Community 46 - "Community 46"

Cohesion: 0.10
Nodes (24): EXTRA_BIN_DIRS, locate(), search_path(), EXTENSIONS, format(), prettier(), try_format(), eslint() (+16 more)

### Community 47 - "Community 47"

Cohesion: 0.10
Nodes (28): @monaco-editor/react, MonacoDiff(), COMMON_COLORS, FILE_NAMES, LANGUAGES, LOG_COLORS, monacoTheme(), READ_ONLY_OPTIONS (+20 more)

### Community 48 - "Community 48"

Cohesion: 0.17
Nodes (28): a_branch_named_like_an_option_is_never_read_as_one(), blame_maps_lines_to_commits_and_marks_uncommitted_ones(), blame_refuses_binary_big_untracked_and_denied_files(), branches_info_and_compare_count_ahead_and_behind(), cached(), cached_blame_follows_file_edits_and_commits(), cached_branches_info_follows_new_branches(), cached_commit_files_and_diffs_do_not_run_git_again() (+20 more)

### Community 49 - "Community 49"

Cohesion: 0.07
Nodes (28): ACTIVITY_EVENTS, ChatImage, ChatImageData, FileEvent, FileEventAction, FileEventFilters, FileEventSource, ideActivity (+20 more)

### Community 50 - "Community 50"

Cohesion: 0.11
Nodes (20): Locations, storage_cleanup(), storage_usage(), Cleaned, cleanup(), CleanupKind, ChatImages, FileEvents (+12 more)

### Community 51 - "Community 51"

Cohesion: 0.11
Nodes (27): api_key(), avatar(), branch_name_rules(), check(), commit_message(), commit_message_rules(), display_name(), display_name_bounds() (+19 more)

### Community 52 - "Community 52"

Cohesion: 0.13
Nodes (15): ChatHistory, ChatStore, ChatTurn, ConversationSize, GridMember, MAX_ANSWER_BYTES, MAX_GROUP, MAX_TITLE_CHARS (+7 more)

### Community 53 - "Community 53"

Cohesion: 0.08
Nodes (21): ai_edit_path(), base64_data_url_bytes(), ChatImage, EDIT_TOOLS, file_event_clause(), FileEvent, FileEventFilter, FileSource (+13 more)

### Community 54 - "Community 54"

Cohesion: 0.08
Nodes (24): Guarded, PathPolicy, Unguarded, relative_to_root(), denied(), DENIED_DIRECTORIES, DENIED_NAMES, glob() (+16 more)

### Community 55 - "Community 55"

Cohesion: 0.12
Nodes (20): ImageData, auto_save_plan(), chat_image_get(), chat_images_delete(), chat_images_list(), FILE_EVENT_LOG_FAILED, file_events_clear(), file_events_delete() (+12 more)

### Community 56 - "Community 56"

Cohesion: 0.16
Nodes (23): ChatImagesGrid(), ImageTile(), ImageViewer(), useImageUrl(), ViewerBody(), DataPane(), DataTab, ACTIONS (+15 more)

### Community 57 - "Community 57"

Cohesion: 0.08
Nodes (12): MAX_NEW_NAME_CHARS, ContentChange, RequestKind, Completion, CompletionResolve, Definition, Formatting, Hover (+4 more)

### Community 58 - "Community 58"

Cohesion: 0.14
Nodes (23): setup(), add_archived_column(), add_context_column(), add_conversation_column(), add_steps_column(), DB_ENV, FILE_NAME, group_old_turns() (+15 more)

### Community 59 - "Community 59"

Cohesion: 0.10
Nodes (19): mode_for_run(), permission_id(), split_message(), valid_mode(), a_session_that_looks_like_a_flag_is_rejected(), a_valid_session_never_gives_a_dash_argument_after_resume(), answer_splits_into_title_and_description(), args() (+11 more)

### Community 60 - "Community 60"

Cohesion: 0.09
Nodes (12): checked_target(), ID_SUFFIX_CHARS, invalid(), MAX_KEY_CHARS, OWNER_FILE, owner_of(), ProjectData, PROJECTS_DIR (+4 more)

### Community 61 - "Community 61"

Cohesion: 0.12
Nodes (23): date_of(), dates_round_trip_and_format(), day_number_of(), days_from_civil(), files_older_than_fourteen_days_are_removed(), KEEP_DAYS, line_for(), lines_hold_only_allowed_fields() (+15 more)

### Community 62 - "Community 62"

Cohesion: 0.15
Nodes (20): monaco-editor, describe(), formatRelativeTime(), shorten(), UNITS, useBlameAnnotation(), LINTED, useEslint() (+12 more)

### Community 63 - "Community 63"

Cohesion: 0.15
Nodes (13): ANTHROPIC_API_KEY, credential_remove(), credential_save(), credential_status(), CredentialError, Invalid, LoadFailed, SaveFailed (+5 more)

### Community 64 - "Community 64"

Cohesion: 0.14
Nodes (15): AvailableUpdate, check(), CHECK_INTERVAL, describe(), install(), is_check_due(), lock(), MIN_CHECK_GAP (+7 more)

### Community 65 - "Community 65"

Cohesion: 0.09
Nodes (15): args(), MAC_LAUNCHER, open(), OpenError, NotInstalled, Workspace, WorkspaceError, BadPath (+7 more)

### Community 66 - "Community 66"

Cohesion: 0.12
Nodes (15): columns, columns, columns, columns, columns, ToolColumn, HookEntry, ideTools (+7 more)

### Community 67 - "Community 67"

Cohesion: 0.15
Nodes (23): line_change(), record_or_report(), a_database_that_fails_is_reported_and_the_operation_stands(), a_read_only_database_is_reported(), ai_edits_name_only_a_path_inside_the_project(), big_pictures_have_no_thumbnail(), data_url_bytes_round_trip_and_refuse_other_text(), deleting_a_conversation_drops_only_its_images() (+15 more)

### Community 68 - "Community 68"

Cohesion: 0.11
Nodes (24): extension_of(), FileStamp, fingerprint(), format_of(), INDEX_FILE, is_plan_name(), JsonScanner, MAX_DESCRIPTION_CHARS (+16 more)

### Community 69 - "Community 69"

Cohesion: 0.12
Nodes (22): checked_plans_dir(), day_stamp(), DEFAULT_PLANS_DIR, fold(), json_file(), make_folder(), MAX_ATTEMPTS, MAX_SLUG_CHARS (+14 more)

### Community 70 - "Community 70"

Cohesion: 0.14
Nodes (17): a_file_that_changed_since_or_is_off_limits_is_not_written_and_the_others_are(), a_program_that_is_gone_says_the_extension_changed(), a_real_process_that_echoes_our_messages_fails_the_handshake(), a_real_process_that_never_answers_the_handshake_is_an_error_and_is_gone(), confirmed_edits_are_written_with_the_hash_they_were_computed_against(), DEADLINE, Edit, file_edit() (+9 more)

### Community 71 - "Community 71"

Cohesion: 0.16
Nodes (16): launch_plan(), listing(), SourceChoice, Auto, Download, Path, Vscode, ServerSetting (+8 more)

### Community 72 - "Community 72"

Cohesion: 0.09
Nodes (25): devDependencies, eslint@^10.14.0, eslint-config-prettier@^10.1.8, @eslint/js@^10.0.1, eslint-plugin-react-hooks@^7.1.1, globals@^17.14.0, prettier@^3.9.10, tailwindcss@^4.0.0 (+17 more)

### Community 73 - "Community 73"

Cohesion: 0.19
Nodes (20): log_file_event(), log_save(), FileReply, format_code(), Info, lint_code(), local_put_file(), open_in_vscode() (+12 more)

### Community 74 - "Community 74"

Cohesion: 0.10
Nodes (12): avatar_data_url(), AVATAR_HOST, base64_encode(), CODE_WAIT, device_code(), GithubAuth, GithubProfile, image_mime() (+4 more)

### Community 75 - "Community 75"

Cohesion: 0.13
Nodes (14): claude_details(), claude_state(), ClaudeAuth, LimitUsage, parse_limits(), Detail, detail(), github_account() (+6 more)

### Community 76 - "Community 76"

Cohesion: 0.17
Nodes (16): file_uri(), a_broken_stream_closes_the_session_and_the_last_error_is_the_protocol_one(), a_rename_is_returned_as_edits_per_project_file_and_nothing_is_written(), a_server_that_answers_in_another_position_encoding_is_refused(), a_stopped_slot_keeps_its_documents_and_starts_again_with_them(), at_most_eight_servers_run_at_once(), definitions_come_back_as_project_paths_or_external_paths(), diagnostics_are_sent_in_editor_coordinates_and_cleared_on_close_and_stop() (+8 more)

### Community 77 - "Community 77"

Cohesion: 0.20
Nodes (19): a_plan_folder_is_read_like_a_plan_file(), broken_oversized_and_foreign_files_are_skipped_or_ignored(), delete_removes_only_a_finished_plan_with_its_folder(), detail_of_a_json_plan_has_sections_tasks_and_files(), detail_of_a_markdown_plan_has_blocks(), detail_refuses_a_link_leaving_the_project(), detail_refuses_other_paths_and_missing_files(), fingerprint_changes_when_a_plan_is_added_edited_or_removed() (+11 more)

### Community 78 - "Community 78"

Cohesion: 0.17
Nodes (21): command(), agent_models(), alias_label(), antigravity_models(), CLAUDE_ALIAS_VERSIONS, claude_models(), codex_home(), codex_models() (+13 more)

### Community 79 - "Community 79"

Cohesion: 0.13
Nodes (20): CHARACTERS_PER_TOKEN, estimate_tokens(), MAX_OUTPUTS, name_part(), output_files(), parse_github_remote(), RepoRef, shorten_home() (+12 more)

### Community 80 - "Community 80"

Cohesion: 0.22
Nodes (15): CliKind, MAX_DETAIL_CHARS, ProviderStatus, status_all(), Environment, auth_cancel_login(), auth_login(), auth_logout() (+7 more)

### Community 81 - "Community 81"

Cohesion: 0.23
Nodes (4): BackgroundTasks, Task, truncate_head(), truncate_tail()

### Community 82 - "Community 82"

Cohesion: 0.10
Nodes (5): CODEX_WINDOWS, ContextUsage, window_of(), window_of_by_cli_and_model(), zero_window_never_divides()

### Community 83 - "Community 83"

Cohesion: 0.31
Nodes (18): classify(), error_response_message(), a_cancelled_answer_and_a_superseded_request_are_cancelled(), a_failed_handshake_is_an_error_at_once_without_restarts(), a_handshake_that_never_finishes_times_out(), a_server_error_is_a_failed_request_not_a_crash(), a_server_stopped_while_it_is_still_starting_does_not_linger(), a_server_that_dies_is_restarted_with_its_open_documents() (+10 more)

### Community 84 - "Community 84"

Cohesion: 0.09
Nodes (22): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+14 more)

### Community 85 - "Community 85"

Cohesion: 0.11
Nodes (9): AUTH_TIMEOUT, Info, local_host(), MAX_PHONES, MAX_PROMPT_CHARS, reachable(), Running, SIDE_RUN_PREFIX (+1 more)

### Community 86 - "Community 86"

Cohesion: 0.14
Nodes (13): markdown_file(), MAX_MARKDOWN_CHARS, MAX_TODO_CHARS, MAX_TODOS, Plan, Text, Todos, Todo (+5 more)

### Community 87 - "Community 87"

Cohesion: 0.15
Nodes (19): FileViewerContext, BLOCKED_ELEMENTS, encoder, externalUrl(), looksLikeSvg(), readSvgFile(), sanitizeSvg(), SvgFile (+11 more)

### Community 88 - "Community 88"

Cohesion: 0.12
Nodes (9): ASK_MODE, ask_mode_has_the_cli_ask_this_app_and_a_tool_question_becomes_an_event(), claude_file_edit_carries_the_text_before_and_after(), claude_sub_agent_words_stay_out_of_the_answer(), claude_task_call_starts_a_subagent_and_its_result_ends_it(), claude_tool_call_and_its_result_become_steps(), claude_tool_result_keeps_base64_pictures(), mode_args() (+1 more)

### Community 89 - "Community 89"

Cohesion: 0.21
Nodes (16): drive(), HopRunner, a_chain_returns_through_every_asker(), a_failed_hop_ends_the_relay(), a_long_answer_going_back_is_cut_not_refused(), a_loop_of_identical_messages_is_cut_at_once(), a_ping_pong_stops_at_the_hop_limit(), a_relay_ends_when_nobody_addresses_anybody() (+8 more)

### Community 90 - "Community 90"

Cohesion: 0.15
Nodes (8): CHAT_IMAGE_STORE_FAILED, attachment_read(), attachment_save(), attachments_dir(), chat_image_read(), percent_decode(), truncate_to_boundary(), long_names_are_cut_on_a_character_boundary()

### Community 91 - "Community 91"

Cohesion: 0.11
Nodes (8): ConfigError, Invalid, SaveFailed, UnknownServer, KEY, setup(), Stored, StoredServer

### Community 92 - "Community 92"

Cohesion: 0.20
Nodes (19): chooseVoice(), detectLanguage(), FALLBACK_LANGUAGES, sameLanguage(), splitByLanguage(), splitIntoPieces(), toSpokenText(), voiceScore() (+11 more)

### Community 93 - "Community 93"

Cohesion: 0.10
Nodes (17): GitHistoryError, BadHash, BadRef, CheckoutFailed, Failed, GitMissing, MergeConflict, MergeFailed (+9 more)

### Community 94 - "Community 94"

Cohesion: 0.10
Nodes (18): LanguageServerError, BadPath, BadRequest, Cancelled, Crashed, EncodingUnsupported, ExtensionChanged, NotFound (+10 more)

### Community 95 - "Community 95"

Cohesion: 0.18
Nodes (18): a_link_into_a_denied_folder_is_refused(), binary_files_are_read_as_bytes_but_not_as_text(), denied_paths_cannot_be_read_or_written(), files_from_outside_the_project_are_imported_under_a_free_name(), project(), rename_refuses_closed_folders_on_either_side(), rename_refuses_hidden_characters_and_device_names(), size_limits_and_binary_files() (+10 more)

### Community 96 - "Community 96"

Cohesion: 0.14
Nodes (7): ACCOUNTS_FILE, active_account(), CREDENTIALS_FILE, gemini_folder(), GeminiAuth, active_account_is_the_active_email(), folder_is_the_gemini_folder_inside_the_profile_home()

### Community 97 - "Community 97"

Cohesion: 0.21
Nodes (18): EXTENSION_ICONS, FileViewer(), FileViewerValue, getExtension(), getFileAlt(), getFileName(), getFileUrl(), getRawFile() (+10 more)

### Community 98 - "Community 98"

Cohesion: 0.22
Nodes (11): kill(), background_clear(), background_list(), background_stop(), BackgroundStore, MAX_TASKS_FILE_BYTES, project_of(), ProjectTasks (+3 more)

### Community 99 - "Community 99"

Cohesion: 0.23
Nodes (16): a_conversation_of_another_workspace_is_refused_and_delete_removes_everything(), bad_input_is_refused(), chat_grids_span_projects_keep_groups_and_forget_deleted_conversations(), context_of_a_turn_is_saved_loaded_and_validated(), conversations_are_listed_with_a_title_from_the_first_message_and_kept_apart(), only_the_newest_turns_are_kept(), saving_a_known_turn_updates_it_in_place(), saving_a_session_again_replaces_it() (+8 more)

### Community 100 - "Community 100"

Cohesion: 0.21
Nodes (19): appearance_and_code_colors_must_be_known(), avatar_must_be_a_real_image(), default_cli_names_come_from_cli_kind(), defaults_when_nothing_saved(), invalid_speech_settings_in_a_stored_row_fall_back(), invalid_stored_fields_fall_back_to_defaults(), language_must_be_known(), models_follow_the_model_rule() (+11 more)

### Community 101 - "Community 101"

Cohesion: 0.14
Nodes (14): AttachmentError, Empty, SaveFailed, TooLarge, HASH_BYTES, is_device_name(), MAX_BYTES, MAX_NAME_CHARS (+6 more)

### Community 102 - "Community 102"

Cohesion: 0.21
Nodes (11): build(), edit_menu(), FILE_EVENT, file_menu(), handle_event(), NEW_TERMINAL, OPEN, OPEN_FOLDER (+3 more)

### Community 103 - "Community 103"

Cohesion: 0.14
Nodes (11): VENDOR_BADGES, VendorBadge(), CLI_ICONS, CLIS, MODELS, MODES, AntigravityIcon(), ClaudeIcon() (+3 more)

### Community 104 - "Community 104"

Cohesion: 0.13
Nodes (8): ServerFeatures, ServerState, Error, Missing, Running, Starting, Stopped, StatusEvent

### Community 105 - "Community 105"

Cohesion: 0.21
Nodes (14): ConversationUsageReply, EnvironmentReply, GithubReply, home_folder(), OutputsReply, session_rail_environment(), session_rail_github(), session_rail_outputs() (+6 more)

### Community 106 - "Community 106"

Cohesion: 0.16
Nodes (9): aiChatEnglish, appUpdateEnglish, codeViewerEnglish, english, sessionRailEnglish, shellChatEnglish, shellMainEnglish, shellSettingsEnglish (+1 more)

### Community 107 - "Community 107"

Cohesion: 0.16
Nodes (9): aiChatVietnamese, appUpdateVietnamese, codeViewerVietnamese, vietnamese, sessionRailVietnamese, shellChatVietnamese, shellMainVietnamese, shellSettingsVietnamese (+1 more)

### Community 108 - "Community 108"

Cohesion: 0.25
Nodes (16): ensure_worktree(), valid_worktree_name(), branches_list(), changes_head_and_discard(), commit_own_files_only(), commit_records_a_deleted_file(), file_named_star_does_not_pull_in_other_files(), git() (+8 more)

### Community 109 - "Community 109"

Cohesion: 0.16
Nodes (13): change(), SHELL_TASK_TYPE, state_of(), string(), BackgroundChange, Finished, Running, Started (+5 more)

### Community 110 - "Community 110"

Cohesion: 0.16
Nodes (7): codex_account(), CodexAuth, decode_base64_url(), id_token_email(), combined_text(), base64_url_decodes_unpadded_text(), codex_email_is_read_from_the_id_token()

### Community 111 - "Community 111"

Cohesion: 0.21
Nodes (12): Sandbox, delete(), IndexEntry, key_of(), list(), PlanDocsList, plans_folder(), read() (+4 more)

### Community 112 - "Community 112"

Cohesion: 0.24
Nodes (11): Conversation, chat_delete(), chat_grid_get(), chat_grid_save(), chat_list(), chat_load(), chat_new(), chat_save_session() (+3 more)

### Community 113 - "Community 113"

Cohesion: 0.12
Nodes (16): Codexis IDE icon design: white </> code brackets on black rounded square, 64x64 app icon (code brackets), AppIcon-20x20@3x iOS app icon, AppIcon-29x29@1x iOS app icon, AppIcon-29x29@2x iOS app icon, AppIcon-29x29@2x-1 iOS app icon, AppIcon-29x29@3x iOS app icon, AppIcon-40x40@1x iOS app icon (+8 more)

### Community 114 - "Community 114"

Cohesion: 0.26
Nodes (12): Attachment, pastedFiles(), pastedPaths(), BUILTIN_COMMANDS, BuiltinCommand, builtinCommandOf(), builtinEntries(), SuggestionList() (+4 more)

### Community 115 - "Community 115"

Cohesion: 0.14
Nodes (15): json_detail(), PlanDoc, PlanDocDetail, PlanFormat, Json, Md, PlanStatus, Done (+7 more)

### Community 116 - "Community 116"

Cohesion: 0.19
Nodes (3): phone(), PhoneGate, serve()

### Community 117 - "Community 117"

Cohesion: 0.21
Nodes (14): Agent chat turn flow (agent_send to agent-event), Unified permission model (PathPolicy, Sandbox, Access, PhoneGate), TurnRegistry, Responder and TauriTurnObserver, Stopping a background task via control_request stop_task / TaskStop, Language server (LSP) design reusing VS Code extensions, Settings Extensions tab using ToolTable, Self-written Monaco LSP bridge (language-client.ts, use-language-server.ts), npm-based server install (language_server_install) (+6 more)

### Community 118 - "Community 118"

Cohesion: 0.13
Nodes (13): ADD_ARCHIVED_TO_CHAT_TURNS, ADD_CONTEXT_TO_CHAT_TURNS, ADD_CONVERSATION_INDEX_TO_CHAT_TURNS, ADD_CONVERSATION_TO_CHAT_TURNS, ADD_PROFILE_TO_USAGE_EVENTS, ADD_STEPS_TO_CHAT_TURNS, CREATE_ACTIVITY_TABLES, CREATE_CHAT_GRID_TABLE (+5 more)

### Community 119 - "Community 119"

Cohesion: 0.15
Nodes (15): checklist_mark(), is_prose(), markdown_blocks(), MarkdownBlock, Bullet, Checklist, Code, Heading (+7 more)

### Community 121 - "Community 121"

Cohesion: 0.18
Nodes (6): a_shell_task_missing_from_the_cli_list_is_done(), changes_drive_the_table(), lifecycle_running_to_done_and_failed(), restore_marks_running_as_stopped(), state_of(), stop_marks_stopped_and_reports_errors()

### Community 122 - "Community 122"

Cohesion: 0.28
Nodes (9): added_project_survives_a_reload(), adding_the_same_folders_returns_the_existing_project(), bad_input_is_refused_and_nothing_is_saved(), ids_are_not_reused_while_a_later_project_exists(), new_project(), removing_the_selected_project_clears_the_selection(), sensitive_names_and_control_values_are_refused(), store() (+1 more)

### Community 123 - "Community 123"

Cohesion: 0.31
Nodes (12): cleanup_by_age_keeps_recent_rows_and_files(), cleanup_needs_confirmation_and_removes_only_app_data_of_the_project(), fill(), item(), Layout, layout(), PNG, ROOT (+4 more)

### Community 124 - "Community 124"

Cohesion: 0.14
Nodes (14): scripts, build, dev, format, format:check, lint, lint:fix, start (+6 more)

### Community 125 - "Community 125"

Cohesion: 0.18
Nodes (13): EXTENSION_ROOTS, InstallHintText(), originLabel(), reason(), selectedCandidate(), ServerDetail(), SOURCES, STATE_VARIANT (+5 more)

### Community 126 - "Community 126"

Cohesion: 0.16
Nodes (10): FileAction, AiEdit, Copy, Create, Delete, Discard, Move, Rename (+2 more)

### Community 127 - "Community 127"

Cohesion: 0.14
Nodes (13): compilerOptions, baseUrl, jsx, lib, module, moduleResolution, noEmit, paths (+5 more)

### Community 128 - "Community 128"

Cohesion: 0.21
Nodes (12): Google Rust Style Guide digest, Module and import style (no globs, one module per use), Google: application favors simplicity over reusability, Microsoft Pragmatic Rust Guidelines digest, M-APP-ERROR (anyhow for applications), M-NO-META-DESIGN-DOCUMENTATION, M-UNSAFE / M-UNSOUND, rust-best-practices skill (+4 more)

### Community 129 - "Community 129"

Cohesion: 0.15
Nodes (13): with, args, cache, fetch-depth, includeUpdaterJson, node-version, prerelease, ref (+5 more)

### Community 130 - "Community 130"

Cohesion: 0.18
Nodes (10): @tiptap/extension-text-style@^3.28.0, @tiptap/extension-text-style, Commands, @tiptap/core, Commands, FontSize, @tiptap/core, Commands (+2 more)

### Community 131 - "Community 131"

Cohesion: 0.28
Nodes (11): a_damaged_row_means_the_defaults(), a_failed_read_is_not_kept(), an_extension_root_only_counts_with_the_vscode_source(), every_server_is_off_with_the_automatic_source_by_default(), rejects_an_unknown_server_and_an_extension_root_outside_the_whitelist(), saves_and_reads_back_one_server_without_touching_the_others(), store(), the_chat_settings_row_is_not_affected() (+3 more)

### Community 132 - "Community 132"

Cohesion: 0.21
Nodes (12): is_newer(), parse_version(), progress(), UpdateProgress, a_check_is_due_after_the_gap_only(), a_higher_version_is_newer_in_any_part(), a_prefix_and_a_pre_release_tail_are_ignored(), a_version_is_announced_once() (+4 more)

### Community 133 - "Community 133"

Cohesion: 0.17
Nodes (5): find_url(), is_rejection(), watch_output(), refusal_is_read_from_the_output(), url_is_found_once_its_line_is_complete()

### Community 135 - "Community 135"

Cohesion: 0.22
Nodes (10): agent_permission(), permission_input(), run_id(), run_id_rules(), key(), model_rules(), permission_input_is_bounded(), prompt_bounds() (+2 more)

### Community 136 - "Community 136"

Cohesion: 0.26
Nodes (8): StoredPlan, a_markdown_plan_is_written_into_a_new_folder(), an_existing_file_is_never_overwritten(), markdown(), nothing_is_written_for_an_empty_plan_or_a_bad_folder(), SAMPLE, tasks_become_a_checklist_or_a_json_plan(), workspace()

### Community 137 - "Community 137"

Cohesion: 0.33
Nodes (6): plan_doc_delete(), plan_doc_read(), plan_doc_set_status(), plan_docs_list(), plan_load(), project_data_dir()

### Community 138 - "Community 138"

Cohesion: 0.24
Nodes (12): agent-event kind speaker, Codexis IDE architecture, AgentCli trait and Claude/Codex adapters, AuthTool trait (template method status), cli::CliKind single source of CLI identity, Applied design patterns (Adapter, Factory, Template, Observer, Proxy), OOP refactor of src-tauri (groups A-G, Phase 0/3), Phone remote control over WebSocket (PhoneGate) (+4 more)

### Community 139 - "Community 139"

Cohesion: 0.21
Nodes (10): Background tasks pane design, BackgroundTasks table (Task, TaskKind, TaskState), Claude system events task_started/task_updated/task_notification, Group layout (chat grid) no-overlap design, Changes/file columns shrink to available space and clamp saved width, Pane placement (Move, Fill and arrange, Float), PanelMenu shared dropdown component, usePanelPlacement hook and localStorage keys (+2 more)

### Community 140 - "Community 140"

Cohesion: 0.17
Nodes (11): concurrency, cancel-in-progress, group, jobs, name, on, pull_request, push (+3 more)

### Community 141 - "Community 141"

Cohesion: 0.32
Nodes (7): a_corrupt_file_is_replaced_by_the_next_record(), a_recorded_plan_loads_back_and_merges_kinds(), MAX_SESSION_CHARS, plan_file(), PlanStore, store(), unknown_or_unsafe_sessions_give_none_or_error()

### Community 142 - "Community 142"

Cohesion: 0.17
Nodes (8): @tailwindcss/vite@^4.1.11, vite@^8.0.0, @vitejs/plugin-react@^6.1.1, @tailwindcss/vite, vite, @vitejs/plugin-react, here, src

### Community 143 - "Community 143"

Cohesion: 0.26
Nodes (10): Loaded, useLoaded(), useSessionRail(), ideSessionRail, RailEnvironment, RailGithub, RailGithubStatus, RailOutput (+2 more)

### Community 144 - "Community 144"

Cohesion: 0.18
Nodes (3): remove_by_hash(), a_malformed_hash_removes_nothing(), files_of_a_hash_are_removed_and_others_stay()

### Community 145 - "Community 145"

Cohesion: 0.33
Nodes (10): added_account_has_a_private_folder_and_an_environment(), an_account_can_be_renamed_but_not_the_default(), an_id_of_another_cli_is_not_found(), bad_requests_are_refused(), default_profile_is_always_first_and_active(), names(), names_with_control_characters_are_refused(), number_of_accounts_is_limited() (+2 more)

### Community 146 - "Community 146"

Cohesion: 0.41
Nodes (10): counts_windows_tokens_and_models(), huge_sizes_are_clamped_so_the_sums_do_not_overflow(), limit_error_counts_until_a_later_success(), record(), record_tells_whether_the_turn_hit_a_limit(), rejects_unknown_cli(), splits_tokens_into_the_last_seven_days(), splits_tokens_into_the_last_twenty_four_hours() (+2 more)

### Community 147 - "Community 147"

Cohesion: 0.25
Nodes (11): Codexis app icon: white code brackets </> on black rounded square, Android hdpi launcher icon, Android hdpi launcher foreground icon, Android hdpi round launcher icon, Android mdpi launcher icon, iOS AppIcon 60x60@2x, iOS AppIcon 60x60@3x, iOS AppIcon 76x76@1x (+3 more)

### Community 148 - "Community 148"

Cohesion: 0.27
Nodes (11): Codexis component catalog, Field component (ui prop), DataTable not yet implemented, Radix-based ui primitives, Codexis IDE Design System, Accessibility and reduced-motion rules, Dark mode via class on html, Rule: all inputs go through Field (+3 more)

### Community 149 - "Community 149"

Cohesion: 0.18
Nodes (6): ERROR_NOT_FOUND, TaskKind, Shell, Subagent, read_limited(), an_oversize_tasks_file_is_ignored()

### Community 150 - "Community 150"

Cohesion: 0.22
Nodes (8): event_message(), generate_token(), tokens_match(), chat_events_get_the_event_type(), events_of_side_runs_are_not_sent_to_the_phone(), side_run_filter_is_exact_prefix_match_on_string_run_ids(), token_is_32_hex_characters_and_never_repeats(), tokens_match_only_when_equal()

### Community 151 - "Community 151"

Cohesion: 0.22
Nodes (9): Codexis IDE AGENTS.md, 22 known pnpm typecheck errors, Naming conventions table, Rust tests in src-tauri/tests/unit, Codexis IDE README, AI agent driving claude/codex/ollama CLIs, App data storage locations, Release and auto-update flow (+1 more)

### Community 152 - "Community 152"

Cohesion: 0.20
Nodes (8): Session rail testcases (SR-01..SR-10), SQLite rynox.db ERD summary, Database design (SQLite rynox.db), conversations, chat_turns, conversation_sessions tables, Idempotent migrations (add_column_if_missing, group_old_turns), Session rail popup design, session_rail_* Tauri commands (environment, outputs, github, usage), Seeders README (Rust seeders, projects.json import)

### Community 153 - "Community 153"

Cohesion: 0.33
Nodes (8): input-otp@^1.4.2, input-otp, OtpField(), OtpFieldProps, InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot

### Community 154 - "Community 154"

Cohesion: 0.31
Nodes (4): inline_ask(), inline_prompt(), InlineAnswer, inline_prompt_names_file_lines_code_and_question()

### Community 155 - "Community 155"

Cohesion: 0.22
Nodes (9): primaryColor(), startDrawing(), followMicrophone(), listeners, measure(), Mode, notify(), sources (+1 more)

### Community 156 - "Community 156"

Cohesion: 0.31
Nodes (9): get(), isVoiceReplyOn(), listeners, memory, put(), read(), setVoiceReply(), subscribe() (+1 more)

### Community 157 - "Community 157"

Cohesion: 0.20
Nodes (6): ERROR_STOP_FAILED, MAX_ID_CHARS, MAX_LABEL_CHARS, MAX_OUTPUT_TAIL_CHARS, MAX_TASKS, now_seconds()

### Community 158 - "Community 158"

Cohesion: 0.40
Nodes (5): projects_add(), projects_list(), projects_remove(), projects_select(), ProjectsReply

### Community 159 - "Community 159"

Cohesion: 0.38
Nodes (4): remote_start(), remote_status(), remote_stop(), Remote

### Community 160 - "Community 160"

Cohesion: 0.22
Nodes (8): ProjectError, InvalidEnv, InvalidFolder, InvalidName, NoFolder, NotFound, SaveFailed, TooMany

### Community 161 - "Community 161"

Cohesion: 0.25
Nodes (8): Item 15: Understand the borrow checker, Rust Design Patterns digest, Anti-pattern: clone to satisfy borrow checker, Anti-pattern: #![deny(warnings)], mem::take and mem::replace idiom, cargo fmt, clippy -D warnings, test before handback, Offer BeautifulRust lints config, (.claude copy) Rust Design Patterns digest

### Community 162 - "Community 162"

Cohesion: 0.33
Nodes (8): Context panel design (context usage), ContextUsage computation (last iteration usage / window), Event::Context agent-event kind context, Plan pane design (ExitPlanMode plan text), Event::Plan from control_request ExitPlanMode, Side chat (Quick ask) design, Side chat read-only via --permission-mode plan / codex read-only sandbox, plan mode prompt

### Community 163 - "Community 163"

Cohesion: 0.36
Nodes (6): a_root_reaches_its_own_project_and_no_other_folder(), a_saved_project_keeps_its_name_and_id_and_an_unsaved_folder_gets_a_hash(), failed_selection_keeps_the_current_workspace(), project_without_folders_cannot_be_opened_and_removal_unselects(), selecting_a_project_switches_the_root_and_keeps_the_sandbox(), state_with_projects()

### Community 164 - "Community 164"

Cohesion: 0.22
Nodes (9): with, cache, fetch-depth, if-no-files-found, name, node-version, path, version (+1 more)

### Community 165 - "Community 165"

Cohesion: 0.22
Nodes (8): concurrency, cancel-in-progress, group, jobs, name, permissions, contents, permissions

### Community 166 - "Community 166"

Cohesion: 0.22
Nodes (9): BEFORE, COMMIT_SHA, DEFAULT_BRANCH, EVENT, GITHUB_TOKEN, TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD, VERSION (+1 more)

### Community 167 - "Community 167"

Cohesion: 0.22
Nodes (9): HAS_SIGNING_KEY, INPUT_TAG, NEW_TAG, release, env, if, needs, runs-on (+1 more)

### Community 168 - "Community 168"

Cohesion: 0.28
Nodes (8): material-icon-theme@^5.40.0, material-icon-theme, fileIconUrl(), ICON_FILES, iconId(), loadManifest(), Manifest, urls

### Community 169 - "Community 169"

Cohesion: 0.36
Nodes (8): cache, countLines(), fromCache(), hashText(), readEnabled(), remember(), useBlame(), GitBlameLine

### Community 170 - "Community 170"

Cohesion: 0.33
Nodes (7): collect_task_statuses(), parse_json(), plan_item(), plan_task(), PlanItem, string_list(), text_field()

### Community 171 - "Community 171"

Cohesion: 0.39
Nodes (4): JsonScanner<'a>, with_json_status(), json_status_inside_content_meta_and_missing_status(), json_status_is_replaced_in_place_keeping_the_text()

### Community 172 - "Community 172"

Cohesion: 0.28
Nodes (4): Behaviour, edit_at(), FakeLauncher, silent()

### Community 173 - "Community 173"

Cohesion: 0.39
Nodes (8): AI relay testcases (AR-01..AR-08), AI relay design (turn passing between AIs), Relay hop limits and loop protection (MAX_HOPS=6), relay:<ai> code block address convention, relay::drive hop loop with asker stack, choices prompt (choices code block), relay hop prompt template, chat role system prompt (brevity, relay, screenshot proof)

### Community 174 - "Community 174"

Cohesion: 0.36
Nodes (8): steps, steps, steps, steps, id, if, run, uses

### Community 175 - "Community 175"

Cohesion: 0.25
Nodes (8): release_tag, on, push, workflow_dispatch, default, description, required, inputs

### Community 176 - "Community 176"

Cohesion: 0.25
Nodes (8): tag, released, tag, version, if, outputs, runs-on, timeout-minutes

### Community 177 - "Community 177"

Cohesion: 0.29
Nodes (7): getRecognitionConstructor(), Recognition, RECOGNITION_LANGUAGES, RecognitionConstructor, RecognitionEvent, RecognitionResult, useSpeechInput()

### Community 178 - "Community 178"

Cohesion: 0.29
Nodes (5): ChatError, Invalid, LoadFailed, Rejected, SaveFailed

### Community 179 - "Community 179"

Cohesion: 0.46
Nodes (7): bad_names_and_values_are_refused(), nothing_set_at_first(), only_printable_ascii_is_a_key(), removed_key_is_gone(), saved_key_shows_only_its_end_and_reaches_the_environment(), saving_again_replaces_the_value(), store()

### Community 180 - "Community 180"

Cohesion: 0.29
Nodes (7): Bevy digest, Conflicting queries panic (B0001), Deferred Commands and system ordering, rust-review skill, Review report format (Must fix / Should fix / Consider), (.claude copy) Bevy digest, (.claude copy) rust-review skill

### Community 181 - "Community 181"

Cohesion: 0.29
Nodes (6): Effective Rust digest, Item 18: Don't panic, Item 12: generics vs trait objects, M-PANIC-IS-STOP, Review priority categories, (.claude copy) Effective Rust digest

### Community 182 - "Community 182"

Cohesion: 0.38
Nodes (7): Group of 2 chats wide layout screenshot, Group of 4 chats 2x2 grid screenshot, Plan tab render screenshot, Wide layout with diff panel, Wide layout with diff panel (g02), Chat group layout feature (Nhom), Changes diff panel (Thay doi)

### Community 183 - "Community 183"

Cohesion: 0.29
Nodes (7): env, if, needs, runs-on, timeout-minutes, HAS_SIGNING_KEY, build

### Community 184 - "Community 184"

Cohesion: 0.38
Nodes (7): steps, id, if, name, run, uses, steps

### Community 185 - "Community 185"

Cohesion: 0.38
Nodes (3): initialization_options(), LaunchPlan, only_intelephense_takes_initialization_options()

### Community 186 - "Community 186"

Cohesion: 0.62
Nodes (6): spec(), uninstall(), a_server_without_a_package_cannot_be_installed(), install_needs_node_and_npm(), locator(), uninstall_removes_only_the_servers_folder()

### Community 188 - "Community 188"

Cohesion: 0.33
Nodes (6): Rust API Guidelines digest, C-CUSTOM-TYPE: avoid bool parameters, C-GOOD-ERR: errors implement std::error::Error, C-SEALED: sealed trait pattern, Newtypes, no bool parameters, derive standard traits, (.claude copy) Rust API Guidelines digest

### Community 189 - "Community 189"

Cohesion: 0.47
Nodes (6): Codexis IDE app icon (code brackets logo), Android ic_launcher icon (mipmap-xxhdpi): black rounded square with white </> code symbol, Android ic_launcher_foreground icon (mipmap-xxhdpi): black rounded square with white </> code symbol, Android ic_launcher_round icon (mipmap-xxhdpi): black rounded square with white </> code symbol, Android ic_launcher icon (mipmap-xxxhdpi): black rounded square with white </> code symbol, Android ic_launcher_foreground icon (mipmap-xxxhdpi): black rounded square with white </> code symbol

### Community 190 - "Community 190"

Cohesion: 0.33
Nodes (6): outputs, runs-on, timeout-minutes, changes, backend, frontend

### Community 191 - "Community 191"

Cohesion: 0.33
Nodes (6): BASE, EVENT, HEAD, TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD, env

### Community 192 - "Community 192"

Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 193 - "Community 193"

Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 194 - "Community 194"

Cohesion: 0.33
Nodes (4): Decision, Allow, Deny, text()

### Community 195 - "Community 195"

Cohesion: 0.33
Nodes (5): ClientMessage, Auth, Send, parse_message(), messages_of_the_phone_are_parsed()

### Community 198 - "Community 198"

Cohesion: 0.40
Nodes (5): rust-port skill, PORTING.md porting notes, Keep the port proportionate, Port the tests first, (.claude copy) rust-port skill

### Community 199 - "Community 199"

Cohesion: 0.50
Nodes (5): Design inconsistencies list (DESIGN.md vs code), Field does not pass className to the input, Hard-coded colors outside tokens, Raw inputs bypassing Field component, Sonner Toaster possibly not mounted

### Community 200 - "Community 200"

Cohesion: 0.40
Nodes (3): @playwright/test@^1.65.0, isCI, @playwright/test

### Community 201 - "Community 201"

Cohesion: 0.40
Nodes (5): if, needs, runs-on, timeout-minutes, backend

### Community 202 - "Community 202"

Cohesion: 0.40
Nodes (5): if, needs, runs-on, timeout-minutes, frontend

### Community 203 - "Community 203"

Cohesion: 0.50
Nodes (4): diffOps(), DiffRow, Op, unifiedDiff()

### Community 204 - "Community 204"

Cohesion: 0.50
Nodes (5): Android round launcher icon (black circle with white </> symbol), Codexis IDE app icon (black rounded square with white </> code symbol), iOS AppIcon 20x20@1x, iOS AppIcon 20x20@2x, iOS AppIcon 20x20@2x (variant -1)

### Community 205 - "Community 205"

Cohesion: 0.40
Nodes (5): Square30x30Logo icon (black rounded square with white </> code symbol), Square310x310Logo icon (black rounded square with white </> code symbol), Square44x44Logo icon (black rounded square with white </> code symbol), Square71x71Logo icon (black rounded square with white </> code symbol), Square89x89Logo icon (black rounded square with white </> code symbol)

### Community 206 - "Community 206"

Cohesion: 0.40
Nodes (5): GithubStatus, NoCli, NoRemote, Ok, SignedOut

### Community 207 - "Community 207"

Cohesion: 0.80
Nodes (3): set_visible(), window_buttons_visible(), window_is_fullscreen()

### Community 208 - "Community 208"

Cohesion: 0.50
Nodes (3): other_lines_and_foreground_tasks_change_nothing(), STARTED, the_measured_system_lines_become_changes()

### Community 209 - "Community 209"

Cohesion: 1.00
Nodes (3): Permission mode menu with Auto selected (screenshot), Permission mode menu with Bypass permissions selected (screenshot), Permission modes menu (Auto, Ask each, Auto-edit, Plan, Bypass)

### Community 210 - "Community 210"

Cohesion: 0.67
Nodes (3): Auto-update from GitHub Releases design, UpdateBanner and update-available/update-progress events, Tauri updater signing key and latest.json release requirements

### Community 213 - "Community 213"

Cohesion: 0.67
Nodes (3): App icon 128x128 (black rounded square with code brackets), App icon 128x128@2x (black rounded square with code brackets), App icon 32x32 (black rounded square with code brackets)

### Community 214 - "Community 214"

Cohesion: 0.67
Nodes (3): Android mdpi launcher foreground icon (code brackets </> on black rounded square), Android xhdpi launcher icon (code brackets </> on black rounded square), Android xhdpi launcher foreground icon (code brackets </> on black rounded square)

## Ambiguous Edges - Review These

- `Design inconsistencies list (DESIGN.md vs code)` → `Settings Extensions tab using ToolTable` [AMBIGUOUS]
  docs/system/language-servers.md · relation: conceptually_related_to

## Knowledge Gaps

- **306 isolated node(s):** `sh`, `codexis-ide`, `LoadFailed`, `SaveFailed`, `DeleteFailed` (+301 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1410 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `AppState` connect `Git Changes (Rust)` to `Community 98`, `Community 163`, `Community 154`, `Community 73`, `Community 137`, `Community 105`, `PTY Terminal (Rust)`, `Tools & Project Sandbox (Rust)`, `Agent Commands`, `Community 112`, `Language Server Commands`, `Community 50`, `Community 52`, `Community 55`, `Community 90`, `Community 158`, `Community 31`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `sh`, `codexis-ide`, `LoadFailed` to the rest of the system?**
  _306 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & Terminal` be split into smaller, more focused modules?**
  _Cohesion score 0.03272543059777102 - nodes in this community are weakly interconnected._
- **Why does `CliKind` connect `Community 27` to `Community 134`, `Git Changes (Rust)`, `Agent Commands`, `Chat Settings (Rust)`, `Community 24`, `Community 26`, `Community 154`, `Community 32`, `Community 35`, `Community 40`, `Community 42`, `Community 46`, `Community 52`, `Community 59`, `Community 74`, `Community 75`, `Community 80`, `Community 82`, `Community 89`, `Community 96`, `Community 105`, `Community 110`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Should `Editor Toolbar & Dialogs` be split into smaller, more focused modules?**
  _Cohesion score 0.05259391771019678 - nodes in this community are weakly interconnected._
- **Why does `react` connect `UI Primitives & Forms` to `App Shell & Terminal`, `Editor Toolbar & Dialogs`, `Rich Editor & File Cards`, `Code Viewer & Avatars`, `Chat Images & Changes Panel`, `Branch Popover & Helpers`, `Markdown, Mermaid & Choices`, `Frontend Dependencies`, `Logos & Message List`, `Community 143`, `Language Server Hook (TS)`, `Settings Tabs`, `Community 153`, `Community 156`, `Community 33`, `Community 169`, `Community 47`, `Community 177`, `Community 56`, `Community 62`, `Community 87`, `Community 92`, `Community 97`, `Community 103`, `Community 114`, `Community 125`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._

### Low-confidence Hints

_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Design inconsistencies list (DESIGN.md vs code)` and `Settings Extensions tab using ToolTable`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
