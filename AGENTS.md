# AGENTS.md — Codexis IDE

## Mục đích

Codexis IDE là IDE desktop độc lập (Tauri 2 + Rust): trình soạn code có git, terminal thật và AI agent điều khiển các CLI `claude` / `codex` / `gemini`. Backend là Rust, UI là React 19 (Monaco editor, xterm terminal, diff, changes). Một số phần (git, PTY terminal, AI agent) vẫn đang được lên kế hoạch theo `README.md`.

## Stack và cấu trúc

- Backend: `src-tauri/` (Tauri 2, `serde`, `serde_json`, `sha2`, `tauri-plugin-dialog`; dev-dependency `tempfile`). Identifier app: `ai.geteasy.rynox-ide`.
    - `src-tauri/src/lib.rs`: khai báo module và `invoke_handler`; `main.rs`: entry.
    - Module: `commands.rs` (Tauri command + `AppState`), `workspace.rs` (workspace sandbox), `projects.rs` (lưu danh sách project), `git.rs`, `vscode.rs` (mở VS Code).
    - `src-tauri/database/{migrations,seeders}`: migration SQL đánh số (`0001_*.sql`, nhúng bằng `include_str!` qua `src/migrations.rs`) và thư mục seeder (logic seed ở `src/seeders.rs`).
- Frontend: `src/` (React 19, Vite 8, Tailwind 4, Monaco, xterm, Radix, react-hook-form + zod, tiptap).
    - `src/lib/api.ts`: lớp gọi các Rust command — nơi duy nhất nên đổi khi đổi cách gọi backend.
    - Thư mục: `actions/`, `components/` (`ai-chat`, `file-manager`, `form`, `shell`, `tables`, `ui`), `contexts/`, `css/`, `hooks/`, `icons/`, `lib/`, `wayfinder/`; entry `main.tsx`, `app.tsx`.
- `prompts/`: prompt Markdown cho AI agent.
- `docs/plans/<tên-plan>/`: mỗi plan một thư mục: `plan.json` (hoặc `plan.md`) và `evidence/` (ảnh bằng chứng): chỉ là báo cáo. Test Playwright của plan nằm ở `e2e/<tên-plan>/`, trong hệ thống, không nằm trong `docs/plans/`; module Rust `src-tauri/src/plans/` đọc cả plan nằm rời `docs/plans/<tên>.json` cũ.
- `.claude/skills/`: ba skill Rust (nguồn BeautifulRust): `rust-best-practices`, `rust-port`, `rust-review`.

## Lệnh

```sh
pnpm install
pnpm start            # tauri dev (app đầy đủ)
pnpm dev              # chỉ vite
pnpm build            # chỉ build frontend
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint . (lint:fix để tự sửa)
pnpm format           # prettier --write . (format:check để kiểm tra)
pnpm test:e2e         # Playwright (thư mục e2e/, chạy trên vite, không có backend Tauri)
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Code style

- TypeScript/JSON theo `.prettierrc`: 4 dấu cách (JSON 2), nháy đơn, có dấu `;`, `trailingComma: all`, `printWidth` 80. ESLint cấu hình ở `eslint.config.js`.
- Rust theo skill `rust-best-practices`; `cargo fmt`, clippy với `-D warnings`.
- Không viết tắt tên; theo convention và định dạng sẵn có của file đang sửa.

### Quy ước đặt tên

Biến đặt camelCase; tên lệnh Tauri đặt snake_case (là tên hàm Rust, không chứa `-`); đường dẫn kiểu URL của API trong `src/lib/api.ts` đặt kebab-case, không dùng `_`; còn lại theo quy ước chính thức của từng ngôn ngữ.

| Thành phần                                  | Quy ước                                           | Ví dụ                           |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| TS: biến, hàm, tham số, prop, trường object | camelCase                                         | `runId`, `newName`              |
| TS: component, type, interface, enum        | PascalCase                                        | `ContextPanel`, `ContextUsage`  |
| TS: hằng cấp module                         | UPPER_SNAKE_CASE                                  | `READ_ONLY_MODE`                |
| Rust: hàm, biến, module, tệp                | snake_case                                        | `from_usage`, `project_data.rs` |
| Rust: struct, enum, trait                   | PascalCase                                        | `BackgroundTasks`, `TaskState`  |
| Rust: hằng, static                          | SCREAMING_SNAKE_CASE                              | `SIDE_RUN_PREFIX`               |
| TS: hook React                              | camelCase, tiền tố `use`                          | `useSideChat`                   |
| Rust và TS: biến thể enum, type alias       | PascalCase                                        | `Pending`, `UserId`             |
| Rust: macro                                 | snake_case                                        | `create_user!()`                |
| Tệp TS/TSX (cả component và tiện ích)       | kebab-case (theo mã hiện có, 224/224 tệp)         | `side-chat-dock.tsx`            |
| SQLite: bảng, cột                           | snake_case, tên bảng số nhiều                     | `chat_turns`, `updated_at`      |
| Lệnh Tauri (`#[tauri::command]`)            | snake_case                                        | `agent_send`, `background_list` |
| Đường dẫn URL của API trong `api.ts`        | kebab-case, không dùng `_`                        | `/ai-chat/local/commit-message` |
| Tham số lệnh Tauri phía JS                  | camelCase (Tauri tự đổi sang snake_case của Rust) | `runId`, `expectedHash`         |
| Trường JSON trong payload backend gửi lên   | camelCase (`#[serde(rename_all = "camelCase")]`)  | `cacheRead`, `startedAt`        |
| Tên sự kiện Tauri                           | kebab-case                                        | `agent-event`, `terminal-data`  |
| Khoá i18n                                   | snake_case có dấu chấm                            | `side_chat.title`               |

