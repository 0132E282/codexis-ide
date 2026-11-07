//! Read-only listing of the skills, agents, MCP servers, rules and hooks configured for the open project and this machine.
//!
//! Nothing here writes. Files are read up to a size limit, and a symlink is followed only when its target stays inside the folder it was found under (the project root or the home folder). Secrets (env values, headers, tokens, arguments, URL queries) are never returned.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::commands::AppState;
use crate::permission::Sandbox;
use crate::workspace::Workspace;

/// Largest file read for a skill, agent, rule or settings file.
const MAX_FILE_BYTES: u64 = 256 * 1024;
/// `~/.claude.json` also holds the whole conversation history index, so it may be big.
const MAX_CLAUDE_JSON_BYTES: u64 = 8 * 1024 * 1024;
const MAX_EXCERPT_CHARS: usize = 300;
const MAX_ENTRIES_PER_FOLDER: usize = 500;

/// Called once at start-up with the database path: this module keeps no state.
///
/// # Errors
/// Never fails.
pub fn setup(_app: &tauri::App, _database: &Path) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

/// Where an entry was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Project,
    Machine,
}

/// A skill or an agent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    name: String,
    description: String,
    model: Option<String>,
    tools: Option<String>,
    scope: Scope,
    /// Shown to the user: relative to the project, or `~/...`.
    path: String,
    /// Path relative to the project root (project entries only), usable with `open_in_vscode`.
    relative_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    name: String,
    /// `stdio`, `http`, `sse`, ...
    kind: String,
    /// The command, or the URL without credentials and query.
    target: String,
    scope: Scope,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleFile {
    name: String,
    excerpt: String,
    scope: Scope,
    path: String,
    relative_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEntry {
    event: String,
    matcher: String,
    kind: String,
    command: String,
    scope: Scope,
    path: String,
}

/// Entries plus the problems met on the way (unreadable or oversized files), so one bad file never hides the rest.
#[derive(Debug, Serialize)]
pub struct Listing<T> {
    items: Vec<T>,
    warnings: Vec<String>,
}

impl<T> Listing<T> {
    fn new() -> Self {
        Self {
            items: Vec::new(),
            warnings: Vec::new(),
        }
    }
}

/// One folder tools are looked up in: the project root or the home folder.
struct Base {
    scope: Scope,
    /// Holds the canonical root, so symlink targets can be compared to it.
    sandbox: Sandbox,
}

impl Base {
    fn new(scope: Scope, path: &Path) -> Option<Self> {
        Some(Self {
            scope,
            sandbox: Sandbox::open(path)?,
        })
    }

    /// `~/x` for the home folder, `x` for the project.
    fn display(&self, path: &Path) -> String {
        let relative = path
            .strip_prefix(self.sandbox.root())
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        match self.scope {
            Scope::Project => relative,
            Scope::Machine => format!("~/{relative}"),
        }
    }

    fn relative(&self, path: &Path) -> Option<String> {
        (self.scope == Scope::Project).then(|| self.display(path))
    }

    /// The real path of `path` when it exists and stays inside this base.
    fn contained(&self, path: &Path) -> Option<PathBuf> {
        self.sandbox.resolve(path)
    }

    /// Reads a regular file (through a contained symlink at most), up to `limit` bytes.
    fn read(&self, path: &Path, limit: u64) -> Result<Option<String>, String> {
        let Some(real) = self.contained(path) else {
            return if path.symlink_metadata().is_ok() {
                Err(format!("tools.link_outside|{}", self.display(path)))
            } else {
                Ok(None)
            };
        };

        let metadata =
            fs::metadata(&real).map_err(|error| format!("{}: {error}", self.display(path)))?;

        if !metadata.is_file() {
            return Ok(None);
        }

        if metadata.len() > limit {
            return Err(format!("tools.file_too_large|{}", self.display(path)));
        }

        let mut text = String::new();

        fs::File::open(&real)
            .and_then(|file| file.take(limit).read_to_string(&mut text))
            .map_err(|error| format!("{}: {error}", self.display(path)))?;

        Ok(Some(text))
    }

    /// Children of a folder (sorted by name), skipping anything that resolves outside the base.
    fn children(&self, folder: &Path) -> Vec<PathBuf> {
        let Some(real) = self.contained(folder).filter(|real| real.is_dir()) else {
            return Vec::new();
        };
        let Ok(entries) = fs::read_dir(&real) else {
            return Vec::new();
        };
        let mut paths: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .take(MAX_ENTRIES_PER_FOLDER)
            .map(|entry| folder.join(entry.file_name()))
            .collect();

        paths.sort();
        paths
    }
}

fn home_folder() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

// ---------- front matter ----------

#[derive(Default)]
struct Meta {
    name: Option<String>,
    description: Option<String>,
    model: Option<String>,
    tools: Option<String>,
}

fn unquote(value: &str) -> String {
    let value = value.trim();

    for quote in ['"', '\''] {
        if let Some(inner) = value
            .strip_prefix(quote)
            .and_then(|v| v.strip_suffix(quote))
        {
            return inner.to_owned();
        }
    }

    value.to_owned()
}

/// Reads the `---` block at the top of a Markdown file: plain values, folded/literal blocks (`>`, `|`) and `- item` lists.
fn front_matter(text: &str) -> Meta {
    let mut meta = Meta::default();
    let mut lines = text.lines();

    if lines.next().map(str::trim) != Some("---") {
        return meta;
    }

    let block: Vec<&str> = lines.take_while(|line| line.trim() != "---").collect();
    let mut index = 0;

    while index < block.len() {
        let line = block[index];
        index += 1;

        let Some((key, value)) = line
            .split_once(':')
            .filter(|_| !line.starts_with([' ', '\t']))
        else {
            continue;
        };
        let mut value = value.trim().to_owned();
        let continuation = matches!(value.as_str(), "" | ">" | "|" | ">-" | "|-");

        if continuation {
            let mut parts = Vec::new();

            while index < block.len()
                && (block[index].starts_with([' ', '\t', '-']) || block[index].trim().is_empty())
            {
                let part = block[index].trim().trim_start_matches("- ");

                if !part.is_empty() {
                    parts.push(unquote(part));
                }

                index += 1;
            }

            value = parts.join(if value.is_empty() { ", " } else { " " });
        } else {
            value = unquote(&value);
        }

        match key.trim() {
            "name" => meta.name = Some(value),
            "description" => meta.description = Some(value),
            "model" => meta.model = Some(value),
            "tools" | "allowed-tools" => meta.tools = Some(value),
            _ => {}
        }
    }

    meta
}

/// `key = "value"` lines at the top level of a TOML file (Codex agents).
fn toml_meta(text: &str) -> Meta {
    let mut meta = Meta::default();

    for line in text.lines() {
        let line = line.trim();

        if line.starts_with('[') {
            break;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = unquote(value);

        match key.trim() {
            "name" => meta.name = Some(value),
            "description" => meta.description = Some(value),
            "model" => meta.model = Some(value),
            _ => {}
        }
    }

    meta
}

fn entry(base: &Base, path: &Path, fallback_name: &str, meta: Meta) -> ToolEntry {
    ToolEntry {
        name: meta
            .name
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| fallback_name.to_owned()),
        description: meta.description.unwrap_or_default(),
        model: meta.model.filter(|model| !model.is_empty()),
        tools: meta.tools.filter(|tools| !tools.is_empty()),
        scope: base.scope,
        path: base.display(path),
        relative_path: base.relative(path),
    }
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .map_or_else(String::new, |stem| stem.to_string_lossy().into_owned())
}

fn collect<T>(
    listing: &mut Listing<T>,
    read: Result<Option<String>, String>,
    build: impl FnOnce(String) -> Vec<T>,
) {
    match read {
        Ok(Some(text)) => listing.items.extend(build(text)),
        Ok(None) => {}
        Err(warning) => listing.warnings.push(warning),
    }
}

// ---------- skills / agents ----------

// ---------- rules ----------

/// First lines of a Markdown file (after its front matter), cut to a short excerpt.
fn excerpt(text: &str) -> String {
    let mut lines = text.lines().peekable();

    if lines.peek().map(|line| line.trim()) == Some("---") {
        lines.next();
        lines
            .by_ref()
            .take_while(|line| line.trim() != "---")
            .for_each(drop);
    }

    let joined = lines
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join(" ");

    if joined.chars().count() > MAX_EXCERPT_CHARS {
        let cut: String = joined.chars().take(MAX_EXCERPT_CHARS).collect();

        format!("{cut}…")
    } else {
        joined
    }
}

// ---------- MCP ----------

/// Drops credentials (`user:pass@`), query and fragment from a URL.
fn clean_url(url: &str) -> String {
    let without_tail = url.split(['?', '#']).next().unwrap_or_default();

    match without_tail.split_once("://") {
        Some((scheme, rest)) => {
            let host = rest.rsplit_once('@').map_or(rest, |(_, host)| host);

            format!("{scheme}://{host}")
        }
        None => without_tail.to_owned(),
    }
}

fn mcp_from_json(servers: &Value, scope: Scope, path: &str, items: &mut Vec<McpServer>) {
    let Some(servers) = servers.as_object() else {
        return;
    };

    for (name, server) in servers {
        let text = |key: &str| server.get(key).and_then(Value::as_str);
        let (kind, target) = match (text("command"), text("url")) {
            (Some(command), _) => (text("type").unwrap_or("stdio"), command.to_owned()),
            (None, Some(url)) => (text("type").unwrap_or("http"), clean_url(url)),
            (None, None) => (text("type").unwrap_or("?"), String::new()),
        };

        items.push(McpServer {
            name: name.clone(),
            kind: kind.to_owned(),
            target,
            scope,
            path: path.to_owned(),
        });
    }
}

/// `[mcp_servers.NAME]` tables of a Codex `config.toml`: only the `command` / `url` keys, never env or headers.
fn mcp_from_toml(text: &str, path: &str, items: &mut Vec<McpServer>) {
    let mut current: Option<usize> = None;

    for line in text.lines() {
        let line = line.trim();

        if let Some(header) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            current = header
                .strip_prefix("mcp_servers.")
                .filter(|name| !name.contains('.'))
                .map(|name| {
                    items.push(McpServer {
                        name: unquote(name),
                        kind: "stdio".to_owned(),
                        target: String::new(),
                        scope: Scope::Machine,
                        path: path.to_owned(),
                    });

                    items.len() - 1
                });
            continue;
        }

        let (Some(index), Some((key, value))) = (current, line.split_once('=')) else {
            continue;
        };

        match key.trim() {
            "command" => items[index].target = unquote(value),
            "url" => {
                items[index].kind = "http".to_owned();
                items[index].target = clean_url(&unquote(value));
            }
            _ => {}
        }
    }
}

