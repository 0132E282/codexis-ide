//! The plan documents of a project: the `docs/plans/` folder read as a list of cards (title, status, progress). It only reads, except `set_status`, which rewrites the status word of one plan on the person's request.
//!
//! Not to be mixed with `plan.rs` / `plan_store.rs`, which hold the plan an AI wrote inside a chat session.
//! JSON is preferred over Markdown: when `x.json` and `x.md` both exist only the JSON is listed (and marked `has_markdown`).
//! Every file is reached through the workspace sandbox: links leaving the project and secret names are refused.

use crate::permission::{Guarded, PathPolicy, Sandbox};
use crate::workspace::Workspace;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// Folder of the plans, relative to the project root.
const PLANS_FOLDER: &str = "docs/plans";

/// The list file: a source of title, description and tags when a plan lacks them, never a card of its own.
const INDEX_FILE: &str = "index.json";
/// The plan file inside a plan folder `docs/plans/<name>/`; the folder also holds the plan's evidence and tests.
const PLAN_FILES: [&str; 2] = ["plan.json", "plan.md"];

/// At most this many files are read; the rest are left out and `truncated` says so.
pub const MAX_FILES: usize = 200;

/// Largest plan file (bytes) that is read; a bigger one is skipped.
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

const MAX_DESCRIPTION_CHARS: usize = 400;

/// Where a plan stands, one vocabulary for the JSON `status` words and the Markdown ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Done,
    InProgress,
    Partial,
    Todo,
    Draft,
    /// Built, waiting to be checked (`CHO_KIEM_TRA`).
    Review,
    Unknown,
}

impl PlanStatus {
    /// Maps a status word as written in a plan (`DONE`, `in-progress`, `DRAFT_CHO_DUYET`...).
    pub fn from_word(word: &str) -> Self {
        let word = word.trim().to_uppercase().replace(['-', ' '], "_");

        match word.as_str() {
            "DONE" | "COMPLETED" | "COMPLETE" | "DA_XONG" | "HOAN_THANH" => Self::Done,
            "IN_PROGRESS" | "DOING" | "DANG_LAM" => Self::InProgress,
            "PARTIAL" => Self::Partial,
            "CHO_KIEM_TRA" | "REVIEW" | "IN_REVIEW" => Self::Review,
            "TODO" | "PENDING" | "OPEN" => Self::Todo,
            _ if word.starts_with("DRAFT") || word.contains("CHO_DUYET") => Self::Draft,
            // * "Implemented, UI not checked yet": built, but not signed off.
            _ if word.starts_with("DA_TRIEN_KHAI") => Self::Partial,
            _ => Self::Unknown,
        }
    }

    /// The status a plan without a written one has, from its tasks.
    fn from_progress(total: usize, done: usize, started: bool) -> Self {
        match (total, done) {
            (0, _) => Self::Unknown,
            (total, done) if done == total => Self::Done,
            (_, 0) if !started => Self::Todo,
            _ => Self::InProgress,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanFormat {
    Json,
    Md,
}

/// One card of the list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDoc {
    /// Path relative to the project root (the key of the card).
    pub id: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub status: PlanStatus,
    /// The status word as written in the file, when there is one.
    pub raw_status: Option<String>,
    pub created_at: Option<String>,
    pub format: PlanFormat,
    /// A `.md` twin sits beside this JSON plan.
    pub has_markdown: bool,
    pub tasks_total: usize,
    pub tasks_done: usize,
    /// Path relative to the project root, to open the file in the editor.
    pub path: String,
    /// Last change, seconds since the Unix epoch (0 when unknown).
    pub modified_at: u64,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDocsList {
    /// The project folder that was read, so an empty list can say where it looked.
    pub root: String,
    pub plans: Vec<PlanDoc>,
    /// Files that could not be read or understood (too big, broken, outside the project).
    pub skipped: usize,
    /// More than `MAX_FILES` candidates were found.
    pub truncated: bool,
}

/// What the file alone says; the rest (path, times) comes from the folder.
struct Parsed {
    title: Option<String>,
    description: Option<String>,
    tags: Vec<String>,
    raw_status: Option<String>,
    created_at: Option<String>,
    tasks_total: usize,
    tasks_done: usize,
    tasks_started: bool,
}

/// Title, description and tags of the `index.json` entries, by file name: the fallback for plans without their own.
struct IndexEntry {
    title: Option<String>,
    description: Option<String>,
    tags: Vec<String>,
}

/// Lists the plans of `docs/plans/` of the project; an absent folder is an empty list, not an error.
pub fn list(workspace: &Workspace) -> PlanDocsList {
    PlanDocsList {
        root: workspace.root().display().to_string(),
        ..read_folder(workspace)
    }
}

fn read_folder(workspace: &Workspace) -> PlanDocsList {
    let Some((sandbox, folder)) = plans_folder(workspace) else {
        return PlanDocsList::default();
    };
    let Ok(entries) = fs::read_dir(&folder) else {
        return PlanDocsList::default();
    };

    let mut names: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };

        if entry.metadata().is_ok_and(|metadata| metadata.is_dir()) {
            // * A plan folder `<name>/` holds `plan.json` or `plan.md` next to its evidence and tests.
            names.extend(
                PLAN_FILES
                    .iter()
                    .map(|file| format!("{name}/{file}"))
                    .filter(|path| folder.join(path).is_file()),
            );
        } else if name != INDEX_FILE && format_of(&name).is_some() {
            names.push(name);
        }
    }

    names.sort();

    let truncated = names.len() > MAX_FILES;

    names.truncate(MAX_FILES);

    let index = read_index(&sandbox, &folder);
    let name_set: HashSet<&str> = names.iter().map(String::as_str).collect();
    let json_stems: HashSet<String> = names
        .iter()
        .filter(|name| format_of(name) == Some(PlanFormat::Json))
        .map(|name| key_of(name))
        .collect();
    let mut skipped = 0;
    let mut plans = Vec::new();

    for name in &names {
        let Some(format) = format_of(name) else {
            continue;
        };
        let key = key_of(name);

        // * JSON wins: its Markdown twin is only a flag on the card.
        if format == PlanFormat::Md && json_stems.contains(&key) {
            continue;
        }

        let has_markdown =
            format == PlanFormat::Json && name_set.contains(format!("{key}.md").as_str());

        match read_plan(&sandbox, &folder, name, format, has_markdown, &index) {
            Some(plan) => plans.push(plan),
            None => skipped += 1,
        }
    }

    // * Newest first: by creation date, then by last change.
    plans.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then(b.modified_at.cmp(&a.modified_at))
            .then(a.id.cmp(&b.id))
    });

    PlanDocsList {
        root: String::new(),
        plans,
        skipped,
        truncated,
    }
}

