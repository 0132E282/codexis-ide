# Kiến trúc Codexis IDE

Tài liệu tóm tắt cấu trúc, luồng dữ liệu và cơ sở dữ liệu của Codexis IDE. Mọi sơ đồ vẽ từ mã nguồn hiện có; chỗ nào là suy luận được ghi rõ ở mục [Giả định và giới hạn](#giả-định-và-giới-hạn).

- **Trạng thái**: Đã xác minh theo mã nguồn (`src-tauri/src`, `src`), chưa đối chiếu bằng chạy app.
- **Nguồn**: `lib.rs`, `commands/*`, `db.rs`, `chats.rs`, `projects.rs`, `profiles.rs`, `usage.rs`, `credentials.rs`, `settings.rs`, `remote.rs`, `agent.rs`, `git.rs`, `workspace.rs`, `src/lib/*.ts`.

## 1. Tổng quan

Codexis IDE là IDE desktop độc lập (Tauri 2 + Rust, UI React 19): soạn code, xem thay đổi git, terminal thật và khung chat điều khiển các CLI AI `claude` và `codex`. Dữ liệu nằm trên máy người dùng; điện thoại chỉ điều khiển từ xa qua WebSocket.

| Lớp       | Công nghệ                                          | Vai trò                                   |
| --------- | -------------------------------------------------- | ----------------------------------------- |
| UI        | React 19, Vite 8, Tailwind 4, Monaco, xterm, Radix | Hiển thị, soạn thảo, chat                 |
| Cầu nối   | Tauri `invoke` / `emit`, lớp `src/lib/*.ts`        | Gọi lệnh Rust, nhận sự kiện               |
| Lõi       | Rust (`src-tauri/src`)                             | Workspace, git, PTY, agent, lưu trữ       |
| Lưu trữ   | SQLite (`rynox.db`, thư mục dữ liệu app)           | Dự án, chat, tài khoản, thống kê, cài đặt |
| Bên ngoài | CLI `claude`, `codex`, `git`, VS Code              | Chạy AI, git, mở trong VS Code            |

## 2. Sơ đồ hệ thống

```mermaid
flowchart LR
    subgraph Desktop["Máy tính (Tauri app)"]
        direction TB
        UI["React UI<br/>sidebar · chat · editor · terminal"]
        API["src/lib/*.ts<br/>invoke · listen"]
        subgraph Core["Rust core"]
            CMD["commands/*<br/>38 lệnh Tauri"]
            WS["workspace<br/>sandbox đường dẫn"]
            GIT["git"]
            AGT["agent<br/>chạy CLI AI"]
            PTY["terminal<br/>PTY"]
            REM["remote<br/>WebSocket"]
            STORE["projects · chats · profiles<br/>usage · settings · credentials"]
        end
        DB[("rynox.db<br/>SQLite")]
        UI --> API --> CMD
        CMD --> WS & GIT & AGT & PTY & REM & STORE
        STORE --> DB
        AGT -. "agent-event" .-> UI
        REM -. "remote-send" .-> UI
    end

    CLI["claude / codex<br/>CLI"]
    GITBIN["git"]
    VSC["VS Code"]
    PHONE["Điện thoại<br/>cùng Wi-Fi hoặc VPN"]

    AGT --> CLI
    GIT --> GITBIN
    CMD --> VSC
    PHONE <-- "ws + token" --> REM
```

## 3. Cấu trúc mã

### Backend: `src-tauri/src`

```mermaid
flowchart TD
    lib["lib.rs<br/>khai báo module · generate_handler"] --> commands
    subgraph commands["commands/ (theo nhóm việc)"]
        state["state.rs<br/>AppState · khoá dùng chung"]
        files["files.rs"]
        projects_c["projects.rs"]
        git_c["git.rs"]
        agent_c["agent.rs<br/>agent_send · worktree"]
        chat_c["chat.rs"]
        att["attachments.rs"]
        term_c["terminal.rs"]
        rem_c["remote.rs"]
        auth_c["auth.rs"]
        ask["inline_ask.rs"]
    end
    files --> workspace["workspace.rs"]
    git_c --> git["git.rs"]
    agent_c --> agent["agent.rs"] & git
    chat_c --> chats["chats.rs"]
    projects_c --> projects["projects.rs"]
    term_c --> terminal["terminal.rs"]
    rem_c --> remote["remote.rs"]
    auth_c --> auth["auth.rs · profiles.rs · credentials.rs"]
    chats & projects & auth --> db["db.rs"]
    lib --> usage["usage.rs"] & settings["settings.rs"] & tools["tools.rs"] & vscode["vscode.rs"]
```

Quy ước: tên và shape (tham số, kiểu trả về) của lệnh Tauri được giữ ổn định; đổi phía Rust thì đổi `src/lib/*.ts` tương ứng.

### Frontend: `src`

- `app.tsx`: ghép hook và component; `hooks/use-workspace.ts` giữ trạng thái dự án, pane, cuộc chat.
- `components/shell/`: thanh bên, hộp thoại (cài đặt, thống kê, kết nối điện thoại, dự án mới) tải chậm qua `dialogs-host.tsx`; `chat/` chứa hook và component của khung chat.
- `components/ai-chat/code-viewer/`: tab, cây file, editor (Monaco), panel thay đổi.
- `lib/`: lớp gọi backend (`ide.ts`, `ide-*.ts`, `api.ts`), nơi duy nhất nên đổi khi đổi cách gọi backend.

## 4. Luồng chính

### 4.1. Một lượt chat AI

```mermaid
sequenceDiagram
    actor U as Người dùng
    participant C as ChatPanel
    participant R as agent_send (Rust)
    participant G as git
    participant P as CLI claude/codex
    participant D as SQLite

    U->>C: gửi tin nhắn
    C->>D: chat_save_turn (lưu ngay)
    C->>R: agent_send(cli, prompt, session, root, extraRoots, worktree)
    R->>R: workspace_for(root): chỉ dự án đã lưu
    opt chế độ Worktree
        R->>G: worktree add -b codexis/c‹id› (mỗi dự án)
    end
    R->>P: chạy trong thư mục dự án, prompt qua stdin, --add-dir cho dự án thêm
    loop luồng kết quả
        P-->>R: dòng JSON
        R-->>C: sự kiện agent-event (delta, text, tool, lỗi)
    end
    R-->>C: Done
    C->>D: lưu lượt đã xong
    C->>D: usage_record (độ dài, không lưu nội dung)
```

### 4.2. Điều khiển từ điện thoại

```mermaid
sequenceDiagram
    actor U as Người dùng
    participant D as Hộp thoại QR (desktop)
    participant S as remote.rs (WebSocket)
    participant M as Điện thoại
    participant C as ChatPanel

    U->>D: mở "Kết nối điện thoại"
    D->>S: remote_start
    S-->>D: host, port, token → vẽ QR
    M->>D: quét QR
    M->>S: ws connect + {"type":"auth","token"} (trong 5 giây)
    S-->>M: {"type":"ready"}
    M->>S: {"type":"send","prompt"}
    S-->>C: sự kiện remote-send (chỉ khi chat rảnh)
    C->>C: xử lý như người dùng tự gửi
    S-->>M: mọi agent-event của chat
    U->>D: đóng hộp thoại → remote_stop, token hết hiệu lực
```

### 4.3. Đăng nhập CLI và nhiều tài khoản

Codexis không bao giờ thấy mật khẩu hay token: đăng nhập chạy luồng đăng nhập của chính CLI, rồi đọc trạng thái lại từ CLI. Mỗi tài khoản phụ là một thư mục hồ sơ riêng, CLI được trỏ tới đó bằng biến môi trường (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GH_CONFIG_DIR`).

```mermaid
sequenceDiagram
    actor U as Người dùng
    participant UI as Cài đặt → Kết nối
    participant A as auth.rs
    participant PR as profiles.rs
    participant CLI as claude / codex / gh
    participant B as Trình duyệt

    U->>UI: Thêm mới tài khoản
    UI->>PR: profile_add(cli, tên)
    PR-->>UI: hồ sơ mới (thư mục riêng)
    U->>UI: Đăng nhập
    UI->>A: auth_login(provider, profile)
    A->>CLI: chạy lệnh login với biến môi trường của hồ sơ
    CLI->>B: mở trang đăng nhập
    opt GitHub
        CLI-->>A: mã một lần
        A-->>UI: hiện mã để nhập trên github.com/login/device
    end
    loop thăm dò trạng thái
        UI->>A: auth_status_profile
        A->>CLI: status (đọc email, đã đăng nhập chưa)
        CLI-->>UI: loggedIn, account
    end
    U->>UI: Chọn tài khoản đang dùng
    UI->>PR: profile_select → active_profiles
```

### 4.4. Terminal

Mỗi terminal là một shell thật chạy trong pseudo-terminal (PTY) tại thư mục dự án.

```mermaid
sequenceDiagram
    participant X as xterm (UI)
    participant T as terminal.rs
    participant S as Shell (PTY)

    X->>T: terminal_open(id, cột, hàng, root)
    T->>S: mở PTY, chạy shell trong thư mục dự án
    loop đọc đầu ra (khối 8 KB)
        S-->>T: byte đầu ra
        T-->>X: sự kiện terminal-data {id, data}
    end
    X->>T: terminal_write(id, phím gõ)
    T->>S: ghi vào PTY
    X->>T: terminal_resize(id, cột, hàng)
    T->>S: đổi kích thước PTY
    S-->>T: shell kết thúc
    T-->>X: sự kiện báo shell đã đóng
    X->>T: terminal_close(id)
```

### 4.5. Skill, agent, MCP, rule và hook (chỉ đọc)

`tools.rs` chỉ liệt kê cấu hình có trên máy, không ghi gì. Bí mật (giá trị env, header, token, tham số, query URL) không bao giờ được trả về.

```mermaid
flowchart LR
    subgraph Nguon["Nguồn cấu hình"]
        P["Thư mục dự án"]
        H["Thư mục home"]
    end
    subgraph Doc["tools.rs (chỉ đọc)"]
        G["Giới hạn kích thước file<br/>symlink chỉ đi trong thư mục gốc"]
        L["tools_skills · tools_agents · tools_mcp<br/>tools_rules · tools_hooks"]
    end
    P --> G
    H --> G
    G --> L
    L --> UI["Cài đặt: Skill · Agent · MCP · Rules · Hook"]
    L --> CH["Gợi ý / và @ trong khung chat"]
```

## 5. Cơ sở dữ liệu (ERD)

Một file SQLite `rynox.db` trong thư mục dữ liệu app (đổi bằng biến `RYNOX_DB`), quyền chỉ chủ sở hữu trên Unix. **Không khai báo `FOREIGN KEY`**: các đường nối dưới đây là quan hệ logic do mã duy trì.

```mermaid
erDiagram
    projects {
        TEXT id PK
        INTEGER position
        TEXT name
        TEXT folders "JSON, thư mục đầu là root"
        TEXT env "JSON biến môi trường"
    }
    meta {
        TEXT key PK
        TEXT value "vd. dự án đang chọn"
    }
    conversations {
        INTEGER id PK
        TEXT workspace "root của dự án"
        TEXT title
        INTEGER updated_at
    }
    chat_turns {
        TEXT workspace PK
        TEXT id PK
        INTEGER position
        TEXT cli
        TEXT prompt
        TEXT answer
        TEXT error
        INTEGER archived
        INTEGER conversation "tham chiếu conversations.id"
    }
    conversation_sessions {
        INTEGER conversation PK
        TEXT cli PK
        TEXT session "id phiên của CLI"
    }
    chat_sessions {
        TEXT workspace PK
        TEXT cli PK
        TEXT session "bảng cũ, chỉ để di trú"
    }
    profiles {
        INTEGER id PK
        TEXT cli
        TEXT name
    }
    active_profiles {
        TEXT cli PK
        INTEGER profile_id "tham chiếu profiles.id"
    }
    usage_events {
        INTEGER id PK
        TEXT cli
        INTEGER at
        TEXT model
        INTEGER prompt_characters
        INTEGER answer_characters
        INTEGER failed
        INTEGER limited
        INTEGER profile "tài khoản đã dùng"
    }
    settings {
        TEXT key PK
        TEXT value "JSON"
    }
    credentials {
        TEXT name PK
        TEXT value "khoá API đã lưu"
    }

    projects ||--o{ conversations : "root ↔ workspace"
    conversations ||--o{ chat_turns : "chứa lượt"
    conversations ||--o{ conversation_sessions : "phiên theo CLI"
    profiles ||--o{ usage_events : "tính theo tài khoản"
    profiles ||--o| active_profiles : "đang dùng"
```

Ghi chú:

- Chỉ mục: `usage_events_cli_at (cli, at)`.
- `db.rs` tự nâng cấp file cũ bằng `add_column_if_missing` (cột `archived`, `conversation`) và gom lượt chat cũ vào một cuộc trò chuyện (`group_old_turns`). File không phải database bị chuyển thành `*.corrupt` rồi tạo mới; nếu vẫn không mở được, app chạy bằng DB trong bộ nhớ.
- Nội dung chat (`prompt`, `answer`) nằm trong `chat_turns`; thống kê (`usage_events`) chỉ lưu độ dài, không lưu nội dung.

## 6. Ranh giới an toàn

- **Workspace sandbox** (`workspace.rs`): chỉ nhận đường dẫn tương đối, làm sạch và kiểm tra trong root; chặn symlink ra ngoài, chặn file nằm trong danh sách cấm (ví dụ `.env`, khoá); giới hạn kích thước; ghi có kiểm tra băm mong đợi.
- **Dự án**: lệnh nhận `root` chỉ chấp nhận dự án đã lưu hoặc workspace đang mở (`workspace_for`); dự án thêm trong một lượt chat đi qua cùng cửa kiểm tra.
- **Worktree**: lượt chat chạy trên nhánh `codexis/c<id>` trong bản sao ở thư mục dữ liệu app, dự án gốc không bị sửa; tên worktree chỉ gồm chữ, số, dấu gạch.
- **Điện thoại**: WebSocket `ws://` (không mã hóa) với token ngẫu nhiên mỗi lần mở; tối đa 3 máy; chỉ tin `send` được xử lý. Chỉ dùng trên mạng tin cậy hoặc qua VPN.
- **Bí mật**: file DB chứa khoá API và biến môi trường dự án nên chỉ chủ sở hữu đọc được; không đưa secret vào repo.

## 7. Lệnh phát triển

```sh
pnpm install
pnpm start            # tauri dev (app đầy đủ)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm build            # build frontend
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib <module>::
```

## 8. Giả định và giới hạn

- Quan hệ trong ERD là quan hệ logic suy ra từ tên cột và truy vấn; schema không có khoá ngoại. Cột `usage_events.profile` được thêm bằng di trú nên không có trong khối `CREATE TABLE` gốc.
- Số lệnh Tauri (38) và thứ tự module lấy từ lần tách `commands/` gần nhất; chưa có kiểm tra tự động giữ hai con số này đúng.
- Ba luồng ở mục 4.3 đến 4.5 (đăng nhập CLI, terminal, tools) vẽ từ phần đầu mỗi module và chữ ký hàm công khai; chưa đọc hết thân hàm nên thứ tự chi tiết (ví dụ khoảng thăm dò trạng thái) chưa được xác minh.
- Vấn đề đã biết: `cargo test --lib` đầy đủ không kết thúc vì `terminal::tests::a_shell_runs_in_a_pseudo_terminal` treo; `workspace::tests::binary_files_are_read_as_bytes_but_not_as_text` đang fail; typecheck có các lỗi có sẵn (xem `AGENTS.md`).
