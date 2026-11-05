---
title: Đăng nhập tài khoản Google/GitHub ở footer sidebar
description: Thiết kế OAuth cho app Tauri 2 không có server (Google loopback + PKCE, GitHub device flow), lưu trữ, UI footer sidebar, cấu hình client ID và task triển khai. Đọc khi làm tính năng đăng nhập/đăng xuất hoặc đụng tới OAuth trong Codexis IDE.
tags: [design, oauth, tauri, google, github, sidebar, auth]
---

# Đăng nhập tài khoản (Google / GitHub)

Trạng thái: thiết kế, chưa triển khai. Facts đã kiểm chứng ngày 2026-11-04 ghi `[đã kiểm]`; còn lại là đề xuất hoặc `[chưa kiểm]`.

## 1. Phạm vi

- Footer `src/components/shell/sidebar.tsx` (dòng "Chưa kết nối trợ lý AI") thành nút kết nối: chọn Google hoặc GitHub, hiển thị tài khoản (tên, avatar, email hoặc login), cho đăng xuất.
- **Ngoài phạm vi:** kết nối trợ lý AI, CLI claude/codex/gemini, gọi API Google/GitHub ngoài việc lấy hồ sơ, nhiều tài khoản cùng lúc, đồng bộ đám mây.
- Ràng buộc: Tauri 2.12 (`src-tauri/Cargo.lock`), không có server, chưa có Client ID; không đưa secret vào repo. Front end gọi Rust qua `invoke` (mẫu `src/lib/ide.ts`); lỗi trả về chuỗi tiếng Việt cố định (mẫu `src-tauri/src/commands.rs`).

| ID  | Yêu cầu          | Tiêu chí chấp nhận                                                                 |
| --- | ---------------- | ---------------------------------------------------------------------------------- |
| R1  | Đăng nhập Google | Mở trình duyệt hệ thống, đồng ý xong thì footer hiện tên/avatar/email              |
| R2  | Đăng nhập GitHub | Hiện mã thiết bị, người dùng nhập mã trên github.com, footer hiện tên/avatar/login |
| R3  | Đăng xuất        | Footer quay về "chưa kết nối", không còn dữ liệu tài khoản trên máy                |
| R4  | Huỷ / hết giờ    | Huỷ hoặc quá thời gian thì về trạng thái chưa kết nối, cổng loopback được đóng     |
| R5  | Không lộ secret  | Không có token/secret trong repo, trong log hay trong thông báo lỗi                |
| R6  | Thiếu cấu hình   | Thiếu Client ID của provider nào thì nút provider đó bị tắt kèm lý do              |

## 2. Luồng OAuth theo provider

**So sánh redirect cho app desktop:**

| Phương án                                            | Ưu                                                                                               | Nhược                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loopback `http://127.0.0.1:<cổng ngẫu nhiên>` + PKCE | Không cần đăng ký scheme với OS; RFC 8252 khuyến nghị; Google hỗ trợ cho Desktop app `[đã kiểm]` | Phải chạy listener HTTP tạm; firewall hiếm khi chặn loopback                                                                                                                                                                               |
| Custom scheme / deep link (`tauri-plugin-deep-link`) | Không mở cổng                                                                                    | Google không cho custom scheme với client Desktop (chỉ nhắc tới cho mobile) `[đã kiểm: Google chỉ khuyến nghị loopback cho macOS/Linux/Windows]`; app khác có thể chiếm cùng scheme; phải đăng ký scheme khi bundle, khó trong `tauri dev` |
| Device flow (RFC 8628)                               | Không cần redirect, không cần secret                                                             | Người dùng phải nhập mã                                                                                                                                                                                                                    |

**Google: Authorization Code + PKCE (S256) + loopback.** `[đã kiểm]`

