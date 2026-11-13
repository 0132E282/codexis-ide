//! Bảng việc chạy nền của AI (lệnh shell nền và sub-agent): vòng đời, giới hạn
//! kích thước và dạng JSON gửi frontend. Thiết kế: `docs/system/background-tasks.md`.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

/// Số việc tối đa trong bảng.
pub const MAX_TASKS: usize = 50;
/// Số ký tự tối đa của nhãn.
pub const MAX_LABEL_CHARS: usize = 200;
/// Số ký tự tối đa của `id` và `handle` do CLI báo; dài hơn thì bỏ việc.
pub const MAX_ID_CHARS: usize = 128;
/// Số ký tự tối đa của đầu ra gần nhất.
pub const MAX_OUTPUT_TAIL_CHARS: usize = 2_000;

pub const ERROR_NOT_FOUND: &str = "background.not_found";
pub const ERROR_STOP_FAILED: &str = "background.stop_failed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskKind {
    Shell,
    Subagent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Running,
    Done,
    Failed,
    Stopped,
}

impl TaskState {
    fn is_running(self) -> bool {
        self == TaskState::Running
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub kind: TaskKind,
    pub label: String,
    pub state: TaskState,
    pub started_at: i64,
    pub output_tail: String,
    /// `task_id` do CLI cấp (ví dụ `bg6iuh7hi`), không phải pid; không gửi frontend.
    #[serde(skip)]
    pub handle: Option<String>,
}

/// Điều CLI báo về việc shell chạy nền, đã tách khỏi dạng dòng của từng CLI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackgroundChange {
    /// Việc mới chạy: `id` là `tool_use_id` của lệnh, `handle` là `task_id` của CLI.
    Started {
        id: String,
        handle: String,
        label: String,
    },
    /// Việc có `handle` đã kết thúc.
    Finished { handle: String, state: TaskState },
    /// Các `handle` CLI còn giữ; việc shell Running không còn trong đó coi là đã xong.
    Running { handles: Vec<String> },
}

/// Bảng việc nền; mọi thao tác qua `&self` nhờ khoá nội bộ.
#[derive(Debug, Default)]
pub struct BackgroundTasks {
    tasks: Mutex<Vec<Task>>,
}

/// Giây Unix (frontend hiển thị `startedAt` theo giây).
fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