/// The sandbox of the project and the real path of its `docs/plans/` folder; none when the folder is absent or is a link leaving the project.
fn plans_folder(workspace: &Workspace) -> Option<(Sandbox, PathBuf)> {
    let sandbox = Sandbox::open(workspace.root())?;
    let folder = sandbox.resolve(&workspace.root().join(PLANS_FOLDER))?;

    Some((sandbox, folder))
}

fn format_of(name: &str) -> Option<PlanFormat> {
    match Path::new(name)
        .extension()?
        .to_str()?
        .to_lowercase()
        .as_str()
    {
        "json" => Some(PlanFormat::Json),
        "md" => Some(PlanFormat::Md),
        _ => None,
    }
}

/// The title a plan gets when it has none: its file stem, or the name of its folder for `<folder>/plan.json`.
fn stem_of(name: &str) -> String {
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();

    match path.parent().and_then(Path::file_name) {
        Some(folder) if PLAN_FILES.contains(&format!("{stem}.{}", extension_of(name)).as_str()) => {
            folder.to_string_lossy().into_owned()
        }
        _ => stem,
    }
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// The name without its extension: what a JSON plan and its Markdown twin share.
fn key_of(name: &str) -> String {
    Path::new(name)
        .with_extension("")
        .to_string_lossy()
        .into_owned()
}

/// Whether `name` (relative to `docs/plans/`) is a plan file: `<name>.json`/`.md` in the folder itself, or `<folder>/plan.json`/`plan.md`.
fn is_plan_name(name: &str) -> bool {
    if name == INDEX_FILE || format_of(name).is_none() {
        return false;
    }

    match name.split_once('/') {
        None => true,
        Some((folder, file)) => !folder.is_empty() && PLAN_FILES.contains(&file),
    }
}

/// Text of one file of the folder, or none when it is refused (secret name, link out of the project), too big, not text or unreadable. Also gives the last change time.
fn read_text(sandbox: &Sandbox, folder: &Path, name: &str) -> Option<(String, u64)> {
    let relative = format!("{PLANS_FOLDER}/{name}");

    if Guarded.refuses(&relative) {
        return None;
    }

    // * `resolve` follows links and refuses any that leave the project.
    let full = sandbox.resolve(&folder.join(name))?;
    let metadata = fs::metadata(&full).ok()?;

    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return None;
    }

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_secs());
    let text = String::from_utf8(fs::read(&full).ok()?).ok()?;

    Some((text, modified_at))
}