/// A readable file that is not valid JSON deserves a visible warning rather than an empty list.
fn json_parse_warning(base: &Base, path: &Path, limit: u64) -> Option<String> {
    let text = base.read(path, limit).ok().flatten()?;

    serde_json::from_str::<Value>(&text)
        .is_err()
        .then(|| format!("tools.invalid_json|{}", base.display(path)))
}

// ---------- hooks ----------

fn hooks_from_json(value: &Value, base: &Base, path: &str, items: &mut Vec<HookEntry>) {
    let Some(events) = value.get("hooks").and_then(Value::as_object) else {
        return;
    };

    for (event, groups) in events {
        for group in groups.as_array().into_iter().flatten() {
            let matcher = group.get("matcher").and_then(Value::as_str).unwrap_or("*");

            for hook in group
                .get("hooks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let text = |key: &str| hook.get(key).and_then(Value::as_str).unwrap_or_default();

                items.push(HookEntry {
                    event: event.clone(),
                    matcher: matcher.to_owned(),
                    kind: if text("type").is_empty() {
                        "command"
                    } else {
                        text("type")
                    }
                    .to_owned(),
                    command: if text("command").is_empty() {
                        text("prompt")
                    } else {
                        text("command")
                    }
                    .to_owned(),
                    scope: base.scope,
                    path: path.to_owned(),
                });
            }
        }
    }
}

