# Thiết kế: bảng Context (mức dùng ngữ cảnh của cuộc chat)

Trạng thái: **C02 và C03 đã có mã (`context.rs`; `Event::Context` phát từ `agent/claude.rs`, `agent/codex.rs`; Codex `[chưa kiểm]`), chưa nối frontend**. Nguồn yêu cầu: ảnh chụp bảng "Environment / Context" của ứng dụng Claude do người dùng gửi ngày 2026-11-06. Căn cứ mã: `src-tauri/src/agent.rs` (`parse_line`, `Event`), `commands/agent.rs`, `src/components/shell/chat/use-agent-turns.ts`, `chat-panel.tsx`. Tổng quan hệ thống: [architecture.md](./architecture.md). Ký hiệu: `[đã kiểm]` đọc được trong mã; `[chưa kiểm]` suy từ giao thức CLI, phải chạy thật để xác nhận; `[giả định]` đề xuất.

## 1. Phạm vi

Bảng nhỏ mở từ khung chat, cho người dùng thấy cuộc trò chuyện đang dùng bao nhiêu ngữ cảnh của model:

- Thanh phần trăm đã dùng và `đã dùng / cửa sổ` (ví dụ `203.9k / 400k`).
- Số token của lượt gần nhất: đầu vào, đọc từ cache, tạo cache, đầu ra.
- Tên model và CLI (`claude` hoặc `codex`) đang áp dụng.

**Ngoài phạm vi (đợt này)**:

- Tách theo loại (Messages, MCP tools, System tools, System prompt, Skills, Memory files, Custom agents, Autocompact buffer, Free space như ảnh). CLI ở chế độ `-p` không đưa số liệu này trong luồng `stream-json` đang đọc; chỉ có tổng `usage` `[chưa kiểm]`. Làm sau nếu có nguồn (câu hỏi Q1).
- Auto-compact (chọn ngưỡng, nút Compact session): là tính năng của Claude Code tương tác, ứng dụng này không điều khiển được `[chưa kiểm]` (Q2).
- Phần Environment, Remote Control, Connectors của ảnh: đã có chỗ khác hoặc không thuộc tính năng này.

| ID  | Yêu cầu                                                       | Tiêu chí chấp nhận                                                                                            |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| C1  | Thấy mức dùng ngữ cảnh sau mỗi lượt                           | Sau lượt xong, bảng hiện `đã dùng / cửa sổ` và phần trăm khớp số `usage` CLI trả                              |
| C2  | Biết cửa sổ ngữ cảnh của model                                | Với Claude lấy từ kết quả CLI; với Codex dùng bảng model trong Rust; model lạ thì ẩn phần trăm, vẫn hiện số   |
| C3  | Số liệu tính ở backend Rust                                   | Frontend không tính phần trăm, không có hằng cửa sổ; chỉ vẽ giá trị backend gửi (quy ước tính năng ở backend) |
| C4  | Không đổi contract Tauri hiện có                              | Không thêm lệnh Tauri mới; chỉ thêm một biến thể `Event` đi qua `agent-event` sẵn có                          |
| C5  | Không làm hỏng lượt chat khi CLI không trả `usage`            | Thiếu `usage` thì không phát sự kiện, bảng hiện "chưa có số liệu"                                             |
| C6  | Đa ngữ vi/en, dùng component có sẵn (Radix, thanh tiến độ ui) | Mọi chữ qua i18n; không thêm thư viện                                                                         |

## 2. Dữ liệu từ CLI

Trước C03 mã bỏ qua `usage`. Nay `agent/claude.rs` và `agent/codex.rs` (trait `AgentCli`) đọc và phát `Event::Context` `[đã kiểm]`.

- **Claude** (`--output-format stream-json`) `[đã kiểm: claude 2.1.319, 2026-11-07]`: dòng `result` có `usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}` và `modelUsage.<model>.contextWindow` (ví dụ 1000000). **Cẩn thận**: `result.usage` và `modelUsage` là TỔNG qua mọi lần gọi model của lượt (lượt 3 lần gọi: cache_read 60244, trong khi lần cuối chỉ 26588), nên KHÔNG dùng để tính "đã dùng". Dùng `result.usage.iterations[-1]` (bằng `usage` của message `assistant` cuối). `contextWindow` chỉ có khi lượt kết thúc, nên bảng chỉ cập nhật cuối lượt.
- **Codex** (`exec --json`) `[chưa kiểm]`: giả định dòng `{"type":"turn.completed","usage":{input_tokens, cached_input_tokens, output_tokens}}`, không có cửa sổ và không có tên model trong dòng (nên `window`/`percent` null cho tới khi biết model từ nguồn khác). Chưa chụp được vì tài khoản bị chặn.