fn read_index(sandbox: &Sandbox, folder: &Path) -> HashMap<String, IndexEntry> {
    let Some((text, _)) = read_text(sandbox, folder, INDEX_FILE) else {
        return HashMap::new();
    };
    let Ok(Value::Array(entries)) = serde_json::from_str::<Value>(&text) else {
        return HashMap::new();
    };

    entries
        .iter()
        .filter_map(|entry| {
            let path = entry.get("path")?.as_str()?;
            let file = path
                .strip_prefix(&format!("{PLANS_FOLDER}/"))
                .unwrap_or(path)
                .to_string();

            Some((
                file,
                IndexEntry {
                    title: text_field(entry, "title"),
                    description: text_field(entry, "description"),
                    tags: string_list(entry.get("tags")),
                },
            ))
        })
        .collect()
}

fn read_plan(
    sandbox: &Sandbox,
    folder: &Path,
    name: &str,
    format: PlanFormat,
    has_markdown: bool,
    index: &HashMap<String, IndexEntry>,
) -> Option<PlanDoc> {
    let (text, modified_at) = read_text(sandbox, folder, name)?;
    let parsed = match format {
        PlanFormat::Json => parse_json(&text)?,
        PlanFormat::Md => parse_markdown(&text),
    };
    let fallback = index.get(name);
    let relative = format!("{PLANS_FOLDER}/{name}");
    let status = match &parsed.raw_status {
        Some(word) => PlanStatus::from_word(word),
        None => {
            PlanStatus::from_progress(parsed.tasks_total, parsed.tasks_done, parsed.tasks_started)
        }
    };
    let tags = if parsed.tags.is_empty() {
        fallback.map(|entry| entry.tags.clone()).unwrap_or_default()
    } else {
        parsed.tags
    };

    Some(PlanDoc {
        id: relative.clone(),
        title: parsed
            .title
            .or_else(|| fallback.and_then(|entry| entry.title.clone()))
            .unwrap_or_else(|| stem_of(name)),
        description: parsed
            .description
            .or_else(|| fallback.and_then(|entry| entry.description.clone()))
            .unwrap_or_default(),
        tags,
        status,
        raw_status: parsed.raw_status,
        created_at: parsed.created_at,
        format,
        has_markdown,
        tasks_total: parsed.tasks_total,
        tasks_done: parsed.tasks_done,
        path: relative,
        modified_at,
    })
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    let text = value.get(key)?.as_str()?.trim();

    (!text.is_empty()).then(|| text.to_string())
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Reads a JSON plan: fields at the top, or inside a `content` object (some plans are wrapped that way, with the status under `content.meta`).
fn parse_json(text: &str) -> Option<Parsed> {
    let root: Value = serde_json::from_str(text).ok()?;

    if !root.is_object() {
        return None;
    }

    let content = root.get("content").filter(|content| content.is_object());
    let bodies: Vec<&Value> = std::iter::once(&root).chain(content).collect();
    let meta = content.and_then(|content| content.get("meta"));
    let first = |key: &str| {
        bodies
            .iter()
            .chain(meta.iter())
            .find_map(|body| text_field(body, key))
    };
    let mut tags = Vec::new();

    for body in &bodies {
        if tags.is_empty() {
            tags = string_list(body.get("tags"));
        }
    }

    let mut statuses = Vec::new();

    for body in &bodies {
        collect_task_statuses(body, &mut statuses);
    }

    let is_done = |status: &String| PlanStatus::from_word(status) == PlanStatus::Done;

    Some(Parsed {
        title: first("title"),
        description: first("description"),
        tags,
        raw_status: first("status"),
        created_at: first("createdAt").or_else(|| first("created_at")),
        tasks_total: statuses.len(),
        tasks_done: statuses.iter().filter(|status| is_done(status)).count(),
        tasks_started: statuses
            .iter()
            .any(|status| PlanStatus::from_word(status) == PlanStatus::InProgress),
    })
}

/// The `status` of every task of a plan body: its `tasks`, and the `tasks` of each of its `groups`.
fn collect_task_statuses(body: &Value, statuses: &mut Vec<String>) {
    let mut lists: Vec<&Value> = vec![];

    if let Some(tasks) = body.get("tasks") {
        lists.push(tasks);
    }

    if let Some(groups) = body.get("groups").and_then(Value::as_array) {
        lists.extend(groups.iter().filter_map(|group| group.get("tasks")));
    }

    for list in lists {
        for task in list.as_array().into_iter().flatten() {
            statuses.push(
                task.get("status")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            );
        }
    }
}

/// Reads a Markdown plan: simple front matter (`status:`, `tags:`, `title:`), the first `# ` heading, the first paragraph and the `- [x]` checklist.
fn parse_markdown(text: &str) -> Parsed {
    let (front, body) = split_front_matter(text);
    let mut title = None;
    let mut description_lines: Vec<&str> = Vec::new();
    let mut in_fence = false;
    let mut total = 0;
    let mut done = 0;

    for line in body.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;

            continue;
        }

        if in_fence {
            continue;
        }

        if let Some(mark) = checklist_mark(trimmed) {
            total += 1;
            done += usize::from(mark);

            continue;
        }

        if title.is_none() {
            if let Some(heading) = trimmed.strip_prefix("# ") {
                title = Some(heading.trim().to_string());
            }

            continue;
        }

        // * The description is the first paragraph after the title.
        if trimmed.is_empty() {
            if !description_lines.is_empty() {
                // * Keep scanning for the checklist, but the paragraph is closed.
                description_lines.push("");
            }
        } else if !description_lines.contains(&"") && is_prose(trimmed) {
            description_lines.push(trimmed);
        } else if description_lines.is_empty() {
            // * A list, table or heading before any prose: no description from here.
            description_lines.push("");
        }
    }

    let description: String = description_lines
        .iter()
        .take_while(|line| !line.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" ");
    let status_word = front.get("status").cloned();

    Parsed {
        title: front
            .get("title")
            .cloned()
            .filter(|title| !title.is_empty())
            .or(title.filter(|title| !title.is_empty())),
        description: (!description.is_empty()).then(|| truncate(&description)),
        tags: front
            .get("tags")
            .map(|tags| parse_tags(tags))
            .unwrap_or_default(),
        raw_status: status_word.filter(|word| !word.is_empty()),
        created_at: front
            .get("createdAt")
            .or_else(|| front.get("created_at"))
            .or_else(|| front.get("date"))
            .cloned()
            .filter(|date| !date.is_empty()),
        tasks_total: total,
        tasks_done: done,
        tasks_started: false,
    }
}

