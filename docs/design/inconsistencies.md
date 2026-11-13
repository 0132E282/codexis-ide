# Chỗ chưa nhất quán (chỉ liệt kê, chưa sửa)

Đối chiếu code hiện tại với quy tắc ở [DESIGN.md](./DESIGN.md). Không có mục nào đã được sửa trong lượt này.

## A. Input thô / không qua Field

Quy tắc: mọi input trong layout dùng `Field`. Còn lại (grep `<input|<Input|<textarea` trong `src/`, bỏ `ui/input.tsx`):

| Vị trí                                                                                                                                 | Ghi chú                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/components/ai-chat/quick-open.tsx:119`                                                                                            | `Input` thô (ô tìm file)                                                    |
| `src/components/code-viewer/tree-panel.tsx:165`                                                                                | `Input` thô (đổi tên/tạo trong cây)                                         |
| `src/components/shell/composer.tsx:178`                                                                                                | `<textarea>` thô của composer chat (có lý do: tự co giãn, paste/IME, gợi ý) |
| `src/components/shell/settings-tabs/tool-table.tsx:164`                                                                                | `Input` thô                                                                 |
| Toolbar tiptap: `src/lib/editor/highlight.tsx:55`, `text-color.tsx:49`, `image.tsx:124` (`<input>`), `video-embed.tsx:141` (`Input`)   | thô                                                                         |
| `src/components/ui/image-bubble-menu.tsx:118,160`, `link-edit-form.tsx:101`, `table-size-picker.tsx:50,60`, `rich-text-editor.tsx:153` | thô trong rich-text UI                                                      |
| `src/components/ui/input-select.tsx:230`                                                                                               | `Input` tìm kiếm trong popover (nội bộ primitive, chấp nhận được)           |
| `src/components/form/field/repeater-field.tsx:325`, `auto-sync-field.tsx:60`, `attachment-field.tsx:243`                               | nội bộ field (chấp nhận được)                                               |

## B. Field không nhận `className` cho chính ô input

`Field` (`src/components/form/field/index.tsx`) lấy `className` và chỉ áp vào vùng bọc `BaseField`, không truyền xuống `InputField`/`TextareaField`. Không chỉnh được chiều cao, nền, cỡ chữ của ô input qua Field. Hệ quả: các chỗ cần ô nhỏ (`h-8`, `h-7`) phải bỏ Field dùng `Input` thô (xem A). `ChoiceCard` truyền `className="min-w-0 flex-1"` cho bố cục, chạy được vì áp vào wrapper.

Thêm: `TextareaField` (`field/textarea-field.tsx`) tự gắn class riêng (`rounded-md`, nền trong suốt, focus `ring-1`), khác `Input` (`rounded-sm`, `bg-card`, ring 3px), nên input và textarea cạnh nhau lệch kiểu.

## C. Không có DataTable

`src/components/tables/index.tsx` chưa tồn tại; bảng đang tự viết (`tool-table.tsx`, `repeater-field.tsx`).

## D. Toast có thể không hiển thị

`sonner` có trong `package.json` và `toast.*` được gọi ở 6 file, nhưng grep `Toaster` trong `src/` không ra kết quả (không có `ui/sonner.tsx`, không có trong `main.tsx`/`app.tsx`). Cần xác nhận bằng Playwright/chạy app; nếu đúng thì toast không hiện.

## E. Font không được nạp

`--font-sans` khai báo Instrument Sans nhưng không có `@font-face`/`@fontsource`/`<link>`; app dùng font hệ thống.

## F. Chữ cứng chưa qua t()

`src/components/ui/dialog.tsx` có `<span className="sr-only">Close</span>`. (Mới kiểm file này; chưa quét toàn bộ `src/` tìm chữ cứng khác.) Các comment i18n ở `src/lib/i18n/en/index.ts` lỗi thời ("by its Vietnamese text").

## G. Lỗi backend

`src/lib/ai-error.ts` vẫn hiện `response.data.message` (kiểu axios/Laravel, có comment "Laravel's Too Many Attempts") thay vì map key lỗi từ backend Rust sang `t()`. Cần xác nhận hợp đồng lỗi thực tế của `src-tauri` trước khi sửa.

## H. Token chưa dùng / radius phẳng

`--sidebar-*` khai báo nhưng không component nào dùng. `--radius-xs..4xl` đều bằng 4px nên `rounded-md/lg/xl` không phân biệt thứ bậc, chỉ có tác dụng ghi ý đồ.

## I. Màu cứng ngoài token

`src/css/app.css`: gutter `#2ea043/#388bfd/#f85149`, `.pm-dots` `rgb(59 91 219)`, `pm-ai-glow` vàng; chưa có biến dark/light riêng cho chúng.

## J. Chưa kiểm

Chưa chụp ảnh màn hình (không có `docs/design/images/`), chưa chạy app/Playwright, chưa có `design:lint` trong `package.json`.
