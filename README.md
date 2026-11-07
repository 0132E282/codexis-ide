<h1 align="center">
  <img src="src-tauri/icons/128x128.png" alt="Codexis IDE" width="64" height="64" align="absmiddle" />
  Codexis IDE
</h1>

<p align="center">
  <strong>Trình soạn code desktop có AI agent tích hợp.</strong><br />
  Soạn code, theo dõi thay đổi Git, chạy terminal và làm việc cùng <code>claude</code> / <code>codex</code> ngay trong thư mục dự án của bạn.
</p>

<p align="center">
  <a href="https://github.com/0132E282/codexis-ide/actions/workflows/build.yml"><img src="https://github.com/0132E282/codexis-ide/actions/workflows/build.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Giấy phép MIT" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-lightgrey.svg" alt="Nền tảng macOS" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB.svg" alt="Tauri 2" />
</p>

## Giới thiệu

Codexis IDE là IDE desktop độc lập, xây dựng trên Tauri 2 (backend Rust) và React 19. Ứng dụng gom trình soạn code, Git, terminal thật và AI agent vào một cửa sổ. Agent không chạy trong tiến trình của IDE: mỗi lượt chat là một lần gọi CLI `claude` hoặc `codex` đã cài và đăng nhập trên máy, trong thư mục dự án bạn chọn. IDE lo phần giao diện, quyền truy cập tệp, lưu lịch sử và hiển thị luồng sự kiện của CLI.

## Tính năng

- **Trình soạn code**: Monaco, cây thư mục, tab tệp, đổi tên, lưu có kiểm tra xung đột bằng hash nội dung, diff thay đổi, mở nhanh tệp.
- **Terminal thật**: shell chạy qua PTY ngay trong app.
- **Git**: tệp thay đổi, commit, hoàn tác, lịch sử commit, lịch sử từng tệp, blame, nhánh (so sánh, checkout, merge, pull). IDE không push.
- **AI agent**: điều khiển CLI `claude` và `codex`; lịch sử và mã phiên CLI được lưu theo thư mục dự án nên mở lại là tiếp tục đúng hội thoại. Có chế độ quyền, đính kèm ảnh/tệp, relay giữa hai AI (tối đa 6 lượt), tác vụ nền và sub-agent. CLI `gemini` chưa được hỗ trợ.
- **Lưới chat và khung nổi**: đặt tối đa 4 chat cạnh nhau theo nhóm, chat song song (multichat), vùng tệp và panel ở chế độ nổi.
- **Plans**: đọc `docs/plans/` của dự án thành danh sách thẻ (tiêu đề, trạng thái, tiến độ), chỉ đọc.
- **Language server**: dùng lại language server có sẵn trong extension VS Code (VS Code, Insiders, Cursor, VSCodium) đã cài trên máy; IDE chỉ đọc manifest, không chạy script của extension.
- **Giọng nói**: đọc câu trả lời bằng máy chủ TTS cục bộ (VieNeu-TTS) do người dùng tự chạy; chỉ kết nối địa chỉ loopback.
- **Dữ liệu và dung lượng**: thống kê dung lượng dữ liệu của chính IDE, cảnh báo khi quá lớn, dọn dẹp khi người dùng xác nhận.
- **Ứng dụng**: bố cục panel tuỳ chỉnh, giao diện Việt/Anh, tự cập nhật qua GitHub Releases, kết nối điện thoại từ xa.

## Kiến trúc

Frontend không chứa logic nghiệp vụ: chỉ hiển thị và gọi lệnh Tauri. Mọi tính năng nằm ở backend Rust.

```mermaid
flowchart LR
    UI["React 19<br/>Monaco, xterm, diff"] -->|invoke| Bridge["src/lib/ide*.ts<br/>api.ts"]
    Bridge -->|lệnh Tauri| Cmd["commands/*"]
    Cmd --> WS["workspace.rs<br/>sandbox thư mục dự án"]
    Cmd --> Git["git.rs, git_history.rs"]
    Cmd --> Term["terminal.rs (PTY)"]
    Cmd --> Agent["agent.rs, relay.rs"]
    Cmd --> LSP["language_server*.rs"]
    Cmd --> DB[("SQLite<br/>codexis.db")]
    Agent --> CLI["CLI claude / codex"]
    LSP --> Ext["Language server<br/>từ extension VS Code"]
    Cmd -.->|sự kiện| UI
```

