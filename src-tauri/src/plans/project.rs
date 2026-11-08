//! Writes a plan of the AI into the project as a file (`<plans dir>/<slug>-<yyyyMMdd>.md`, or `.json` for a plan that only has a task list).
//!
//! Only runs when the person asked for it: the setting `savePlansToProject`, or the explicit command. The file goes through the workspace sandbox (same path rules as every other write), and a file that already exists is never overwritten: the name gets a suffix (`-2`, `-3`...).

use crate::activity::NewPlanRecord;
use crate::plans::types::{StoredPlan, Todo, TodoStatus};
use crate::run_log::civil_from_days;
use crate::validation;
use crate::workspace::{self, Workspace, WorkspaceError};
use std::fmt;

/// Where plans go when the setting is empty.
pub const DEFAULT_PLANS_DIR: &str = "docs/plans";
const MAX_SLUG_CHARS: usize = 60;
const MAX_TITLE_CHARS: usize = 100;
/// How many suffixes are tried before giving up.
const MAX_ATTEMPTS: u32 = 100;
const SECONDS_PER_DAY: i64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanSaveError {
    /// The session has no plan to save.
    Empty,
    /// The plans folder is not a plain relative path inside the project.
    BadDirectory,
    Workspace(WorkspaceError),
}

impl PlanSaveError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Empty => "plan_save.empty",
            Self::BadDirectory => "plan_save.bad_directory",
            Self::Workspace(error) => error.message(),
        }
    }
}

impl fmt::Display for PlanSaveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for PlanSaveError {}

/// The file that was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedPlan {
    /// Path relative to the project root.
    pub path: String,
    pub format: &'static str,
    pub title: String,
    pub status: &'static str,
    pub tasks_total: i64,
    pub tasks_done: i64,
}

impl SavedPlan {
    pub fn record(&self) -> NewPlanRecord {
        NewPlanRecord {
            path: self.path.clone(),
            title: self.title.clone(),
            status: self.status.to_string(),
            tasks_total: self.tasks_total,
            tasks_done: self.tasks_done,
            format: self.format.to_string(),
        }
    }
}

/// `dir` when it is a plain relative folder inside the project (no `..`, not absolute, not a denied folder such as `.git`), else none; a trailing slash is dropped and an empty value means [`DEFAULT_PLANS_DIR`].
pub fn checked_plans_dir(dir: &str) -> Option<String> {
    let dir = dir.trim();

    if dir.is_empty() {
        return Some(DEFAULT_PLANS_DIR.to_string());
    }

    validation::relative_path(dir).ok()?;

    let dir = dir.trim_end_matches(['/', '\\']);
    let clean = workspace::normalise(dir)?;

    (clean == dir && !workspace::denied(&format!("{clean}/x"))).then_some(clean)
}

/// Writes `stored` as a new file of the plans folder `plans_dir` (created when missing) and returns what was written.
///
/// # Errors
/// `plan_save.empty` when there is nothing to save, `plan_save.bad_directory` for an unusable folder, or the workspace error of the write.
pub fn save(
    workspace: &Workspace,
    plans_dir: &str,
    stored: &StoredPlan,
    seconds: i64,
) -> Result<SavedPlan, PlanSaveError> {
    let dir = checked_plans_dir(plans_dir).ok_or(PlanSaveError::BadDirectory)?;
    let markdown = stored
        .markdown
        .as_deref()
        .filter(|text| !text.trim().is_empty());

    if markdown.is_none() && stored.todos.is_empty() {
        return Err(PlanSaveError::Empty);
    }

    let stamp = day_stamp(seconds);
    let (title, format, content) = match markdown {
        Some(text) => (title_of(text), "md", markdown_file(text, &stored.todos)),
        None => {
            let title = format!("Plan {stamp}");
            let content = json_file(&title, &stored.todos, seconds);

            (title, "json", content)
        }
    };
    let total = i64::try_from(stored.todos.len()).unwrap_or(0);
    let done = i64::try_from(
        stored
            .todos
            .iter()
            .filter(|todo| todo.status == TodoStatus::Completed)
            .count(),
    )
    .unwrap_or(0);

    make_folder(workspace, &dir)?;

    let slug = slug_of(&title);

    for attempt in 1..=MAX_ATTEMPTS {
        let suffix = if attempt == 1 {
            String::new()
        } else {
            format!("-{attempt}")
        };
        // * Each saved plan gets its own folder, ready for the evidence and tests that come with it.
        let plan_dir = format!("{dir}/{slug}-{stamp}{suffix}");
        let path = format!("{plan_dir}/plan.{format}");

        make_folder(workspace, &plan_dir)?;

        // * `expected: None` means "the file must not exist": an existing one is a conflict, never overwritten.
        match workspace.write(&path, &content, None) {
            Ok(_) => {
                return Ok(SavedPlan {
                    path,
                    format,
                    title,
                    status: status_of(total, done, markdown.is_some()),
                    tasks_total: total,
                    tasks_done: done,
                });
            }
            Err(WorkspaceError::Conflict) => {}
            Err(error) => return Err(PlanSaveError::Workspace(error)),
        }
    }

    Err(PlanSaveError::Workspace(WorkspaceError::WriteFailed))
}