- Tên tệp theo kebab-case của dự án, không theo tài liệu chung (component PascalCase, tiện ích camelCase): đổi tên tệp là việc riêng, cần được yêu cầu.
- Biến boolean nêu trạng thái hoặc điều kiện (`isActive`, `hasPermission`, `canEdit`, `shouldRetry`); tập hợp dùng danh từ số nhiều (`orderItems`); hàm bắt đầu bằng động từ (`get`, `find`, `create`, `update`, `delete`, `validate`, `calculate`, `send`, `sync`); struct, class, trait dùng danh từ và nêu đúng trách nhiệm. Tránh tên chung chung như `data`, `item`, `value` khi có thể cụ thể hơn.
- Giá trị enum serialize và dữ liệu đọc từ CLI ngoài giữ nguyên tên gốc (`in_progress`, `file_path`, `tool_use_id`): không đổi sang camelCase.
- Không đổi tên lệnh Tauri hoặc trường payload khi chưa được yêu cầu: phải đổi Rust và `src/lib/api.ts` cùng lúc, và trường payload còn là dạng dữ liệu đã lưu trên đĩa.
- Test Rust nằm ở `src-tauri/tests/unit/`, nối vào module bằng `#[cfg(test)] #[path = "../tests/unit/<tên>.rs"] mod tests;`; không viết test inline trong `src/`.

## Quy tắc cho agent

- Đọc `~/.agents/CONTRACT.md` trước khi làm; tuân thủ các ràng buộc cứng trong đó.
- Trước mỗi lần chạy `git commit`, luôn đọc lại `~/.agents/rules/git.md` trong phiên hiện tại và làm theo checklist trong đó. File quy tắc hiện nằm ở `~/.agents/rules/git.md`; không giả định có bản sao tại `.agent/rules/git.md` hoặc `.agents/rules/git.md` trong repo.
- Không `git commit`/`git push` khi người dùng chưa yêu cầu rõ trong lượt hiện tại.
- Không thêm dependency hay tính năng ngoài phạm vi task; cần mở rộng thì hỏi trước.
- Giữ ổn định tên và shape (tham số, kiểu trả về) của Tauri command: nếu đổi phía Rust (`commands.rs`, `lib.rs`) thì phải đổi `src/lib/api.ts` tương ứng, và ngược lại.
- `.agents/storage` bị git-ignore (cùng `node_modules`, `dist`, `src-tauri/target`, `src-tauri/gen`); không commit nội dung trong đó.
- Dữ liệu thật (workspace/project của người dùng) mặc định chỉ đọc; không ghi/xoá khi chưa được yêu cầu.
- Test giao diện/hành vi trên trình duyệt: luôn dùng Playwright (MCP `playwright` ở `.mcp.json`, hoặc `pnpm test:e2e` cho test lưu lại ở `e2e/`); không dùng Claude in Chrome (đã chặn ở `.claude/settings.json`). Trình duyệt chạy vite nên không có lệnh Tauri: phần cần backend thì kiểm bằng `cargo test`.
- Không đưa secret vào repo.

## Vấn đề đã biết

- `pnpm typecheck` hiện báo 22 lỗi có sẵn (chạy xác nhận), chủ yếu ở mã port từ `personal-manager`:
    - `TS2307`: thiếu module `@/types` (`inline-ask`, `monaco-code`, `proposal-card`, `work-steps`) và `@tiptap/pm/model` (`src/lib/editor/image.tsx`).
    - `TS2339`: `window.route` không tồn tại (`attribute-pairs-field`, `slug-field`, `use-app-form`, `use-remote-options`).
    - `TS7053`/`TS7006`/`TS7052`/`TS2769`: lỗi kiểu ngầm định `any` ở `code-viewer.tsx`, `proposal-card.tsx`, `use-app-form.ts` (kể cả resolver zod không khớp).
    - Chỉ sửa khi được giao; không coi là lỗi do thay đổi của mình.
- Ảnh PNG/JPG không hiển thị được vì `workspace_read` chỉ trả về văn bản.