**Backend (`src-tauri/src`)**

- `lib.rs`, `main.rs`: khai báo module và đăng ký lệnh Tauri; `commands/` là lớp lệnh mỏng gọi vào các module.
- `workspace.rs`, `permission.rs`: sandbox thư mục dự án và chính sách đường dẫn.
- `git.rs`, `git_history.rs`: Git qua lệnh `git`; lịch sử, blame, nhánh.
- `terminal.rs`: PTY.
- `agent.rs`, `agent/`, `relay.rs`, `background.rs`, `auth.rs`: chạy CLI, sự kiện luồng, relay, tác vụ nền, trạng thái đăng nhập.
- `language_server*.rs`, `vscode_extensions.rs`: quét extension và quản lý vòng đời language server.
- `plan_docs.rs`, `plan*.rs`: plans của dự án.
- `db.rs`, `chats.rs`, `projects.rs`, `settings.rs`, `usage.rs`, `activity.rs`, `migrations.rs`: lưu trữ SQLite.
- `storage.rs`, `run_log.rs`, `attachments.rs`: dung lượng, nhật ký lượt chat, tệp đính kèm.
- `speech.rs`, `remote.rs`, `app_update.rs`, `validation.rs`: giọng nói, điện thoại từ xa, tự cập nhật, kiểm tra đầu vào.

**Frontend (`src`)**

- `src/lib/ide.ts` cùng các tệp `src/lib/ide-*.ts` và `src/lib/api.ts` là lớp cầu nối duy nhất tới lệnh Tauri; đổi cách gọi backend chỉ sửa ở đây.
- `src/components/shell/`: khung ứng dụng (sidebar, chat, lưới chat, panel, khung nổi); `src/components/file-manager/`: trình soạn code, diff, blame.
- `src/hooks/`, `src/contexts/`, `src/css/`, `src/icons/`: hook, context, kiểu và biểu tượng dùng chung.

Chi tiết thiết kế: [docs/system/architecture.md](docs/system/architecture.md).

## Luồng hoạt động

**Gửi tin cho agent**

```mermaid
sequenceDiagram
    participant UI as Giao diện
    participant BE as Backend Rust
    participant CLI as CLI claude / codex
    UI->>BE: agent_send (prompt, thư mục dự án)
    BE->>CLI: chạy CLI trong thư mục dự án
    CLI-->>BE: luồng JSON (văn bản, công cụ, lỗi)
    BE-->>UI: sự kiện agent-event
    BE->>BE: lưu lượt chat vào SQLite
    UI->>BE: agent_stop (khi người dùng dừng)
```

**Mở tệp và language server**

```mermaid
sequenceDiagram
    participant UI as Giao diện
    participant WS as workspace.rs
    participant LS as Language server
    UI->>WS: workspace_read (đường dẫn tương đối)
    WS->>WS: chuẩn hoá, kiểm tra deny list, đường dẫn thật nằm trong dự án
    WS-->>UI: nội dung và hash
    UI->>LS: language_server_document_open
    LS-->>UI: sự kiện language-server-diagnostics
```

## Bảo mật và quyền riêng tư

- **Sandbox workspace**: tệp được gọi bằng đường dẫn tương đối; mỗi đường dẫn được chuẩn hoá, đối chiếu deny list và phải phân giải về một đường dẫn thật nằm trong dự án (liên kết không thoát được ra ngoài). Thông báo lỗi không chứa đường dẫn của máy.
- **Git**: chạy trên dự án đang mở, không push; tệp trong deny list không hiện và không bao giờ bị commit.
- **Nhật ký lượt chat** (`run_log.rs`): chỉ ghi tên công cụ và mã lỗi, không ghi prompt, câu trả lời, khoá API hay biến môi trường; giữ 14 ngày.
- **Giọng nói và language server**: giọng nói chỉ kết nối loopback qua HTTP và từ chối chuyển hướng; extension VS Code chỉ được đọc manifest.
- **Xoá và dọn dẹp** chỉ thực hiện khi người dùng xác nhận; phần dọn dung lượng chỉ đụng tới dữ liệu của chính IDE, không chạm thư mục dự án.