/// `Some(true)` for `- [x]`, `Some(false)` for `- [ ]`, none for any other line.
fn checklist_mark(line: &str) -> Option<bool> {
    let rest = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))?;

    match rest.get(..3)? {
        "[x]" | "[X]" => Some(true),
        "[ ]" => Some(false),
        _ => None,
    }
}

/// A line of running text (not a heading, list item, table row, quote or HTML).
fn is_prose(line: &str) -> bool {
    !line.starts_with(['#', '-', '*', '|', '>', '<', '!', '+'])
        && !line
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_digit())
}

fn truncate(text: &str) -> String {
    if text.chars().count() <= MAX_DESCRIPTION_CHARS {
        return text.to_string();
    }

    let cut: String = text.chars().take(MAX_DESCRIPTION_CHARS).collect();

    format!("{}...", cut.trim_end())
}

/// Splits `---` front matter off a Markdown text: `key: value` lines (values unquoted; `- item` lines under a key join into a list) and the rest.
fn split_front_matter(text: &str) -> (HashMap<String, String>, &str) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return (HashMap::new(), text);
    };
    let mut fields: HashMap<String, String> = HashMap::new();
    let mut last_key: Option<String> = None;
    let mut consumed = 0;

    for line in rest.split_inclusive('\n') {
        consumed += line.len();

        let trimmed = line.trim();

        if trimmed == "---" {
            return (fields, &rest[consumed..]);
        }

        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(entry) = last_key.as_ref().and_then(|key| fields.get_mut(key)) {
                if !entry.is_empty() {
                    entry.push(',');
                }

                entry.push_str(item.trim());
            }

            continue;
        }

        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim().to_string();

            fields.insert(key.clone(), unquote(value.trim()).to_string());
            last_key = Some(key);
        }
    }

    // * No closing line: it was not front matter after all.
    (HashMap::new(), text)
}

fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|rest| rest.strip_suffix('\''))
        })
        .unwrap_or(value)
}

/// `[a, b]`, `a, b` or the joined `- item` lines.
fn parse_tags(text: &str) -> Vec<String> {
    text.trim_matches(['[', ']'])
        .split(',')
        .map(|tag| unquote(tag.trim()).to_string())
        .filter(|tag| !tag.is_empty())
        .collect()
}

/// Most items of one section (requirements, tasks...) and blocks of a Markdown plan that the detail carries.
const MAX_DETAIL_ITEMS: usize = 500;

/// A requirement, acceptance criterion or open question of a plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub id: Option<String>,
    pub text: String,
    /// Where it comes from, which requirement it checks, or its default answer.
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTask {
    pub id: Option<String>,
    pub title: String,
    pub status: PlanStatus,
    pub raw_status: Option<String>,
    pub priority: Option<String>,
    /// Files the task says it changes.
    pub files: Vec<String>,
    /// What was done and how it was checked (the `result` field), when the task has one.
    pub result: Option<String>,
}

/// One block of a Markdown plan, ready for the front end to draw.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MarkdownBlock {
    Heading { level: usize, text: String },
    Paragraph { text: String },
    Bullet { text: String },
    Checklist { text: String, checked: bool },
    Code { text: String },
}