### 2.1. Kết quả chạy thật (TASK-C01, 2026-11-06): chưa xác nhận

- **Claude** (`claude -p "say hi" --output-format stream-json --verbose`): lượt bị chặn bởi giới hạn 5 giờ của tài khoản (`is_error:true`, `api_error_status:429`, `terminal_reason:"api_error"`), nên `usage` toàn số 0 và `modelUsage` rỗng `{}`. Đã thấy thật trên dòng `result`: các khoá `usage.input_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`, `usage.output_tokens` (đúng tên đã giả định), thêm `modelUsage` và `model_usage_since_last_result`. **Chưa thấy** `modelUsage.<model>.contextWindow` có số; công thức `used` chưa kiểm bằng số thật.
- **Codex** (`codex exec --json`): model mặc định của cấu hình máy không dùng được với tài khoản ChatGPT (`turn.failed`); thử thêm 4 tên model khác cũng bị từ chối, nên dừng. Chưa có `turn.completed`, chưa thấy `usage`.
- Hệ quả: các `[chưa kiểm]` ở mục 2 giữ nguyên. Cần chạy lại khi hết giới hạn Claude (sau 12:00 sáng) và khi Codex có model được hỗ trợ. Mã phải chịu được `result` lỗi có `usage` toàn 0 (không phát `Event::Context` khi mọi số bằng 0, hợp với C5).
- Mẫu đã lưu (che nội dung): `/private/tmp/claude-501/-Users-hoangphuc01975-Documents-developers-codexis-ide/98e946d9-f5db-40b5-acbf-6de721cfb46a/scratchpad/ph1-context/fixture-claude-result-ratelimited.json`, `.../fixture-codex-turn-failed.json`.

**Mức đã dùng** = `input_tokens + cache_read + cache_creation` của lần gọi model CUỐI trong lượt (`usage.iterations[-1]`; đầu ra tính vào lượt kế) `[đã kiểm với Claude]`. Công thức nằm một chỗ ở Rust (`context.rs`), có test.

## 3. Thiết kế

### 3.1. Use case

```mermaid
flowchart LR
    U(["Người dùng"])
    U --> UC1["Xem mức dùng ngữ cảnh"]
    U --> UC2["Xem số token của lượt gần nhất"]
    U --> UC3["Đổi model và thấy cửa sổ mới"]
    UC1 & UC2 --> SYS["Khung chat"]
    UC3 --> SYS
```

### 3.2. Luồng dữ liệu (DFD cấp 1)

```mermaid
flowchart LR
    CLI["CLI claude / codex"] -- "dòng JSON stdout" --> P1["1. parse_line<br/>(agent.rs)"]
    P1 -- "usage + model" --> P2["2. ContextUsage::from_usage<br/>(context.rs): tính used, window, percent"]
    P2 -- "Event::Context" --> P3["3. emit agent-event<br/>(commands/agent.rs)"]
    P3 --> UI["4. use-agent-turns<br/>giữ Context của cuộc chat"]
    UI --> P4["5. ContextPanel<br/>vẽ thanh và số"]
    TBL[("Bảng cửa sổ theo model<br/>(Rust, hằng)")] --> P2
```

### 3.3. Trình tự một lượt

```mermaid
sequenceDiagram
    participant C as ChatPanel
    participant R as agent_send (Rust)
    participant P as CLI
    participant X as context.rs

    C->>R: agent_send(...)
    R->>P: chạy lượt
    P-->>R: ... dòng kết quả có usage
    R->>X: ContextUsage::from_usage(cli, model, usage, reported_window)
    X-->>R: Some(ContextUsage) hoặc None
    R-->>C: agent-event {kind:"context", text: JSON}
    P-->>R: kết thúc
    R-->>C: agent-event Done
    C->>C: lưu Context của cuộc chat, vẽ bảng
```

### 3.4. Trạng thái của bảng

