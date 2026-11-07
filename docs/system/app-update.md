# Thiết kế: tự cập nhật từ GitHub Releases

Trạng thái: **đã triển khai, chưa kiểm với bản phát hành thật** (cần release có ký). Mã: `src-tauri/src/app_update.rs`, `commands/app_update.rs`, `src/lib/ide-update.ts`, `src/components/shell/update-banner.tsx`.

## Luồng

1. Khi mở app (`app_update::start`, chỉ bản release, bản dev bỏ qua) rồi mỗi 4 giờ (`CHECK_INTERVAL`), backend hỏi `tauri-plugin-updater`. Hai lần kiểm không gần hơn 60 giây (`MIN_CHECK_GAP`).
2. Có bản mới hơn: lưu bản chờ cài và phát sự kiện `update-available` (một lần cho mỗi phiên bản). Payload camelCase: `version`, `currentVersion`, `notes`.
3. Frontend: `UpdateBanner` (góc dưới phải) gọi `update_pending` lúc mở (phòng sự kiện đến trước khi UI nghe) và nghe `update-available`. Có nút "Cập nhật" và "Để sau".
4. Bấm "Cập nhật": `update_install` tải, kiểm chữ ký, cài, rồi `app.restart()`. Tiến độ qua `update-progress` (`downloaded`, `total`, `percent`; `percent` là null khi chưa biết kích thước).
5. Lỗi mạng khi kiểm: chỉ ghi log (stderr), không báo người dùng. Lỗi khi cài: khoá `update.install_failed` (dịch ở `errors.update.*`), hiện trong banner.

Trình duyệt/vite (không có Tauri): banner không chạy gì.

## Endpoint và cấu hình

- Endpoint: `https://github.com/0132E282/codexis-ide/releases/latest/download/latest.json` (`plugins.updater.endpoints` trong `tauri.conf.json`).
- `plugins.updater.pubkey`: khoá công khai. `bundle.createUpdaterArtifacts: true`. Quyền `updater:default` ở `capabilities/default.json`.
- Khởi động lại dùng `AppHandle::restart` của Tauri, nên không cần `tauri-plugin-process`.

## Ký

Khoá riêng nằm ngoài repo (`~/.tauri/codexis-ide-updater.key`, không mật khẩu), không commit. Khi build release phải có biến môi trường `TAURI_SIGNING_PRIVATE_KEY` (nội dung khoá) và `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (rỗng nếu không đặt). Mất khoá riêng thì máy đã cài không nhận được bản mới nữa (phải đổi `pubkey` và cài tay một lần).

## Một release phải có

Release **không phải draft/pre-release** (vì `/releases/latest`) chứa: `latest.json` (phiên bản, ghi chú, URL và chữ ký từng nền tảng), gói cập nhật đã ký (macOS: `*.app.tar.gz` + `.sig`) và URL trong `latest.json` trỏ đúng tài sản của release. `tauri-apps/tauri-action` với `includeUpdaterJson: true` tạo đủ. Phiên bản trong `tauri.conf.json` phải cao hơn bản đang chạy. Hiện `bundle.targets` chỉ có `app` (macOS).

## Giới hạn

- Chưa thử một lần cập nhật thật (cần release có ký).
- Chỉ kiểm khi app đang mở; bản dev không kiểm.
- Không có kênh beta, không hạ cấp, không hỏi lại sau khi bấm "Để sau" cho tới khi có bản mới hơn hoặc mở lại app.