/// Everything the detail view of one plan shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDocDetail {
    #[serde(flatten)]
    pub summary: PlanDoc,
    pub requirements: Vec<PlanItem>,
    pub tasks: Vec<PlanTask>,
    pub acceptance_criteria: Vec<PlanItem>,
    pub open_questions: Vec<PlanItem>,
    /// The Markdown body (empty for a JSON plan).
    pub blocks: Vec<MarkdownBlock>,
}

/// Reads one plan of `docs/plans/` in full. `path` is the `path` of a card (`docs/plans/<name>`); anything else is refused with a fixed key.
pub fn read(workspace: &Workspace, path: &str) -> Result<PlanDocDetail, &'static str> {
    let name = path
        .strip_prefix(&format!("{PLANS_FOLDER}/"))
        .filter(|name| is_plan_name(name))
        .filter(|_| crate::workspace::normalise(path).as_deref() == Some(path))
        .ok_or("plan_docs.bad_path")?;
    let format = format_of(name).ok_or("plan_docs.bad_path")?;
    let (sandbox, folder) = plans_folder(workspace).ok_or("plan_docs.not_found")?;
    let (text, _) = read_text(&sandbox, &folder, name).ok_or("plan_docs.not_found")?;
    let has_markdown = format == PlanFormat::Json
        && sandbox
            .resolve(&folder.join(format!("{}.md", key_of(name))))
            .is_some();
    let index = read_index(&sandbox, &folder);
    let summary = read_plan(&sandbox, &folder, name, format, has_markdown, &index)
        .ok_or("plan_docs.unreadable")?;

    Ok(match format {
        PlanFormat::Json => json_detail(summary, &text).ok_or("plan_docs.unreadable")?,
        PlanFormat::Md => PlanDocDetail {
            summary,
            requirements: Vec::new(),
            tasks: Vec::new(),
            acceptance_criteria: Vec::new(),
            open_questions: Vec::new(),
            blocks: markdown_blocks(&text),
        },
    })
}

fn json_detail(summary: PlanDoc, text: &str) -> Option<PlanDocDetail> {
    let root: Value = serde_json::from_str(text).ok()?;
    let content = root.get("content").filter(|content| content.is_object());
    let bodies: Vec<&Value> = std::iter::once(&root).chain(content).collect();
    let items = |key: &str| -> Vec<PlanItem> {
        bodies
            .iter()
            .find_map(|body| body.get(key).and_then(Value::as_array))
            .map(|list| {
                list.iter()
                    .filter_map(plan_item)
                    .take(MAX_DETAIL_ITEMS)
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut task_values: Vec<&Value> = Vec::new();

    for body in &bodies {
        task_values.extend(
            body.get("tasks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        );

        for group in body
            .get("groups")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            task_values.extend(
                group
                    .get("tasks")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten(),
            );
        }
    }

    Some(PlanDocDetail {
        requirements: items("requirements"),
        acceptance_criteria: items("acceptanceCriteria"),
        open_questions: items("openQuestions"),
        tasks: task_values
            .into_iter()
            .map(plan_task)
            .take(MAX_DETAIL_ITEMS)
            .collect(),
        blocks: Vec::new(),
        summary,
    })
}

/// An entry written either as a plain string or as an object with `id` and a text field.
fn plan_item(value: &Value) -> Option<PlanItem> {
    if let Some(text) = value.as_str() {
        let text = text.trim();

        return (!text.is_empty()).then(|| PlanItem {
            id: None,
            text: text.to_string(),
            note: None,
        });
    }

    let text = ["text", "question", "title", "description"]
        .iter()
        .find_map(|key| text_field(value, key))?;
    let note = ["source", "requirement", "default"]
        .iter()
        .find_map(|key| text_field(value, key));

    Some(PlanItem {
        id: text_field(value, "id"),
        text,
        note,
    })
}

fn plan_task(value: &Value) -> PlanTask {
    let raw_status = text_field(value, "status");
    let files = value
        .get("filesToChange")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|file| {
                    file.as_str()
                        .map(str::to_string)
                        .or_else(|| text_field(file, "path"))
                })
                .collect()
        })
        .unwrap_or_default();

    PlanTask {
        id: text_field(value, "id"),
        title: text_field(value, "title").unwrap_or_default(),
        status: raw_status
            .as_deref()
            .map_or(PlanStatus::Unknown, PlanStatus::from_word),
        raw_status,
        priority: text_field(value, "priority"),
        files,
        result: text_field(value, "result"),
    }
}

/// The Markdown body (front matter left out) as headings, paragraphs, list items, checklist items and code blocks.
fn markdown_blocks(text: &str) -> Vec<MarkdownBlock> {
    let (_, body) = split_front_matter(text);
    let mut blocks = Vec::new();
    let mut paragraph: Vec<&str> = Vec::new();
    let mut code: Option<Vec<&str>> = None;

    fn close(paragraph: &mut Vec<&str>, blocks: &mut Vec<MarkdownBlock>) {
        if !paragraph.is_empty() {
            blocks.push(MarkdownBlock::Paragraph {
                text: paragraph.join(" "),
            });
            paragraph.clear();
        }
    }

    for line in body.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            match code.take() {
                Some(lines) => blocks.push(MarkdownBlock::Code {
                    text: lines.join("\n"),
                }),
                None => {
                    close(&mut paragraph, &mut blocks);
                    code = Some(Vec::new());
                }
            }

            continue;
        }

        if let Some(lines) = code.as_mut() {
            lines.push(line);

            continue;
        }

        if trimmed.is_empty() {
            close(&mut paragraph, &mut blocks);
        } else if let Some(mark) = checklist_mark(trimmed) {
            close(&mut paragraph, &mut blocks);
            blocks.push(MarkdownBlock::Checklist {
                text: trimmed[5..].trim().to_string(),
                checked: mark,
            });
        } else if let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
        {
            close(&mut paragraph, &mut blocks);
            blocks.push(MarkdownBlock::Bullet {
                text: item.trim().to_string(),
            });
        } else if trimmed.starts_with('#') {
            close(&mut paragraph, &mut blocks);

            let level = trimmed.chars().take_while(|c| *c == '#').count();

            blocks.push(MarkdownBlock::Heading {
                level: level.min(6),
                text: trimmed[level..].trim().to_string(),
            });
        } else {
            paragraph.push(trimmed);
        }

        if blocks.len() >= MAX_DETAIL_ITEMS {
            break;
        }
    }

    close(&mut paragraph, &mut blocks);

    if let Some(lines) = code {
        blocks.push(MarkdownBlock::Code {
            text: lines.join("\n"),
        });
    }

    blocks
}

