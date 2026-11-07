//! The plan documents of a project: the `docs/plans/` folder read as a list of cards (title, status, progress). Read only; never writes.
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
use std::time::UNIX_EPOCH;

/// Folder of the plans, relative to the project root.
const PLANS_FOLDER: &str = "docs/plans";

/// The list file: a source of title, description and tags when a plan lacks them, never a card of its own.
const INDEX_FILE: &str = "index.json";

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

    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name != INDEX_FILE && format_of(name).is_some())
        .collect();

    names.sort();

    let truncated = names.len() > MAX_FILES;

    names.truncate(MAX_FILES);

    let index = read_index(&sandbox, &folder);
    let json_stems: HashSet<String> = names
        .iter()
        .filter(|name| format_of(name) == Some(PlanFormat::Json))
        .map(|name| stem_of(name))
        .collect();
    let mut skipped = 0;
    let mut plans = Vec::new();

    for name in &names {
        let Some(format) = format_of(name) else {
            continue;
        };
        let stem = stem_of(name);

        // * JSON wins: its Markdown twin is only a flag on the card.
        if format == PlanFormat::Md && json_stems.contains(&stem) {
            continue;
        }

        let has_markdown = format == PlanFormat::Json && names.contains(&format!("{stem}.md"));

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

fn stem_of(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
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
            let file = path.rsplit('/').next()?.to_string();

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
        .filter(|name| !name.contains('/') && *name != INDEX_FILE)
        .filter(|_| crate::workspace::normalise(path).as_deref() == Some(path))
        .ok_or("plan_docs.bad_path")?;
    let format = format_of(name).ok_or("plan_docs.bad_path")?;
    let (sandbox, folder) = plans_folder(workspace).ok_or("plan_docs.not_found")?;
    let (text, _) = read_text(&sandbox, &folder, name).ok_or("plan_docs.not_found")?;
    let has_markdown = format == PlanFormat::Json
        && sandbox
            .resolve(&folder.join(format!("{}.md", stem_of(name))))
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

#[cfg(test)]
#[path = "../tests/unit/plan_docs.rs"]
mod tests;