/// Scans the tool folders (skills, agents, rules, MCP servers, hooks) of the project and the home folder.
pub struct ToolScanner {
    bases: Vec<Base>,
}

impl ToolScanner {
    /// Project root (validated through the workspace sandbox) and the home folder.
    pub fn new(project_root: Option<&str>, home: Option<&Path>) -> Self {
        let project = project_root.and_then(|root| Workspace::open(Path::new(root)).ok());

        Self::with_project(project.as_ref(), home)
    }

    /// A project workspace that was already allowed (see `AppState::workspace_for`) and the home folder.
    pub fn with_project(project: Option<&Workspace>, home: Option<&Path>) -> Self {
        let project = project.and_then(|workspace| Base::new(Scope::Project, workspace.root()));
        let machine = home.and_then(|home| Base::new(Scope::Machine, home));

        Self {
            bases: project.into_iter().chain(machine).collect(),
        }
    }

    pub fn skills(&self) -> Listing<ToolEntry> {
        let mut listing = Listing::new();
        let mut seen = Vec::new();

        for base in &self.bases {
            for folder in [".claude/skills", ".agents/skills"] {
                for directory in base.children(&base.sandbox.root().join(folder)) {
                    let file = directory.join("SKILL.md");
                    let Some(real) = base.contained(&file) else {
                        continue;
                    };

                    if seen.contains(&real) {
                        continue;
                    }

                    seen.push(real);

                    let fallback = directory
                        .file_name()
                        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());

                    collect(&mut listing, base.read(&file, MAX_FILE_BYTES), |text| {
                        vec![entry(base, &file, &fallback, front_matter(&text))]
                    });
                }
            }
        }

