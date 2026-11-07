<h1 align="center">
  <img src="docs/logo.png" alt="codexis-ide" width="64" height="64" align="absmiddle" />
  Codexis IDE
</h1>

<p align="center">
  IDE desktop độc lập (Tauri 2 + Rust): soạn code, xem thay đổi git và trò chuyện với AI agent điều khiển các CLI <code>claude</code> / <code>codex</code> ngay trong thư mục dự án.
</p>

## Tính năng

- **Trình soạn code** (Monaco) với cây thư mục, tab tệp, đổi tên tệp, lưu có kiểm tra xung đột và diff thay đổi.
- **Git**: xem tệp đã thêm/sửa/xoá, nhánh hiện tại, hoàn tác và commit.
- **Terminal thật** (PTY) ngay trong app.
- **Chat với AI**: mỗi tin nhắn là một lượt chạy `claude` hoặc `codex` trong thư mục dự án; lịch sử và mã phiên của CLI được lưu theo từng thư mục, nên mở lại là tiếp tục đúng cuộc hội thoại. Dừng lượt đang chạy bằng nút dừng hoặc Ctrl+C.
- **Multichat**: chat thêm một cuộc trò chuyện song song với chat chính, đặt dưới vùng tệp hoặc ở chế độ nổi.
- **Relay giữa các AI**: `claude` và `codex` gọi nhau bằng khối `relay:<ai>` trong câu trả lời, tối đa 6 lượt, có nút dừng cả chuỗi (xem [docs/system/ai-relay.md](docs/system/ai-relay.md)).
- **Thanh phiên**: popup trên ô chat gồm môi trường, kết nối MCP, tệp AI đã ghi, thống kê sử dụng và GitHub.
- **Kế hoạch, tác vụ nền và sub-agent**: xem plan AI viết, việc chạy nền và sub-agent gọi bằng `@`.
- **Đính kèm**: dán ảnh hoặc tệp vào ô chat (hoặc nút `+`); tệp được gửi cho CLI dưới dạng `@đường-dẫn`. Dán code thành `tệp:dòng`.
- **Dự án**: lưu danh sách dự án (tên, thư mục, biến môi trường), mỗi dự án giữ chat riêng và mở lại dự án dùng lần trước.
- **Kết nối điện thoại từ xa** để nhắn tin cho AI từ điện thoại.
- **Bố cục tuỳ chỉnh**: kéo, di chuyển, lấp đầy từng panel; giao diện Việt/Anh.
- **Tự cập nhật**: khi có bản mới trên GitHub Releases, app báo và cập nhật khi bấm (xem [docs/system/app-update.md](docs/system/app-update.md)).
- Mở tệp đang xem trong VS Code.

Chưa có: CLI `gemini`.

## Tải về (macOS)