- Loại client "Desktop app"; Google ghi rõ Desktop là public client, không giữ được secret, luôn dùng PKCE.
- Endpoint (OpenID discovery): auth `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`, userinfo `https://openidconnect.googleapis.com/v1/userinfo`, revoke `https://oauth2.googleapis.com/revoke`; hỗ trợ `S256`.
- Scope `openid email profile`. Bảng tham số token của Google ghi `client_secret` là **Optional**. Google vẫn cấp secret cho Desktop client và coi nó là không bí mật. `[chưa kiểm thực tế]`: token endpoint có chấp nhận yêu cầu không gửi secret với client Desktop hay không. Vì vậy hỗ trợ biến tuỳ chọn `RYNOX_GOOGLE_CLIENT_SECRET` (chỉ gửi khi có).
- Không cần đăng ký redirect URI trong Console cho Desktop app; cổng loopback nào cũng được. `[chưa kiểm hoàn toàn]`: form Desktop không có ô redirect URI.

**GitHub: OAuth App + Device flow.** `[đã kiểm]`

- Web flow có PKCE (chỉ `S256`) và chấp nhận loopback `http://127.0.0.1:<cổng bất kỳ>/path` nếu callback là `http://127.0.0.1/path`. Nhưng bước đổi code **bắt buộc `client_secret`**, nên không dùng được nếu không ship secret.
- Device flow: `POST https://github.com/login/device/code` rồi poll `POST https://github.com/login/oauth/access_token` với `grant_type=urn:ietf:params:oauth:grant-type:device_code`; **không cần `client_secret`**. Mã hết hạn sau `expires_in` (mặc định 900 s); poll theo `interval`, `slow_down` cộng thêm 5 s. Phải bật "Enable Device Flow" trong cài đặt app. Gửi `Accept: application/json`.
- Scope: **rỗng**, tức chỉ đọc thông tin công khai (đủ cho `GET https://api.github.com/user`: `login`, `name`, `avatar_url`). Không xin `user:email`; footer hiển thị `login`.
- Thu hồi token (`DELETE /applications/{client_id}/token`) cần Basic auth với `client_secret`, nên app **không tự thu hồi được**. Đăng xuất chỉ xoá dữ liệu cục bộ; người dùng thu hồi tại github.com/settings/applications.

## 3. Thiết kế phía Rust

Module mới `src-tauri/src/auth.rs` (logic) và các command mỏng trong `commands.rs` (giữ mẫu hiện có).

**Command** (front end bọc trong `src/lib/auth.ts`):

| Command          | Vào                              | Ra                                                                                    |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `auth_providers` | –                                | `{ google: bool, github: bool }`: provider nào đã có Client ID                        |
| `auth_status`    | –                                | `Account \| null` (đọc từ bộ lưu)                                                     |
| `auth_start`     | `provider: "google" \| "github"` | `{ kind: "browser" }` hoặc `{ kind: "device", userCode, verificationUri, expiresIn }` |
| `auth_finish`    | –                                | `Account` (async, chờ tới khi xong, lỗi, huỷ hoặc hết giờ)                            |
| `auth_cancel`    | –                                | `()`                                                                                  |
| `auth_logout`    | –                                | `()`                                                                                  |

`Account = { provider, id, name, detail /* email hoặc login */, avatarUrl }`.

**State machine** (`Mutex<AuthFlow>` trong state Tauri): `Idle → Pending{provider, task, result_rx} → Idle`.

- `auth_start` khi đang `Pending` thì huỷ luồng cũ rồi bắt đầu luồng mới. Task chạy trên `tauri::async_runtime` và trả kết quả qua `oneshot`.
- `auth_cancel` gọi abort task; drop task thì listener cũng bị drop nên cổng đóng. `auth_finish` trả lỗi "Đã huỷ đăng nhập.".
- Kết quả thành công: lấy hồ sơ, ghi bộ lưu, trả `Account`. Token chỉ nằm trong bộ nhớ của task (xem mục 4).

**Google, chi tiết:**

