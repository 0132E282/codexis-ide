//! Kế hoạch AI đang viết: tách `ExitPlanMode` (và `TodoWrite`) từ đầu vào công cụ.
//!
//! `[đã kiểm: claude 2.1.319]` Chỉ `ExitPlanMode` (đầu vào `{plan, planFilePath}`) có
//! thật, và chỉ khi CLI chạy với `--input-format stream-json`; CLI mặc định không
//! phát `TodoWrite` nên nhánh todo hiện không được dùng (hoãn, giữ cho CLI sau này).
//! Tên công cụ hoặc trường sai thì `from_tool` trả `None`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_TODOS: usize = 100;
const MAX_TODO_CHARS: usize = 500;
const MAX_MARKDOWN_CHARS: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
}

impl TodoStatus {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "pending" => Some(Self::Pending),
            "in_progress" => Some(Self::InProgress),
            "completed" => Some(Self::Completed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Todo {
    pub content: String,
    pub status: TodoStatus,
}

/// Nội dung của `Event::Plan`: JSON camelCase, trường `kind` phân biệt dạng.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Plan {
    Todos { todos: Vec<Todo> },
    Text { markdown: String },
}

impl Plan {
    /// Tách plan từ một lần gọi công cụ; `None` nếu không phải công cụ plan
    /// hoặc đầu vào thiếu trường/sai kiểu.
    pub fn from_tool(name: &str, input: &Value) -> Option<Self> {
        match name {
            "TodoWrite" => Self::todos_from(input),
            "ExitPlanMode" => Self::text_from(input),
            _ => None,
        }
    }

    /// Chuỗi JSON đưa vào `Event::Plan`.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    fn todos_from(input: &Value) -> Option<Self> {
        let items = input.get("todos")?.as_array()?;
        let todos = items
            .iter()
            .filter_map(Self::todo_from)
            .take(MAX_TODOS)
            .collect();
        Some(Self::Todos { todos })
    }

    fn todo_from(item: &Value) -> Option<Todo> {
        let content = item.get("content")?.as_str()?;
        let status = TodoStatus::parse(item.get("status")?.as_str()?)?;
        Some(Todo {
            content: truncate(content, MAX_TODO_CHARS),
            status,
        })
    }

    fn text_from(input: &Value) -> Option<Self> {
        let markdown = input.get("plan")?.as_str()?;
        Some(Self::Text {
            markdown: truncate(markdown, MAX_MARKDOWN_CHARS),
        })
    }
}

/// Plan của một phiên như được lưu và trả cho `plan_load`: danh sách việc mới nhất
/// và văn bản plan mới nhất, thiếu phần nào thì để trống.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPlan {
    #[serde(default)]
    pub todos: Vec<Todo>,
    #[serde(default)]
    pub markdown: Option<String>,
}

impl StoredPlan {
    /// Bản mới của từng dạng thay bản cũ cùng dạng, dạng kia giữ nguyên.
    pub fn apply(&mut self, plan: Plan) {
        match plan {
            Plan::Todos { todos } => self.todos = todos,
            Plan::Text { markdown } => self.markdown = Some(markdown),
        }
    }

    /// Đọc từ JSON đã lưu; hỏng thì `None`.
    pub fn from_json(json: &str) -> Option<Self> {
        serde_json::from_str(json).ok()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

fn truncate(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

#[cfg(test)]
#[path = "../tests/unit/plan.rs"]
mod tests;