/// Event sent when the files of `docs/plans/` of a project changed; its payload is a [`PlansChanged`].
pub const PLANS_CHANGED_EVENT: &str = "plans-changed";

/// How often the plans folder is looked at.
const WATCH_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlansChanged {
    /// Project folder, as in `PlanDocsList::root`.
    pub root: String,
}

/// One plan file as the watcher sees it: name, modified time (milliseconds) and size.
pub type FileStamp = (String, u128, u64);

/// Name, modified time and size of every `*.json` / `*.md` file in `folder`, sorted by name; an absent folder gives an empty list.
pub fn fingerprint(folder: &Path) -> Vec<FileStamp> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let stamp_of = |name: String, path: &Path| -> Option<FileStamp> {
        format_of(&name)?;
        let metadata = fs::metadata(path)
            .ok()
            .filter(|metadata| metadata.is_file())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |elapsed| elapsed.as_millis());

        Some((name, modified, metadata.len()))
    };
    let mut stamps: Vec<FileStamp> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();

        if entry.metadata().is_ok_and(|metadata| metadata.is_dir()) {
            stamps.extend(
                PLAN_FILES.iter().filter_map(|file| {
                    stamp_of(format!("{name}/{file}"), &entry.path().join(file))
                }),
            );
        } else if let Some(stamp) = stamp_of(name, &entry.path()) {
            stamps.push(stamp);
        }
    }

    stamps.sort();
    stamps
}

/// Roots that already have a watcher thread: one per project.
fn watched_roots() -> &'static Mutex<HashSet<PathBuf>> {
    static ROOTS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

    ROOTS.get_or_init(Mutex::default)
}

/// Starts (once per project) a background thread that emits `plans-changed` when the plan files change.
/// The thread is detached: it ends with the app.
pub fn watch(app: AppHandle, workspace: &Workspace) {
    let root = workspace.root().to_path_buf();
    let is_new = watched_roots()
        .lock()
        .map(|mut roots| roots.insert(root.clone()))
        .unwrap_or(false);

    if !is_new {
        return;
    }

    let folder = root.join(PLANS_FOLDER);
    let payload = PlansChanged {
        root: root.display().to_string(),
    };
    let spawned = std::thread::Builder::new()
        .name("plans-watcher".into())
        .spawn(move || {
            let mut last = fingerprint(&folder);

            loop {
                std::thread::sleep(WATCH_INTERVAL);

                let current = fingerprint(&folder);

                if current != last {
                    last = current;
                    // * A closed window is no reason to stop looking.
                    let _ = app.emit(PLANS_CHANGED_EVENT, payload.clone());
                }
            }
        });

    if spawned.is_err() {
        if let Ok(mut roots) = watched_roots().lock() {
            roots.remove(&root);
        }
    }
}

