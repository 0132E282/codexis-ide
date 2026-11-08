//! Lưu plan của từng phiên CLI thành `plans/<session>.json` trong thư mục dự án
//! của app (xem [`crate::project_data`]), để mở lại cuộc chat cũ vẫn thấy plan.

use crate::plans::types::{Plan, StoredPlan};
use crate::project_data::ProjectData;
use std::io;
use std::path::{Path, PathBuf};

const MAX_SESSION_CHARS: usize = 128;

pub struct PlanStore {
    dir: PathBuf,
}

impl PlanStore {
    /// `dir` là kết quả của [`ProjectData::dir`].
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// Gộp `plan` vào plan đã lưu của `session` rồi ghi nguyên tử.
    ///
    /// # Errors
    /// Mã phiên không hợp lệ hoặc không ghi được; nơi gọi bỏ qua lỗi này.
    pub fn record(&self, session: &str, plan: Plan) -> io::Result<()> {
        let file = plan_file(session)?;
        let mut stored = ProjectData::read(&self.dir, &file)
            .and_then(|json| StoredPlan::from_json(&json))
            .unwrap_or_default();

        stored.apply(plan);
        ProjectData::write_atomic(&self.dir, &file, stored.to_json().as_bytes())
    }

    /// JSON của plan đã lưu cho `session`; `None` nếu chưa có, hỏng hoặc mã lạ.
    pub fn load(&self, session: &str) -> Option<String> {
        let file = plan_file(session).ok()?;
        let stored = StoredPlan::from_json(&ProjectData::read(&self.dir, &file)?)?;

        Some(stored.to_json())
    }
}

/// `plans/<session>.json`; mã phiên chỉ gồm chữ, số, `-`, `_` nên không thoát được thư mục.
fn plan_file(session: &str) -> io::Result<PathBuf> {
    let valid = !session.is_empty()
        && session.chars().count() <= MAX_SESSION_CHARS
        && session
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');

    if !valid {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "mã phiên không hợp lệ",
        ));
    }

    Ok(Path::new("plans").join(format!("{session}.json")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plans::types::{Todo, TodoStatus};
    use tempfile::tempdir;

    fn store(data: &Path) -> PlanStore {
        PlanStore::new(ProjectData::dir(data, "app", "p1").unwrap())
    }

    #[test]
    fn a_recorded_plan_loads_back_and_merges_kinds() {
        let data = tempdir().unwrap();
        let store = store(data.path());

        store
            .record(
                "sess-1",
                Plan::Text {
                    markdown: "# Kế hoạch".into(),
                },
            )
            .unwrap();
        store
            .record(
                "sess-1",
                Plan::Todos {
                    todos: vec![Todo {
                        content: "a".into(),
                        status: TodoStatus::Completed,
                    }],
                },
            )
            .unwrap();

        let loaded = StoredPlan::from_json(&store.load("sess-1").unwrap()).unwrap();
        assert_eq!(loaded.markdown.as_deref(), Some("# Kế hoạch"));
        assert_eq!(loaded.todos.len(), 1);
    }

    #[test]
    fn unknown_or_unsafe_sessions_give_none_or_error() {
        let data = tempdir().unwrap();
        let store = store(data.path());

        assert_eq!(store.load("nope"), None);
        for bad in ["", "../x", "a/b", "a.b"] {
            assert_eq!(store.load(bad), None);
            assert!(store
                .record(
                    bad,
                    Plan::Text {
                        markdown: "m".into()
                    }
                )
                .is_err());
        }
    }

    #[test]
    fn a_corrupt_file_is_replaced_by_the_next_record() {
        let data = tempdir().unwrap();
        let store = store(data.path());
        ProjectData::write_atomic(&store.dir, Path::new("plans/s.json"), b"{broken").unwrap();

        assert_eq!(store.load("s"), None);
        store
            .record(
                "s",
                Plan::Text {
                    markdown: "ok".into(),
                },
            )
            .unwrap();
        assert!(store.load("s").unwrap().contains("ok"));
    }
}