/// Cắt giữ `max` ký tự đầu.
fn truncate_head(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// Cắt giữ `max` ký tự cuối (đầu ra gần nhất).
fn truncate_tail(text: &str, max: usize) -> String {
    let count = text.chars().count();
    text.chars().skip(count.saturating_sub(max)).collect()
}

impl BackgroundTasks {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, Vec<Task>> {
        // Khoá bị nhiễm do panic ở luồng khác: dữ liệu vẫn nhất quán theo từng thao tác.
        self.tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Thêm việc Running. Trùng `id` thì bỏ qua (trả `false`). Vượt giới hạn thì
    /// bỏ việc đã kết thúc cũ nhất; mọi việc đều đang chạy thì bỏ việc mới (`false`).
    pub fn start(&self, id: &str, kind: TaskKind, label: &str) -> bool {
        if id.chars().count() > MAX_ID_CHARS {
            return false;
        }
        let mut tasks = self.lock();
        if tasks.iter().any(|task| task.id == id) {
            return false;
        }
        if tasks.len() >= MAX_TASKS {
            match tasks.iter().position(|task| !task.state.is_running()) {
                Some(index) => {
                    tasks.remove(index);
                }
                None => return false,
            }
        }
        tasks.push(Task {
            id: id.to_string(),
            kind,
            label: truncate_head(label, MAX_LABEL_CHARS),
            state: TaskState::Running,
            started_at: now_seconds(),
            output_tail: String::new(),
            handle: None,
        });
        true
    }

    /// Gắn định danh CLI (shell id) vào việc. `false` nếu không có việc.
    pub fn attach(&self, id: &str, handle: &str) -> bool {
        if handle.chars().count() > MAX_ID_CHARS {
            return false;
        }
        self.update(id, |task| task.handle = Some(handle.to_string()))
    }

    /// Tìm id nội bộ theo định danh CLI.
    pub fn find_by_handle(&self, handle: &str) -> Option<String> {
        self.lock()
            .iter()
            .find(|task| task.handle.as_deref() == Some(handle))
            .map(|task| task.id.clone())
    }

    /// Ghi đầu ra gần nhất (cắt giữ phần cuối).
    pub fn set_output(&self, id: &str, output: &str) -> bool {
        self.update(id, |task| {
            task.output_tail = truncate_tail(output, MAX_OUTPUT_TAIL_CHARS)
        })
    }

    /// Bỏ một việc khỏi bảng (dùng khi sub-agent xong: chỉ kết quả cuối còn ở chat). `false` nếu không có.
    pub fn remove(&self, id: &str) -> bool {
        let mut tasks = self.lock();
        let before = tasks.len();

        tasks.retain(|task| task.id != id);

        tasks.len() != before
    }

    /// Kết thúc việc đang chạy với `state` khác Running. Việc đã kết thúc
    /// không đổi lại (trả `false`).
    pub fn finish(&self, id: &str, state: TaskState) -> bool {
        if state.is_running() {
            return false;
        }
        let mut tasks = self.lock();
        match tasks.iter_mut().find(|task| task.id == id) {
            Some(task) if task.state.is_running() => {
                task.state = state;
                true
            }
            _ => false,
        }
    }

    /// Đánh dấu Stopped. Việc tiến trình thật do bên gọi dừng.
    /// Lỗi: `background.not_found`, `background.stop_failed` (không còn chạy).
    pub fn stop(&self, id: &str) -> Result<(), &'static str> {
        let mut tasks = self.lock();
        let task = tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or(ERROR_NOT_FOUND)?;
        if !task.state.is_running() {
            return Err(ERROR_STOP_FAILED);
        }
        task.state = TaskState::Stopped;
        Ok(())
    }

    /// Sub-agent chạy trong tiến trình CLI nên không sống sau lượt: việc sub-agent còn Running thành Stopped. Trả `true` nếu bảng đổi.
    pub fn stop_running_subagents(&self) -> bool {
        let mut changed = false;
        for task in self.lock().iter_mut() {
            if task.kind == TaskKind::Subagent && task.state.is_running() {
                task.state = TaskState::Stopped;
                changed = true;
            }
        }
        changed
    }

    /// Xoá việc đã kết thúc, giữ việc đang chạy. Trả số việc đã xoá.
    pub fn clear_finished(&self) -> usize {
        let mut tasks = self.lock();
        let before = tasks.len();
        tasks.retain(|task| task.state.is_running());
        before - tasks.len()
    }

    /// Áp một điều CLI báo vào bảng; `true` nếu bảng đổi.
    pub fn apply(&self, change: &BackgroundChange) -> bool {
        match change {
            BackgroundChange::Started { id, handle, label } => {
                if handle.chars().count() > MAX_ID_CHARS {
                    return false;
                }
                let added = self.start(id, TaskKind::Shell, label);
                if added {
                    self.attach(id, handle);
                }
                added
            }
            BackgroundChange::Finished { handle, state } => self
                .find_by_handle(handle)
                .is_some_and(|id| self.finish(&id, *state)),
            BackgroundChange::Running { handles } => {
                // * A set makes the check O(tasks + handles) instead of O(tasks * handles).
                let live: std::collections::HashSet<&str> =
                    handles.iter().map(String::as_str).collect();
                let gone: Vec<String> = self
                    .lock()
                    .iter()
                    .filter(|task| {
                        task.state.is_running()
                            && task
                                .handle
                                .as_ref()
                                .is_some_and(|handle| !live.contains(handle.as_str()))
                    })
                    .map(|task| task.id.clone())
                    .collect();
                let mut changed = false;
                for id in gone {
                    changed |= self.finish(&id, TaskState::Done);
                }
                changed
            }
        }
    }

    /// Kiểm việc tồn tại và đang chạy mà không đổi trạng thái; trả `task_id` của CLI (shell) để gửi yêu cầu dừng. Trạng thái chỉ đổi khi CLI báo về.
    /// Lỗi: `background.not_found`, `background.stop_failed` (không còn chạy).
    pub fn stop_target(&self, id: &str) -> Result<Option<String>, &'static str> {
        let tasks = self.lock();
        let task = tasks
            .iter()
            .find(|task| task.id == id)
            .ok_or(ERROR_NOT_FOUND)?;
        if !task.state.is_running() {
            return Err(ERROR_STOP_FAILED);
        }
        Ok(task.handle.clone())
    }

    /// Đánh dấu mọi việc đang chạy là Stopped (app thoát hoặc đóng dự án); `true` nếu bảng đổi.
    pub fn stop_all_running(&self) -> bool {
        let mut changed = false;
        for task in self.lock().iter_mut() {
            if task.state.is_running() {
                task.state = TaskState::Stopped;
                changed = true;
            }
        }
        changed
    }

    /// Thay bảng bằng việc đã lưu; việc đang chạy lúc lưu không còn tiến trình nên thành Stopped.
    pub fn restore(&self, saved: Vec<Task>) {
        let mut tasks = self.lock();
        *tasks = saved
            .into_iter()
            .filter(|task| {
                task.id.chars().count() <= MAX_ID_CHARS
                    && task
                        .handle
                        .as_ref()
                        .is_none_or(|handle| handle.chars().count() <= MAX_ID_CHARS)
            })
            .take(MAX_TASKS)
            .map(|mut task| {
                if task.state.is_running() {
                    task.state = TaskState::Stopped;
                }
                task.label = truncate_head(&task.label, MAX_LABEL_CHARS);
                task.output_tail = truncate_tail(&task.output_tail, MAX_OUTPUT_TAIL_CHARS);
                task
            })
            .collect();
    }

    pub fn snapshot(&self) -> Vec<Task> {
        self.lock().clone()
    }

    /// JSON hợp đồng `{"tasks":[...]}` (camelCase) cho `Event::Background`.
    pub fn snapshot_json(&self) -> String {
        serde_json::json!({ "tasks": self.snapshot() }).to_string()
    }

    fn update(&self, id: &str, apply: impl FnOnce(&mut Task)) -> bool {
        let mut tasks = self.lock();
        match tasks.iter_mut().find(|task| task.id == id) {
            Some(task) => {
                apply(task);
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
#[path = "../tests/unit/background.rs"]
mod tests;