        listing
    }

    pub fn agents(&self) -> Listing<ToolEntry> {
        let mut listing = Listing::new();
        let mut seen = Vec::new();

        for base in &self.bases {
            for folder in [".claude/agents", ".codex/agents"] {
                for file in base.children(&base.sandbox.root().join(folder)) {
                    let extension = file.extension().and_then(|extension| extension.to_str());

                    if !matches!(extension, Some("md" | "toml")) {
                        continue;
                    }

                    let Some(real) = base.contained(&file) else {
                        continue;
                    };

                    if seen.contains(&real) {
                        continue;
                    }

                    seen.push(real);

                    collect(&mut listing, base.read(&file, MAX_FILE_BYTES), |text| {
                        let meta = if extension == Some("toml") {
                            toml_meta(&text)
                        } else {
                            front_matter(&text)
                        };

                        vec![entry(base, &file, &stem(&file), meta)]
                    });
                }
            }
        }

        listing
    }

    pub fn rules(&self) -> Listing<RuleFile> {
        let mut listing = Listing::new();
        let mut seen = Vec::new();

        for base in &self.bases {
            let mut files = vec![
                base.sandbox.root().join("AGENTS.md"),
                base.sandbox.root().join("CLAUDE.md"),
                base.sandbox.root().join(".claude/CLAUDE.md"),
                base.sandbox.root().join(".codex/AGENTS.md"),
            ];

            for folder in [".claude/rules", ".agents/rules"] {
                files.extend(
                    base.children(&base.sandbox.root().join(folder))
                        .into_iter()
                        .filter(|file| file.extension().is_some_and(|extension| extension == "md")),
                );
            }

            for file in files {
                let Some(real) = base.contained(&file) else {
                    continue;
                };

                if seen.contains(&real) {
                    continue;
                }

                seen.push(real);

                collect(&mut listing, base.read(&file, MAX_FILE_BYTES), |text| {
                    vec![RuleFile {
                        name: file
                            .file_name()
                            .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
                        excerpt: excerpt(&text),
                        scope: base.scope,
                        path: base.display(&file),
                        relative_path: base.relative(&file),
                    }]
                });
            }
        }

        listing
    }

    pub fn mcp(&self) -> Listing<McpServer> {
        let mut listing = Listing::new();

        for base in &self.bases {
            let mut json_sources = Vec::new();

            match base.scope {
                Scope::Project => json_sources.push((".mcp.json", MAX_FILE_BYTES)),
                Scope::Machine => json_sources.push((".claude.json", MAX_CLAUDE_JSON_BYTES)),
            }

            for (file, limit) in json_sources {
                let path = base.sandbox.root().join(file);
                let display = base.display(&path);

                collect(&mut listing, base.read(&path, limit), |text| {
                    let Ok(value) = serde_json::from_str::<Value>(&text) else {
                        return vec![];
                    };
                    let mut items = Vec::new();

                    if let Some(servers) = value.get("mcpServers") {
                        mcp_from_json(servers, base.scope, &display, &mut items);
                    }

                    // `~/.claude.json` also keeps per-project servers under `projects.<root>`.
                    if base.scope == Scope::Machine {
                        for other in self
                            .bases
                            .iter()
                            .filter(|other| other.scope == Scope::Project)
                        {
                            let project_servers = value
                                .pointer("/projects")
                                .and_then(Value::as_object)
                                .and_then(|projects| {
                                    projects.get(other.sandbox.root().to_string_lossy().as_ref())
                                })
                                .and_then(|project| project.get("mcpServers"));

                            if let Some(servers) = project_servers {
                                mcp_from_json(servers, Scope::Project, &display, &mut items);
                            }
                        }
                    }

                    items
                });

                if let Some(warning) = json_parse_warning(base, &path, limit) {
                    listing.warnings.push(warning);
                }
            }

            if base.scope == Scope::Machine {
                let path = base.sandbox.root().join(".codex/config.toml");
                let display = base.display(&path);

                collect(&mut listing, base.read(&path, MAX_FILE_BYTES), |text| {
                    let mut items = Vec::new();

                    mcp_from_toml(&text, &display, &mut items);
                    items
                });
            }
        }

        listing
    }

    pub fn hooks(&self) -> Listing<HookEntry> {
        let mut listing = Listing::new();

        for base in &self.bases {
            for file in [".claude/settings.json", ".claude/settings.local.json"] {
                let path = base.sandbox.root().join(file);
                let display = base.display(&path);

                match base.read(&path, MAX_FILE_BYTES) {
                    Ok(Some(text)) => match serde_json::from_str::<Value>(&text) {
                        Ok(value) => hooks_from_json(&value, base, &display, &mut listing.items),
                        Err(_) => listing
                            .warnings
                            .push(format!("tools.invalid_json|{display}")),
                    },
                    Ok(None) => {}
                    Err(warning) => listing.warnings.push(warning),
                }
            }
        }

        listing
    }
}