/// Creates the folders of `dir` one by one through the sandbox; one that exists is fine.
fn make_folder(workspace: &Workspace, dir: &str) -> Result<(), PlanSaveError> {
    let mut parent = String::new();

    for segment in dir.split('/') {
        match workspace.create_for_viewer(&parent, segment, true) {
            Ok(_) | Err(WorkspaceError::Conflict) => {}
            Err(error) => return Err(PlanSaveError::Workspace(error)),
        }

        if !parent.is_empty() {
            parent.push('/');
        }

        parent.push_str(segment);
    }

    Ok(())
}

fn status_of(total: i64, done: i64, has_text: bool) -> &'static str {
    match (total, done) {
        (0, _) if has_text => "draft",
        (0, _) => "unknown",
        (total, done) if total == done => "done",
        (_, 0) => "todo",
        _ => "in_progress",
    }
}

/// The text of the plan, followed by its task list as a Markdown checklist when it has one.
fn markdown_file(text: &str, todos: &[Todo]) -> String {
    let mut content = text.trim_end().to_string();

    if !todos.is_empty() {
        content.push_str("\n\n## Tasks\n\n");

        for todo in todos {
            let mark = if todo.status == TodoStatus::Completed {
                "x"
            } else {
                " "
            };

            content.push_str(&format!("- [{mark}] {}\n", todo.content.replace('\n', " ")));
        }
    } else {
        content.push('\n');
    }

    content
}

fn json_file(title: &str, todos: &[Todo], seconds: i64) -> String {
    let tasks: Vec<serde_json::Value> = todos
        .iter()
        .map(|todo| {
            serde_json::json!({
                "title": todo.content,
                "status": match todo.status {
                    TodoStatus::Completed => "done",
                    TodoStatus::InProgress => "in_progress",
                    TodoStatus::Pending => "todo",
                },
            })
        })
        .collect();
    let (year, month, day) = civil_from_days(seconds.div_euclid(SECONDS_PER_DAY));
    let document = serde_json::json!({
        "title": title,
        "createdAt": format!("{year:04}-{month:02}-{day:02}"),
        "tasks": tasks,
    });

    format!(
        "{}\n",
        serde_json::to_string_pretty(&document).unwrap_or_default()
    )
}

/// The first `# ` heading of a Markdown text, else its first non-empty line; `Plan` when there is none.
fn title_of(markdown: &str) -> String {
    let heading = markdown
        .lines()
        .find_map(|line| line.trim().strip_prefix("# "));
    let first = markdown
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty());
    let raw = heading.or(first).unwrap_or("Plan").trim_start_matches('#');
    let title: String = raw.trim().chars().take(MAX_TITLE_CHARS).collect();

    if title.is_empty() {
        "Plan".to_string()
    } else {
        title
    }
}

/// `yyyyMMdd` of a Unix time (UTC).
pub fn day_stamp(seconds: i64) -> String {
    let (year, month, day) = civil_from_days(seconds.div_euclid(SECONDS_PER_DAY));

    format!("{year:04}{month:02}{day:02}")
}

/// A file-name form of a title: lower-case ASCII letters and digits joined by `-`, Vietnamese letters without their marks; `plan` when nothing is left.
pub fn slug_of(title: &str) -> String {
    let mut slug = String::new();

    for character in title.chars().flat_map(char::to_lowercase) {
        let letter = fold(character);

        if letter.is_ascii_alphanumeric() {
            slug.push(letter);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }

    let slug: String = slug.chars().take(MAX_SLUG_CHARS).collect();
    let slug = slug.trim_matches('-');

    if slug.is_empty() {
        "plan".to_string()
    } else {
        slug.to_string()
    }
}

/// The plain letter of a lower-case Vietnamese letter; other characters are kept.
fn fold(character: char) -> char {
    const GROUPS: [(char, &str); 7] = [
        ('a', "àáạảãâầấậẩẫăằắặẳẵ"),
        ('e', "èéẹẻẽêềếệểễ"),
        ('i', "ìíịỉĩ"),
        ('o', "òóọỏõôồốộổỗơờớợởỡ"),
        ('u', "ùúụủũưừứựửữ"),
        ('y', "ỳýỵỷỹ"),
        ('d', "đ"),
    ];

    GROUPS
        .iter()
        .find(|(_, marked)| marked.contains(character))
        .map_or(character, |(plain, _)| *plain)
}

#[cfg(test)]
#[path = "../../tests/unit/plans/project.rs"]
mod tests;