/// Deletes a finished plan of `docs/plans/` with what belongs to it: a plan folder `<name>/` goes with its evidence and tests, a loose `<name>.json` / `<name>.md` goes with the file of the other format. Only a plan whose status is `done` is deleted.
pub fn delete(workspace: &Workspace, path: &str) -> Result<(), &'static str> {
    let detail = read(workspace, path)?;

    if detail.summary.status != PlanStatus::Done {
        return Err("plan_docs.not_done");
    }

    let name = path
        .strip_prefix(&format!("{PLANS_FOLDER}/"))
        .ok_or("plan_docs.bad_path")?;
    let (sandbox, folder) = plans_folder(workspace).ok_or("plan_docs.not_found")?;
    let resolve = |relative: &str| sandbox.resolve(&folder.join(relative));
    let failed = |_| "plan_docs.delete_failed";

    match name.split_once('/') {
        // * The folder itself, never a link: `resolve` follows links, so a folder that is one is refused by the name check below.
        Some((directory, _)) => {
            let target = resolve(directory).ok_or("plan_docs.not_found")?;

            if target.parent() != Some(folder.as_path())
                || !target.is_dir()
                || target.file_name().and_then(|value| value.to_str()) != Some(directory)
            {
                return Err("plan_docs.bad_path");
            }

            std::fs::remove_dir_all(&target).map_err(failed)
        }
        None => {
            let key = key_of(name);

            for candidate in [name.to_string(), format!("{key}.json"), format!("{key}.md")] {
                let Some(target) = resolve(&candidate) else {
                    continue;
                };

                if target.parent() == Some(folder.as_path()) && target.is_file() {
                    std::fs::remove_file(&target).map_err(failed)?;
                }
            }

            Ok(())
        }
    }
}

/// The statuses a card can be dropped on, with the word written in the file (each maps back through `PlanStatus::from_word`).
fn status_word(status: &str) -> Option<&'static str> {
    match status {
        "draft" => Some("DRAFT"),
        "in_progress" => Some("IN_PROGRESS"),
        "review" => Some("CHO_KIEM_TRA"),
        "done" => Some("DONE"),
        _ => None,
    }
}

/// Changes the status of the plan at `path` (the `path` of a card) to `status` (`draft`, `in_progress`, `review` or `done`): only the status word of the file is rewritten, the rest of the text stays as it was.
pub fn set_status(workspace: &Workspace, path: &str, status: &str) -> Result<(), &'static str> {
    let word = status_word(status).ok_or("plan_docs.bad_status")?;
    let name = path
        .strip_prefix(&format!("{PLANS_FOLDER}/"))
        .filter(|name| is_plan_name(name))
        .filter(|_| crate::workspace::normalise(path).as_deref() == Some(path))
        .ok_or("plan_docs.bad_path")?;
    let format = format_of(name).ok_or("plan_docs.bad_path")?;
    let text = workspace.read(path).map_err(|_| "plan_docs.not_found")?;
    let updated = match format {
        PlanFormat::Json => with_json_status(&text, word),
        PlanFormat::Md => Some(with_markdown_status(&text, word)),
    }
    .ok_or("plan_docs.unreadable")?;

    if updated == text {
        return Ok(());
    }

    workspace
        .write(path, &updated, Some(&crate::workspace::hash(&text)))
        .map(|_| ())
        .map_err(|_| "plan_docs.set_status_failed")
}

/// `text` (a JSON plan) with its status word replaced; the key is looked for where `parse_json` reads it (top level, `content`, `content.meta`). A plan without one gets the key as its first field. None when the text is not a JSON object.
fn with_json_status(text: &str, word: &str) -> Option<String> {
    let root: Value = serde_json::from_str(text).ok()?;
    let object = root.as_object()?;
    let has_status = |value: &Value| value.get("status").is_some_and(Value::is_string);
    let path: &[&str] = if has_status(&root) {
        &["status"]
    } else if object.get("content").is_some_and(has_status) {
        &["content", "status"]
    } else if object
        .get("content")
        .and_then(|content| content.get("meta"))
        .is_some_and(has_status)
    {
        &["content", "meta", "status"]
    } else {
        let open = text.find('{')? + 1;
        let indent = text[open..]
            .trim_start_matches(['\r', '\n'])
            .chars()
            .take_while(|character| *character == ' ' || *character == '\t')
            .collect::<String>();
        let separator = if object.is_empty() { "" } else { "," };
        let line = if indent.is_empty() {
            format!("\"status\": \"{word}\"{separator}")
        } else {
            format!("\n{indent}\"status\": \"{word}\"{separator}")
        };

        return Some(format!("{}{line}{}", &text[..open], &text[open..]));
    };
    let (start, end) = JsonScanner::new(text).string_value_span(path)?;

    Some(format!("{}\"{word}\"{}", &text[..start], &text[end..]))
}