// ---------- commands ----------

/// The project workspace for `project_root`, only when it is the open one or a saved project; any other root gives `None`, so only the machine's own configuration is listed.
fn allowed_project(state: &AppState, project_root: Option<&str>) -> Option<Workspace> {
    project_root.and_then(|root| state.workspace_for(Some(root)).ok())
}

fn scanner(state: &AppState, project_root: Option<&str>) -> ToolScanner {
    ToolScanner::with_project(
        allowed_project(state, project_root).as_ref(),
        home_folder().as_deref(),
    )
}

/// `project_root` is the open project's folder; it is checked like any workspace root. Without it only the machine's own configuration is listed.
#[tauri::command]
pub fn tools_skills(state: State<AppState>, project_root: Option<String>) -> Listing<ToolEntry> {
    scanner(&state, project_root.as_deref()).skills()
}

#[tauri::command]
pub fn tools_agents(state: State<AppState>, project_root: Option<String>) -> Listing<ToolEntry> {
    scanner(&state, project_root.as_deref()).agents()
}

#[tauri::command]
pub fn tools_mcp(state: State<AppState>, project_root: Option<String>) -> Listing<McpServer> {
    scanner(&state, project_root.as_deref()).mcp()
}

#[tauri::command]
pub fn tools_rules(state: State<AppState>, project_root: Option<String>) -> Listing<RuleFile> {
    scanner(&state, project_root.as_deref()).rules()
}

#[tauri::command]
pub fn tools_hooks(state: State<AppState>, project_root: Option<String>) -> Listing<HookEntry> {
    scanner(&state, project_root.as_deref()).hooks()
}

#[cfg(test)]
#[path = "../tests/unit/tools.rs"]
mod tests;