1. Tạo `code_verifier` 32 byte ngẫu nhiên (base64url, 43 ký tự). `code_challenge = base64url(sha256(verifier))`. `state` là 32 byte ngẫu nhiên khác.
2. Bind `127.0.0.1:0`. `redirect_uri = http://127.0.0.1:<port>`. Mở URL auth bằng trình duyệt hệ thống.
3. Nhận từng kết nối: chỉ chấp nhận `GET /?…`. So `state` bằng so sánh hằng thời gian; sai `state` hoặc có `error` thì trả lỗi. Request khác (ví dụ `/favicon.ico`) trả 404 rồi đợi tiếp. Trả trang HTML tĩnh "Đăng nhập xong, bạn có thể đóng tab này và quay lại Rynox." Sau đó đóng listener.
4. Đổi code (gửi kèm `code_verifier`, `client_secret` nếu có), gọi userinfo, rồi revoke token (best-effort, bỏ qua lỗi).

- Timeout: chờ callback 5 phút; mỗi HTTP request 15 s.

**GitHub, chi tiết:** gọi `device/code`, trả `userCode` cho UI, mở `verification_uri`. Poll theo `interval` (xử lý `authorization_pending`, `slow_down`; `expired_token`/`access_denied` thì lỗi) tới khi quá `expires_in`. Có token thì gọi `GET /user` với `User-Agent: Rynox-IDE`.

**Crate** (phiên bản crates.io ngày 2026-11-04). Không dùng crate `oauth2` 5.0: luồng ngắn và tự viết thì kiểm soát được secret/log; crate đó cũng không thay được device-flow polling riêng của GitHub.

| Crate                                        | Mục đích                                                           | Ghi chú                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `tauri-plugin-opener` 2.7.2                  | `app.opener().open_url(url, None::<&str>)` mở trình duyệt hệ thống | Yêu cầu `tauri ^2.12` (khớp lock 2.12.5) `[đã kiểm]`                               |
| `reqwest` 0.13 (`json`, TLS rustls)          | gọi token/userinfo                                                 | Đã có trong lock dạng phụ thuộc gián tiếp; `[chưa kiểm]` tên feature TLS của 0.13  |
| `tokio` 1 (`net`, `time`, `io-util`, `sync`) | listener loopback, timeout, oneshot                                | Đã có trong lock (1.54)                                                            |
| `getrandom` 0.3 + `base64` (URL_SAFE_NO_PAD) | verifier/state                                                     | Cả hai đã có trong lock; `sha2` đã là dependency trực tiếp                         |
| `keyring` 4.2.0                              | chỉ khi chọn phương án B ở mục 4                                   | Feature mặc định `v1` giữ API cũ (`Entry::new`, `set_password`) `[đã kiểm README]` |

**Capability:** mở URL từ Rust không đi qua IPC của JS, nên không cần thêm permission `opener:*` vào `capabilities/default.json`. Chỉ cần đăng ký `.plugin(tauri_plugin_opener::init())` trong `lib.rs`. Không bật `opener:default` cho webview (YAGNI). CSP hiện là `null` nên ảnh avatar từ `lh3.googleusercontent.com`/`avatars.githubusercontent.com` tải được; nếu sau này bật CSP thì phải thêm `img-src` cho hai host này.

## 4. Lưu trữ

Mục tiêu là lưu đúng cái cần dùng. Yêu cầu chỉ cần hiển thị tài khoản và đăng xuất.

- **Phương án A (đề xuất):** không giữ token. Sau khi lấy hồ sơ thì bỏ token khỏi bộ nhớ (Google: revoke luôn). Chỉ lưu `Account`, không có secret, vào `app_data_dir()/account.json` (quyền 0600). Không cần `keyring`, không cần refresh, không có prompt keychain khi chạy bản dev chưa ký. Đánh đổi: "đã kết nối" nghĩa là đã xác minh danh tính lúc đăng nhập; app không biết khi người dùng thu hồi quyền từ phía Google/GitHub.
- **Phương án B:** nếu sau này cần gọi API thay người dùng thì giữ token trong keychain OS (`keyring`, service `ai.geteasy.rynox-ide`, user `<provider>`). File chỉ chứa `Account`. Refresh: Google access token sống 1 h, refresh token luôn được trả cho app cài đặt `[đã kiểm]`. Token GitHub từ device flow không hết hạn, trừ khi bật expiring tokens (8 h / refresh 6 tháng; refresh device-flow token không cần secret `[đã kiểm]`). Lỗi `invalid_grant`/`bad_refresh_token` thì xoá và yêu cầu đăng nhập lại.
- Áp dụng cho cả hai phương án: token/code/verifier/secret **không bao giờ** được log, đưa vào chuỗi lỗi, gửi về front end hay xuất qua `Debug` (bọc newtype có `Debug` ẩn giá trị). `auth_logout` xoá file (và mục keychain nếu dùng phương án B), sau đó (B, Google) revoke.

