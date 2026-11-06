# AGENTS.md — Codexis IDE

## Mục đích

Codexis IDE là IDE desktop độc lập (Tauri 2 + Rust): trình soạn code có git, terminal thật và AI agent điều khiển các CLI `claude` / `codex` / `gemini`. Backend là Rust, UI là React 19 (Monaco editor, xterm terminal, diff, changes). Một số phần (git, PTY terminal, AI agent) vẫn đang được lên kế hoạch theo `README.md`.

## Stack và cấu trúc

- Backend: `src-tauri/` (Tauri 2, `serde`, `serde_json`, `sha2`, `tauri-plugin-dialog`; dev-dependency `tempfile`). Identifier app: `ai.geteasy.rynox-ide`.
    - `src-tauri/src/lib.rs`: khai báo module và `invoke_handler`; `main.rs`: entry.
    - Module: `commands.rs` (Tauri command + `AppState`), `workspace.rs` (workspace sandbox), `projects.rs` (lưu danh sách project), `git.rs`, `vscode.rs` (mở VS Code).
- Frontend: `src/` (React 19, Vite 8, Tailwind 4, Monaco, xterm, Radix, react-hook-form + zod, tiptap).
    - `src/lib/api.ts`: lớp gọi các Rust command — nơi duy nhất nên đổi khi đổi cách gọi backend.
    - Thư mục: `actions/`, `components/` (`ai-chat`, `file-manager`, `form`, `shell`, `tables`, `ui`), `contexts/`, `css/`, `hooks/`, `icons/`, `lib/`, `wayfinder/`; entry `main.tsx`, `app.tsx`.
- `prompts/`: prompt Markdown cho AI agent.
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

## Quy tắc cho agent

- Đọc `~/.agents/CONTRACT.md` trước khi làm; tuân thủ các ràng buộc cứng trong đó.
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