Tải tệp `.dmg` mới nhất tại [trang Releases](https://github.com/0132E282/codexis-ide/releases/latest), mở tệp và kéo app vào thư mục `Applications`.

- Bản hiện tại chỉ chạy trên Mac chip Apple Silicon (arm64).
- App chưa được ký số và notarize nên macOS có thể chặn lần mở đầu tiên. Bấm chuột phải vào app, chọn **Open**, hoặc chạy `xattr -cr "/Applications/Codexis IDE.app"`.
- Để chat với AI, cần cài sẵn và đăng nhập CLI `claude` hoặc `codex` (xem phần Yêu cầu).
- Từ các bản sau, app tự kiểm tra bản mới trên GitHub Releases: khi có bản mới sẽ hiện thông báo ở góc dưới bên phải, bấm **Cập nhật** để tự tải, cài và khởi động lại (không cần tải `.dmg` lại). Chức năng này chưa được kiểm với một bản phát hành thật.

## Yêu cầu

- [Node.js](https://nodejs.org) và [pnpm](https://pnpm.io).
- [Rust](https://rustup.rs) (toolchain stable) và các thành phần hệ thống của Tauri 2: xem [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/). Trên macOS cần Xcode Command Line Tools (`xcode-select --install`).
- Để chat với AI: cài ít nhất một CLI và đăng nhập sẵn, sao cho `claude` hoặc `codex` chạy được từ terminal. App tìm thêm trong `/opt/homebrew/bin`, `/usr/local/bin` và `~/.local/bin`.

## Cài đặt và chạy

```sh
pnpm install
pnpm start        # chạy app đầy đủ (tauri dev, tự build lại khi sửa code)
```

Các lệnh khác:

```sh
pnpm dev          # chỉ Vite (không có Rust nên các lệnh backend không chạy)
pnpm build        # chỉ build frontend
pnpm tauri build --bundles app,dmg  # đóng gói bản .app và .dmg (src-tauri/target/release/bundle/)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint (lint:fix để tự sửa)
pnpm format:check # prettier (format để tự sửa)

cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Cấu hình bằng biến môi trường

| Biến              | Tác dụng                                        | Mặc định                                              |
| ----------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `RYNOX_WORKSPACE` | Thư mục mở khi khởi động                        | Dự án mở lần trước, nếu không có thì thư mục hiện tại |
| `RYNOX_DB`        | Đường dẫn file SQLite lưu dự án và lịch sử chat | `rynox.db` trong thư mục dữ liệu của app              |

Ví dụ:

```sh
RYNOX_WORKSPACE=~/code/my-app RYNOX_DB=~/rynox-dev.db pnpm start
```

`.env.example` là file mẫu (`DB_CONNECTION=sqlite` và các biến `DB_*`); chép thành `.env` để dùng riêng, `.env` đã được git bỏ qua. App chưa tự đọc `.env`, hiện chỉ các biến trong bảng trên có tác dụng.

## CI

Workflow [`.github/workflows/build.yml`](.github/workflows/build.yml) chạy mỗi lần push, pull request hoặc chạy tay:

1. `test`: `pnpm lint`, `cargo fmt --check`, `cargo clippy -D warnings`, `pnpm build`, `cargo test`.
2. `build`: chỉ chạy khi `test` qua; chạy `pnpm tauri build` và upload bản `.app` thành artifact `codexis-ide-macos` (tải ở trang của lần chạy trong tab Actions).

## Phát hành (cho developers)

App tự cập nhật đọc `https://github.com/0132E282/codexis-ide/releases/latest/download/latest.json`, nên mỗi lần phát hành cần:

1. Tăng `version` trong `src-tauri/tauri.conf.json` (phải cao hơn bản người dùng đang cài).
2. Build với biến môi trường `TAURI_SIGNING_PRIVATE_KEY` (nội dung khoá riêng ký bản cập nhật) và `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (để trống nếu khoá không có mật khẩu). Khoá riêng không nằm trong repo; mất khoá thì các máy đã cài không nhận được bản mới nữa, phải đổi `plugins.updater.pubkey` và cài tay một lần.
3. Publish release **chính thức** (không phải draft hay pre-release) gồm `latest.json`, gói `*.app.tar.gz` kèm chữ ký `.sig` và tệp `.dmg`. `tauri-apps/tauri-action` với `includeUpdaterJson: true` tạo đủ các tệp này.

Workflow CI hiện tại ([`build.yml`](.github/workflows/build.yml)) chỉ kiểm tra và upload artifact `.app`, chưa tự tạo release. Chi tiết luồng và giới hạn: [docs/system/app-update.md](docs/system/app-update.md).

## Dữ liệu được lưu ở đâu

Trên macOS:

- `~/Library/Application Support/ai.geteasy.rynox-ide/rynox.db`: dự án, lịch sử chat, mã phiên CLI. File chỉ chủ sở hữu đọc được vì có thể chứa biến môi trường của dự án.
- `~/Library/Caches/ai.geteasy.rynox-ide/attachments/`: ảnh và tệp đã dán vào chat. Thư mục này là cache, xoá được.

Nếu có file `projects.json` cũ trong thư mục dữ liệu, các dự án trong đó được nhập vào `rynox.db` một lần; file cũ không bị xoá.

## Cấu trúc

- `src-tauri/` — backend Rust: workspace sandbox, git, terminal PTY, agent CLI và relay, lưu trữ SQLite, đính kèm, kiểm tra đầu vào (garde), tự cập nhật. Migration và seeder nằm ở `src-tauri/database/{migrations,seeders}`, test ở `src-tauri/tests/unit/`.
- `src/` — giao diện React 19 (Vite, Tailwind, Monaco). `src/lib/ide.ts` và `src/lib/api.ts` là nơi duy nhất gọi các Tauri command.
- `prompts/` — prompt cho AI agent.
- `docs/` — tài liệu hệ thống (`docs/system/`), kế hoạch (`docs/plans/`), testcase (`docs/repo/`) và thiết kế (`docs/design/`).

Quy ước làm việc với repo và các vấn đề đã biết nằm trong [AGENTS.md](AGENTS.md).