## 5. Front end

Bám UI hiện có: `Button`, `Dialog`, `DropdownMenu` trong `src/components/ui/`, `useCopyToClipboard`, layout footer hiện tại. Không đổi theme.

- `src/hooks/use-account.ts`: gọi `auth_status` và `auth_providers` khi mount; quản lý `status: 'idle' | 'connecting' | 'connected' | 'error'` cùng các hàm `login(provider)`, `cancel()`, `logout()`. State cục bộ trong sidebar, không thêm global state.
- Footer (giữ khung `border-t px-3 py-2.5`):
    - _Chưa kết nối:_ avatar Rynox, dòng phụ "Chưa đăng nhập", toàn khối là nút "Kết nối tài khoản" mở dialog.
    - _Đang kết nối:_ dòng phụ "Đang chờ đăng nhập…", chấm trạng thái nhấp nháy.
    - _Đã kết nối:_ avatar tài khoản (lỗi ảnh thì dùng chữ cái đầu), tên, dòng phụ là email hoặc `@login`, chấm xanh. Nút `EllipsisVertical` (hiện đang `disabled`) mở `DropdownMenu` có mục "Đăng xuất".
    - _Lỗi:_ hiện thông báo lỗi ngắn dưới dạng `role="alert"` trong dialog; footer quay về trạng thái chưa kết nối.
- Dialog "Kết nối tài khoản": mô tả "Đăng nhập để hiển thị tài khoản của bạn trong Rynox. Không kết nối trợ lý AI." Hai nút "Đăng nhập với Google" / "Đăng nhập với GitHub", tắt kèm `title` "Chưa cấu hình Client ID." khi thiếu.
    - Google đang chờ: "Hoàn tất đăng nhập trong trình duyệt…" và nút "Huỷ".
    - GitHub: "Nhập mã sau tại github.com/login/device:", mã lớn, nút "Sao chép mã", "Mở lại trang", "Huỷ".
    - Đóng dialog khi đang chờ thì gọi `auth_cancel`.
- Thông báo lỗi (từ Rust): "Đã huỷ đăng nhập.", "Hết thời gian đăng nhập. Vui lòng thử lại.", "Đăng nhập bị từ chối.", "Không kết nối được tới máy chủ đăng nhập.", "Phản hồi đăng nhập không hợp lệ.", "Chưa cấu hình Client ID cho nhà cung cấp này."

## 6. Cấu hình

- Biến môi trường do Rust đọc lúc chạy (`std::env`), fallback sang giá trị nhúng lúc build (`option_env!`) để bản đóng gói vẫn có Client ID:
    - `RYNOX_GOOGLE_CLIENT_ID`, `RYNOX_GOOGLE_CLIENT_SECRET` (tuỳ chọn, xem mục 2), `RYNOX_GITHUB_CLIENT_ID`.
    - Cùng tiền tố với `RYNOX_WORKSPACE` hiện có. **Không** dùng tiền tố `VITE_` vì Vite sẽ nhúng giá trị đó vào bundle JS.