/// Walks valid JSON text to find where the string value of a key path sits, without parsing it into a map (that would reorder the keys).
struct JsonScanner<'a> {
    text: &'a str,
    bytes: &'a [u8],
    position: usize,
}

impl<'a> JsonScanner<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            bytes: text.as_bytes(),
            position: 0,
        }
    }

    fn skip_whitespace(&mut self) {
        while self
            .bytes
            .get(self.position)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.position += 1;
        }
    }

    /// Skips one string, returning its start and end (after the closing quote).
    fn skip_string(&mut self) -> Option<(usize, usize)> {
        let start = self.position;

        if self.bytes.get(start) != Some(&b'"') {
            return None;
        }

        self.position += 1;

        while let Some(&byte) = self.bytes.get(self.position) {
            self.position += 1;

            match byte {
                b'\\' => self.position += 1,
                b'"' => return Some((start, self.position)),
                _ => {}
            }
        }

        None
    }

    /// Skips one value of any kind.
    fn skip_value(&mut self) -> Option<()> {
        self.skip_whitespace();

        match *self.bytes.get(self.position)? {
            b'"' => self.skip_string().map(|_| ()),
            b'{' | b'[' => {
                let mut depth = 0usize;

                while let Some(&byte) = self.bytes.get(self.position) {
                    match byte {
                        b'"' => {
                            self.skip_string()?;

                            continue;
                        }
                        b'{' | b'[' => depth += 1,
                        b'}' | b']' => depth -= 1,
                        _ => {}
                    }

                    self.position += 1;

                    if depth == 0 {
                        return Some(());
                    }
                }

                None
            }
            _ => {
                while self
                    .bytes
                    .get(self.position)
                    .is_some_and(|byte| !matches!(byte, b',' | b'}' | b']'))
                {
                    self.position += 1;
                }

                Some(())
            }
        }
    }

    /// Start and end of the string value found by following `path` from the object at the current position.
    fn string_value_span(&mut self, path: &[&str]) -> Option<(usize, usize)> {
        let (key, rest) = path.split_first()?;

        self.skip_whitespace();

        if self.bytes.get(self.position) != Some(&b'{') {
            return None;
        }

        self.position += 1;

        loop {
            self.skip_whitespace();

            if self.bytes.get(self.position) != Some(&b'"') {
                return None;
            }

            let (start, end) = self.skip_string()?;
            let name = serde_json::from_str::<String>(&self.text[start..end]).ok()?;

            self.skip_whitespace();

            if self.bytes.get(self.position) != Some(&b':') {
                return None;
            }

            self.position += 1;
            self.skip_whitespace();

            if name == *key {
                return if rest.is_empty() {
                    self.skip_string()
                } else {
                    self.string_value_span(rest)
                };
            }

            self.skip_value()?;
            self.skip_whitespace();

            if self.bytes.get(self.position) == Some(&b',') {
                self.position += 1;
            } else {
                return None;
            }
        }
    }
}

/// `text` (a Markdown plan) with the `status:` line of its front matter set to `word`; a plan without the line gets one, a plan without front matter gets a front matter.
fn with_markdown_status(text: &str, word: &str) -> String {
    let bom = if text.starts_with('\u{feff}') {
        "\u{feff}"
    } else {
        ""
    };
    let body = text.strip_prefix('\u{feff}').unwrap_or(text);
    let newline = if body.contains("\r\n") { "\r\n" } else { "\n" };
    let opening = format!("---{newline}");

    let Some(rest) = body.strip_prefix(&opening) else {
        return format!("{bom}---{newline}status: {word}{newline}---{newline}{newline}{body}");
    };
    let mut offset = 0;

    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim();

        if trimmed == "---" {
            // * No `status:` line before the closing one: it goes in just above it.
            return format!(
                "{bom}{opening}{}status: {word}{newline}{}",
                &rest[..offset],
                &rest[offset..]
            );
        }

        if line.trim_start().starts_with("status:") {
            let ending = &line[line.trim_end_matches(['\r', '\n']).len()..];
            let indent = &line[..line.len() - line.trim_start().len()];

            return format!(
                "{bom}{opening}{}{indent}status: {word}{ending}{}",
                &rest[..offset],
                &rest[offset + line.len()..]
            );
        }

        offset += line.len();
    }

    // * No closing line: it was not front matter after all.
    format!("{bom}---{newline}status: {word}{newline}---{newline}{newline}{body}")
}

#[cfg(test)]
#[path = "../../tests/unit/plans/docs.rs"]
mod tests;
