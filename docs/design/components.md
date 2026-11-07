# Component có sẵn

Liệt kê từ code; tokens và quy tắc chung ở [DESIGN.md](./DESIGN.md).

## 1. Primitive — `src/components/ui/` (shadcn-style trên Radix, dùng `cn` + `cva`, `data-slot`)

| File                                                                                                                                        | Export / ghi chú                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button.tsx`                                                                                                                                | `Button`, `buttonVariants`. variant: `default destructive outline secondary ghost link`; size: `default(h-9) xs(h-6) sm(h-8) lg(h-10) icon icon-xs icon-sm icon-lg`; `asChild` (Radix Slot). Có focus ring 3px, `aria-invalid`, `disabled:opacity-50`, `motion-reduce:transition-none` |
| `input.tsx`                                                                                                                                 | `Input` (h-9, viền `border-input`, nền `bg-card`). **Chỉ dùng bên trong Field/InputField hoặc component ui khác, không dùng thô trong layout**                                                                                                                                         |
| `label.tsx`                                                                                                                                 | `Label` (Radix)                                                                                                                                                                                                                                                                        |
| `field.tsx`                                                                                                                                 | Bộ khung bố cục: `Field` (orientation `vertical                                                                                                                                                                                                                                        | horizontal                                                  | responsive`), `FieldGroup`, `FieldSet`, `FieldLegend`, `FieldLabel`, `FieldContent`, `FieldTitle`, `FieldDescription`, `FieldSeparator`, `FieldError` (`role="alert"`) |
| `input-select.tsx`                                                                                                                          | `InputSelect` (popover + tìm kiếm + multiple), kiểu `InputSelectOption`                                                                                                                                                                                                                |
| `input-otp.tsx`, `checkbox.tsx`, `switch.tsx`, `toggle.tsx`                                                                                 | Radix wrappers                                                                                                                                                                                                                                                                         |
| `tabs.tsx`                                                                                                                                  | `Tabs`, `TabsList` (variant `default                                                                                                                                                                                                                                                   | line`), `TabsTrigger`, `TabsContent`; hỗ trợ dọc (settings) |
| `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`                                                                                               | Overlay; xem DESIGN.md 4.3                                                                                                                                                                                                                                                             |
| `popover.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`                                                                                      | Menu/popup nổi (`z-50`)                                                                                                                                                                                                                                                                |
| `badge.tsx`                                                                                                                                 | `Badge`, `badgeVariants` (default, secondary, ...)                                                                                                                                                                                                                                     |
| `separator.tsx`                                                                                                                             | `Separator`                                                                                                                                                                                                                                                                            |
| `rich-text-editor.tsx` + `image-bubble-menu.tsx`, `link-bubble-menu.tsx`, `link-edit-form.tsx`, `link-popover.tsx`, `table-size-picker.tsx` | Trình soạn rich text (tiptap); extension ở `src/lib/editor/`                                                                                                                                                                                                                           |

## 2. Form — `src/components/form/`

- `index.tsx`: FormLayout (đọc `default`, `validate` từ children; shorthand `'required:msg' | 'min:3:msg' | 'max:255:msg' | 'email:msg'`), `collection-context.tsx`. Hook: `src/hooks/use-app-form.ts` (react-hook-form + zod).
- `field/index.tsx`: **`Field`** — cổng duy nhất để đặt ô nhập. Props chính: `name` (bắt buộc, cũng là `id`), `ui`, `label`, `description`, `errorMsg`, `showError`, `className`, `options`, `maxLength`, `validate`, `default`, + mọi thuộc tính input HTML. Tự đọc `useFormContext()` (lỗi, register); dùng được ngoài form (truyền `value/onChange` như `choice-card.tsx`).
- `ui` hỗ trợ: `input` (mặc định), `checkbox`, `switch`, `textarea`, `select`, `otp`, `attachment`, `editor`, `repeater`, `auto-sync`, `choice-cards`, `checkbox-group`, tương ứng `input-field`, `switch-field`, `textarea-field`, `select-field`, `otp-field`, `attachment-field`, `editor-field`, `repeater-field`, `auto-sync-field`, `choice-cards-field`, `checkbox-group-field`.
- Bố cục: switch/checkbox là hàng gọn (control trái, nhãn phải, `w-fit`); còn lại nhãn trên, control, rồi mô tả hoặc lỗi (`text-[0.8rem]`, lỗi `text-destructive font-medium`, có `animate-in fade-in`).
- Cách dùng đúng:

```tsx
<Field name="title" label={t('x.title')} placeholder={t('x.title_hint')} />
<Field name="enabled" ui="switch" label={t('x.enabled')} />
```

Giới hạn hiện tại của Field: xem [inconsistencies.md](./inconsistencies.md) (không truyền `className` vào chính ô input).

## 3. Bảng — `src/components/tables/`

Chỉ có `row-actions-menu.tsx` (`RowActionsMenu`, mục `RowActionItem {label,onSelect,destructive?,disabled?,icon?,separatorBefore?}`, menu ba chấm cuối hàng). **Chưa có `DataTable`** (`src/components/tables/index.tsx` không tồn tại). Bảng hiện có dạng riêng: `src/components/shell/settings-tabs/tool-table.tsx`, bảng trong `repeater-field.tsx`.

## 4. Shell — `src/components/shell/`

`sidebar.tsx`, `sidebar-toggle.tsx`, `chat/project-row.tsx`, `workspace-pane.tsx`, `chat-panel.tsx`, `composer.tsx` (+ `chat/composer-tools.tsx`, `model-menu.tsx`, `suggestion-list.tsx`, `attachment-list.tsx`, `attachment-view.tsx`), `chat/message-list.tsx`, `chat/turn-view.tsx`, `turn-steps.tsx`, `changed-files-card.tsx`, `chat/subagent-view.tsx`, `settings-dialog.tsx` + `settings-tabs/*` (`agent`, `character`, `connect`, `hook`, `mcp`, `rules`, `skill`, `advanced`, `api-key-section`, `tool-table`, `code-preview`), `usage-dialog.tsx`, `connect-phone-dialog.tsx`, `new-project-dialog.tsx`, `dialogs-host.tsx`, `accounts.tsx`, `manage-accounts-page.tsx`.

## 5. AI chat — `src/components/ai-chat/`

`choice-card.tsx`, `markdown-content.tsx`, `code-block.tsx`, `work-steps.tsx`, `file-card.tsx`, `file-icon.tsx`, `vendor-badge.tsx`, `assistant-avatar.tsx`, `loading-rows.tsx`, `unified-diff.tsx`, `diff-view.tsx`, `monaco-code.tsx`, `monaco-diff.tsx`, `monaco-setup.ts`, `inline-ask.tsx`, `quick-open.tsx`, `local-changes.tsx`, `commit-box.tsx`, `branch-popover.tsx`, `file-context-menu.tsx`, `resize-handle.tsx`, `activity-terminal.tsx` (xterm), thư mục `code-viewer/` (tree, tabs, editor, rename dialog, hooks).

## 6. Hook UI dùng chung — `src/hooks/`

`use-confirm.tsx` (xác nhận), `use-resizable-width.ts` (kéo đổi cỡ + lưu localStorage), `use-pane-state.ts`, `use-copy-to-clipboard.ts`, `use-typewriter.ts`, `use-file-drop-guard.ts`, `use-window-buttons-hover.ts`, `use-cached-request.ts`.

## 7. Class `pm-*` trong `src/css/app.css`

`.pm-gutter-added/modified/deleted` (dấu thay đổi ở lề editor), `.pm-revert-pop`, `.pm-dots` (khung loading ảnh), `.pm-asked-range` (dòng đã hỏi AI, `primary` 28%), `.pm-inline-ask` (ô bình luận trong Monaco, tắt outline mặc định của Monaco), `.pm-ai-glow` (dòng AI vừa ghi, vàng mờ dần).