- `.env.local` ở gốc repo (git-ignore). Chạy dev: `set -a; source .env.local; set +a; pnpm start`. Không thêm crate dotenv. Có thể commit `.env.example` với giá trị rỗng.
- Thêm vào `.gitignore`: `.env`, `.env.*`, `!.env.example`.
- **Google Cloud Console:**
    1. Tạo hoặc chọn project.
    2. Google Auth Platform > Branding: tên app, email hỗ trợ.
    3. Audience: External, thêm test user khi app ở chế độ Testing.
    4. Data Access: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
    5. Clients > Create client > **Desktop app**. Không cần redirect URI.
    6. Chép Client ID (và secret nếu cần) vào `.env.local`.
- **GitHub:**
    1. Settings > Developer settings > OAuth Apps > New OAuth App.
    2. Homepage URL tuỳ ý. Authorization callback URL bắt buộc nhưng device flow không dùng; đặt `http://127.0.0.1/callback`.
    3. Bật **Enable Device Flow**.
    4. Chép Client ID. **Không** tạo hoặc dùng client secret.

## 7. Rủi ro và an toàn

- CSRF / tráo code: `state` ngẫu nhiên kèm PKCE S256. Listener chỉ bind `127.0.0.1` và chỉ sống trong luồng đăng nhập. App local khác có thể gửi request tới cổng: request sai `state` bị bỏ qua, và không có `code_verifier` thì code bị đánh cắp cũng vô dụng.
- Client ID/secret Desktop của Google bị lộ khi phân phối: chấp nhận được theo Google (public client). Không ship secret của GitHub.
- Phishing device code: chỉ hiển thị `verification_uri` do GitHub trả về; app tự mở trang.
- Log/lỗi: không in URL có `code`, không log body token. Kiểm tra bằng test đơn vị trên các nhánh lỗi.
- macOS keychain (chỉ phương án B): bản dev chưa ký có thể bị hỏi quyền mỗi lần build lại.
- Google app ở chế độ "Testing" chỉ cho test user đăng nhập. Phát hành rộng cần publish (scope cơ bản thường không cần verification `[chưa kiểm]`).
- Kiểm thử đề xuất (chưa chạy): unit test tạo PKCE (vector RFC 7636), parse callback (sai state, thiếu code, có `error`), poll device-flow với `slow_down`/`expired_token` qua server giả, test `Debug` không lộ token. Kiểm tra thủ công cả hai provider, cả huỷ và hết giờ.

## 8. Câu hỏi mở

1. Lưu trữ: phương án A (chỉ lưu hồ sơ, không giữ token) hay B (giữ token trong keychain cho tính năng sau)? Đề xuất A.
2. Có chấp nhận UX device flow (nhập mã) cho GitHub không? Phương án thay thế duy nhất là ship client secret GitHub trong app, không khuyến nghị.
3. Chỉ một tài khoản tại một thời điểm (đăng nhập provider khác sẽ thay thế)? Đề xuất: có.
4. Dòng tên thứ nhất ở footer: tên tài khoản thay "Rynox", hay giữ "Rynox" và đưa tài khoản xuống dòng phụ?
5. Bản đóng gói: nhúng Client ID lúc build bằng `option_env!` có được không, hay chỉ đọc lúc chạy?

## 9. Task triển khai (gợi ý cho planner)

1. Cấu hình: `.gitignore` (thêm env), `.env.example`, đọc client ID trong `src-tauri/src/auth.rs`.
2. Rust core: `src-tauri/src/auth.rs` gồm PKCE/state, listener loopback, Google exchange/userinfo/revoke, GitHub device flow, bộ lưu `account.json`, state machine/cancel/timeout, unit test.
3. Nối Tauri: `src-tauri/Cargo.toml` (thêm `tauri-plugin-opener`, `reqwest`, `tokio`, `getrandom`, `base64`), `src-tauri/src/lib.rs` (plugin, `manage`, handler), `src-tauri/src/commands.rs` (6 command).
4. Front end: `src/lib/auth.ts`, `src/hooks/use-account.ts`, `src/components/shell/account-dialog.tsx`, sửa footer trong `src/components/shell/sidebar.tsx`.
5. Kiểm tra: `cargo test`, `pnpm typecheck`, `pnpm lint`; thử thủ công với Client ID thật.