## Yêu cầu

- [Node.js](https://nodejs.org) và [pnpm](https://pnpm.io).
- [Rust](https://rustup.rs) (toolchain stable) và các thành phần hệ thống của Tauri 2: xem [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/). Trên macOS cần Xcode Command Line Tools (`xcode-select --install`).
- Để chat với AI: cài ít nhất một CLI và đăng nhập sẵn, sao cho `claude` hoặc `codex` chạy được từ terminal. App tìm thêm trong `/opt/homebrew/bin`, `/usr/local/bin` và `~/.local/bin`.

## Tải về (macOS)

Tải tệp `.dmg` mới nhất tại [trang Releases](https://github.com/0132E282/codexis-ide/releases/latest), mở tệp và kéo app vào thư mục `Applications`.

- Bản hiện tại chỉ chạy trên Mac chip Apple Silicon (arm64).
- App chưa được ký số và notarize nên macOS có thể chặn lần mở đầu tiên. Bấm chuột phải vào app, chọn **Open**, hoặc chạy `xattr -cr "/Applications/Codexis IDE.app"`.
- Để chat với AI, cần cài sẵn và đăng nhập CLI `claude` hoặc `codex` (xem phần Yêu cầu).
- Từ các bản sau, app tự kiểm tra bản mới trên GitHub Releases: khi có bản mới sẽ hiện thông báo ở góc dưới bên phải, bấm **Cập nhật** để tự tải, cài và khởi động lại (không cần tải `.dmg` lại). Chức năng này chưa được kiểm với một bản phát hành thật.

## Cài đặt và chạy

```sh
pnpm install
pnpm start        # chạy app đầy đủ (tauri dev)
```

Các lệnh khác:

```sh
pnpm dev          # chỉ Vite (không có backend Tauri)
pnpm build        # chỉ build frontend
pnpm tauri build --bundles app,dmg  # đóng gói .app và .dmg
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint (lint:fix để tự sửa)
pnpm format       # prettier --write (format:check để kiểm tra)
pnpm test:e2e     # Playwright, chạy trên Vite

cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Cấu hình bằng biến môi trường

| Biến              | Tác dụng                                        | Mặc định                                              |
| ----------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `RYNOX_WORKSPACE` | Thư mục mở khi khởi động                        | Dự án mở lần trước, nếu không có thì thư mục hiện tại |
| `RYNOX_DB`        | Đường dẫn file SQLite lưu dự án và lịch sử chat | `codexis.db` trong thư mục dữ liệu của app            |

Ví dụ:

```sh
RYNOX_WORKSPACE=~/code/my-app RYNOX_DB=~/rynox-dev.db pnpm start
```

`.env.example` là file mẫu (`DB_CONNECTION=sqlite` và các biến `DB_*`); chép thành `.env` để dùng riêng, `.env` đã được git bỏ qua. App chưa tự đọc `.env`, hiện chỉ các biến trong bảng trên có tác dụng.

## CI

Workflow [`.github/workflows/build.yml`](.github/workflows/build.yml) chạy mỗi lần push, pull request hoặc chạy tay:

1. `changes`: so sánh với commit nền để biết thay đổi nằm ở frontend (`src/`, `package.json`, `pnpm-lock.yaml`, cấu hình Vite/TypeScript/ESLint…) hay backend (`src-tauri/`). Chạy tay, nhánh mới hoặc sửa chính workflow thì chạy cả hai.
2. `frontend`: chỉ chạy khi frontend đổi: `pnpm lint`, `pnpm build`.
3. `backend`: chỉ chạy khi `src-tauri/` đổi: `pnpm build` (Tauri cần frontend đã build), `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`.
4. `build`: chạy khi một trong hai phía đổi và không có job nào fail; chạy `pnpm tauri build` và upload bản `.app` thành artifact `codexis-ide-macos` (tải ở trang của lần chạy trong tab Actions). Chỉ đổi tài liệu thì không job nào ngoài `changes` chạy. Khi repo chưa có secret `TAURI_SIGNING_PRIVATE_KEY`, job build bỏ qua bản cập nhật và chỉ build `.app` không ký.

## Phát hành (cho developers)

App tự cập nhật đọc `https://github.com/0132E282/codexis-ide/releases/latest/download/latest.json`, nên mỗi lần phát hành cần:

1. Tăng `version` trong `src-tauri/tauri.conf.json` (phải cao hơn bản người dùng đang cài).
2. Build với biến môi trường `TAURI_SIGNING_PRIVATE_KEY` (nội dung khoá riêng ký bản cập nhật) và `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (để trống nếu khoá không có mật khẩu). Khoá riêng không nằm trong repo; mất khoá thì các máy đã cài không nhận được bản mới nữa, phải đổi `plugins.updater.pubkey` và cài tay một lần. Phát hành bằng CI cần hai secret GitHub `TAURI_SIGNING_PRIVATE_KEY` và `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Publish release **chính thức** (không phải draft hay pre-release) gồm `latest.json`, gói `*.app.tar.gz` kèm chữ ký `.sig` và tệp `.dmg`. `tauri-apps/tauri-action` với `includeUpdaterJson: true` tạo đủ các tệp này.

Workflow CI hiện tại ([`build.yml`](.github/workflows/build.yml)) chỉ kiểm tra và upload artifact `.app`, chưa tự tạo release. Workflow [`tag.yml`](.github/workflows/tag.yml) chạy mỗi push lên nhánh chính: tự tăng PATCH (0.1.0 → 0.1.1) ở `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, commit `chore: phát hành v<version> [skip ci]` rồi tạo tag `v<version>`; không cần tăng version tay cho bản vá, còn minor/major vẫn sửa tay. Tag này không phải release và không kích hoạt workflow khác. Nhánh có branch protection chặn bot push thì cần cho phép `github-actions[bot]`. Chi tiết luồng và giới hạn: [docs/system/app-update.md](docs/system/app-update.md).

## Dữ liệu được lưu ở đâu

Trên macOS:

- `~/Library/Application Support/ai.geteasy.rynox-ide/codexis.db` (file `rynox.db` của bản cũ được đổi tên thành `codexis.db` ở lần mở đầu): dự án, lịch sử chat, mã phiên CLI. File chỉ chủ sở hữu đọc được vì có thể chứa biến môi trường của dự án.
- `~/Library/Caches/ai.geteasy.rynox-ide/attachments/`: ảnh và tệp đã dán vào chat. Thư mục này là cache, xoá được.

Nếu có file `projects.json` cũ trong thư mục dữ liệu, các dự án trong đó được nhập vào `codexis.db` một lần; file cũ không bị xoá.

## Cấu trúc thư mục

- `src-tauri/`: backend Rust. Migration và seeder ở `src-tauri/database/{migrations,seeders}`, test ở `src-tauri/tests/unit/`.
- `src/`: giao diện React 19 (Vite, Tailwind 4, Monaco, xterm).
- `prompts/`: prompt Markdown cho AI agent.
- `e2e/`: test Playwright.
- `docs/`: tài liệu hệ thống [`docs/system/`](docs/system/), kế hoạch [`docs/plans/`](docs/plans/), testcase `docs/repo/` và thiết kế [`docs/design/`](docs/design/DESIGN.md).

Một số tài liệu hệ thống: [kiến trúc](docs/system/architecture.md), [language server](docs/system/language-servers.md), [relay AI](docs/system/ai-relay.md), [cơ sở dữ liệu](docs/system/database.md), [tác vụ nền](docs/system/background-tasks.md), [tự cập nhật](docs/system/app-update.md).

## Đóng góp

- Đọc [AGENTS.md](AGENTS.md) trước: lệnh, quy ước và các vấn đề đã biết.
- Đặt tên: biến camelCase, lệnh Tauri snake_case, tệp TS/TSX kebab-case.
- Test Rust đặt ở `src-tauri/tests/unit/`, không viết inline trong `src/`.
- Đổi lệnh Tauri phía Rust thì đổi `src/lib/api.ts` hoặc `src/lib/ide*.ts` tương ứng.
- Không đưa secret vào repo.

## Giấy phép

Mã nguồn mở theo giấy phép [MIT](LICENSE).