```mermaid
stateDiagram-v2
    [*] --> Empty: mở cuộc chat chưa có lượt
    Empty --> Known: nhận Event::Context
    Known --> Known: lượt mới có usage
    Known --> Empty: chuyển sang cuộc chat khác chưa có số liệu
    Known --> Unknown: đổi model chưa có số liệu mới
    Unknown --> Known: lượt kế có usage
```

### 3.5. Thành phần (Component) và lớp

```mermaid
flowchart TD
    subgraph Rust
        AG["agent.rs<br/>parse_line → Event::Context"]
        CX["context.rs (mới)<br/>ContextUsage, window_of(cli, model, reported_window)"]
        CA["commands/agent.rs<br/>emit agent-event"]
    end
    subgraph React
        UT["use-agent-turns.ts<br/>nhận kind=context"]
        TY["turn-events.ts<br/>kiểu ContextUsage"]
        PN["context-panel.tsx (mới)<br/>Radix Popover + thanh tiến độ"]
        I18["lib/i18n vi · en"]
    end
    AG --> CX
    AG --> CA
    CA -- "agent-event" --> UT --> TY --> PN
    PN --> I18
```

```mermaid
classDiagram
    class ContextUsage {
        +u64 used
        +Option~u64~ window
        +Option~f64~ percent
        +u64 input
        +u64 cache_read
        +u64 cache_creation
        +u64 output
        +String model
        +from_usage(CliKind cli, model, usage_json, Option~u64~ reported_window) Option~ContextUsage~
        +window_of(CliKind cli, model, Option~u64~ reported_window) Option~u64~ (hàm tự do)
    }
    class Event {
        <<enum>>
        Context(String)
    }
    ContextUsage ..> Event : serialize camelCase
```

### 3.6. Dữ liệu và lưu trữ (ERD)

Đợt này **không đổi DB**: `ContextUsage` chỉ nằm trong bộ nhớ của frontend theo cuộc chat; mở lại cuộc chat cũ thì bảng hiện "chưa có số liệu" tới lượt kế. Không thêm bảng hay cột nên không có sơ đồ ERD mới. Lưu theo cuộc chat (cột trên `chat_turns` hoặc `conversation_sessions`) là Q3; nếu chọn thì phải thêm bằng `add_column_if_missing` trong `db.rs` kèm test di trú, tránh lặp lỗi cột `steps`.

### 3.7. Hợp đồng sự kiện

`Event::Context(String)` mang JSON (camelCase): `{"used":203900,"window":400000,"percent":51.0,"input":..,"cacheRead":..,"cacheCreation":..,"output":..,"model":".."}`; `window` và `percent` là `null` khi không biết cửa sổ. Serde của `Event` đã là `tag = "kind"`, `content = "text"`, lowercase nên frontend nhận `kind: "context"`. `remote.rs` chuyển tiếp mọi `agent-event` cho điện thoại; điện thoại bỏ qua kind lạ `[chưa kiểm]` (Q4).

## 4. Phi chức năng và an toàn

- **An toàn**: chỉ số, không chứa nội dung chat; không thêm quyền, không thêm lệnh.
- **Hiệu năng**: một lần parse JSON đã có sẵn cho mỗi dòng; thêm O(1) khi gặp dòng `result` hoặc `turn.completed`.
- **Lỗi**: dùng key cố định như phần còn lại; ở đây không phát lỗi, thiếu số liệu thì im lặng (C5).
- **Quan hệ với refactor OOP** ([plan](../plans/oop-refactor-backend-20261106.json)): `agent.rs` thuộc nhóm A; tính năng này nên làm sau TASK-003 hoặc đưa vào `ClaudeAgent`/`CodexAgent` để không xung đột file.

## 5. Câu hỏi mở

1. Có nguồn nào cho số theo loại (MCP tools, system prompt...)? Mặc định: không làm đợt này.
2. Có cần nút Compact/auto-compact? Mặc định: không (không điều khiển được từ `-p`).
3. Lưu `ContextUsage` theo cuộc chat vào DB? Mặc định: không.
4. Điện thoại có cần xem bảng? Mặc định: không.
5. (Đã thử 2026-11-06, CHƯA xác nhận được, xem mục 2.1) Cần chụp một dòng `result` (Claude) và `turn.completed` (Codex) thật để chốt tên trường và công thức `used`. Mặc định: chạy một lượt thật trước khi code.
