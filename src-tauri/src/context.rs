//! Mức dùng ngữ cảnh của một lượt chat: công thức `used`, bảng cửa sổ model
//! và hình dạng JSON gửi cho frontend (xem `docs/system/context-panel.md`).

use crate::cli::CliKind;
use serde::Serialize;
use serde_json::Value;

/// Cửa sổ ngữ cảnh của các model Codex đã biết (tiền tố tên model).
/// Model không khớp thì không có cửa sổ và không có phần trăm.
const CODEX_WINDOWS: &[(&str, u64)] = &[("gpt-5", 400_000)];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub used: u64,
    pub window: Option<u64>,
    pub percent: Option<f64>,
    pub input: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
    pub output: u64,
    pub model: String,
}

/// Cửa sổ ngữ cảnh của model; `None` nếu không biết.
/// Claude: chỉ tin số CLI báo (`reported_window`); Codex: tra bảng.
pub fn window_of(cli: CliKind, model: &str, reported_window: Option<u64>) -> Option<u64> {
    if let Some(window) = reported_window.filter(|window| *window > 0) {
        return Some(window);
    }
    match cli {
        CliKind::Codex => CODEX_WINDOWS
            .iter()
            .find(|(prefix, _)| model.starts_with(prefix))
            .map(|(_, window)| *window),
        CliKind::Claude | CliKind::Github => None,
    }
}

impl ContextUsage {
    /// Dựng từ object `usage` của CLI. Trả `None` khi không có `usage` hợp lệ
    /// hoặc mọi số bằng 0 (ví dụ `result` lỗi), để không phát sự kiện.
    ///
    /// Claude: `used = input + cache_read + cache_creation` `[giả định]`.
    /// Codex: `input_tokens` đã gồm phần cache nên `used = input` `[chưa kiểm]`.
    pub fn from_usage(
        cli: CliKind,
        model: &str,
        usage: &Value,
        reported_window: Option<u64>,
    ) -> Option<Self> {
        let object = usage.as_object()?;
        let field = |name: &str| object.get(name).and_then(Value::as_u64).unwrap_or(0);
        let input = field("input_tokens");
        let output = field("output_tokens");
        let (cache_read, cache_creation, used) = match cli {
            CliKind::Codex => (field("cached_input_tokens"), 0, input),
            CliKind::Claude => {
                let read = field("cache_read_input_tokens");
                let creation = field("cache_creation_input_tokens");
                (
                    read,
                    creation,
                    input.saturating_add(read).saturating_add(creation),
                )
            }
            CliKind::Github => return None,
        };
        if used == 0 && output == 0 {
            return None;
        }
        let window = window_of(cli, model, reported_window);
        let percent = window.map(|window| (used as f64 / window as f64 * 100.0).min(100.0));
        Some(Self {
            used,
            window,
            percent,
            input,
            cache_read,
            cache_creation,
            output,
            model: model.to_string(),
        })
    }
}

#[cfg(test)]
#[path = "../tests/unit/context.rs"]
mod tests;
