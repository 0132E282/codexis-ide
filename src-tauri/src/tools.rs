//! Read-only listing of the skills, agents, MCP servers, rules and hooks configured for the open project and this machine.
//!
//! Nothing here writes. Files are read up to a size limit, and a symlink is followed only when its target stays inside the folder it was found under (the project root or the home folder). Secrets (env values, headers, tokens, arguments, URL queries) are never returned.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

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
    /// Canonical, so symlink targets can be compared to it.
    root: PathBuf,
}

impl Base {
    fn new(scope: Scope, path: &Path) -> Option<Self> {
        let root = fs::canonicalize(path).ok().filter(|root| root.is_dir())?;

        Some(Self { scope, root })
    }

    /// `~/x` for the home folder, `x` for the project.
    fn display(&self, path: &Path) -> String {
        let relative = path
            .strip_prefix(&self.root)
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
        fs::canonicalize(path)
            .ok()
            .filter(|real| real.starts_with(&self.root))
    }

    /// Reads a regular file (through a contained symlink at most), up to `limit` bytes.
    fn read(&self, path: &Path, limit: u64) -> Result<Option<String>, String> {
        let Some(real) = self.contained(path) else {
            return if path.symlink_metadata().is_ok() {
                Err(format!(
                    "{}: liên kết trỏ ra ngoài thư mục cho phép",
                    self.display(path)
                ))
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
            return Err(format!("{}: tệp quá lớn để đọc", self.display(path)));
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

/// Project root (validated through the workspace sandbox) and the home folder.
fn bases(project_root: Option<&str>, home: Option<&Path>) -> Vec<Base> {
    let project = project_root
        .and_then(|root| Workspace::open(Path::new(root)).ok())
        .and_then(|workspace| Base::new(Scope::Project, workspace.root()));
    let machine = home.and_then(|home| Base::new(Scope::Machine, home));

    project.into_iter().chain(machine).collect()
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

fn skills(bases: &[Base]) -> Listing<ToolEntry> {
    let mut listing = Listing::new();
    let mut seen = Vec::new();

    for base in bases {
        for folder in [".claude/skills", ".agents/skills"] {
            for directory in base.children(&base.root.join(folder)) {
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

fn agents(bases: &[Base]) -> Listing<ToolEntry> {
    let mut listing = Listing::new();
    let mut seen = Vec::new();

    for base in bases {
        for folder in [".claude/agents", ".codex/agents"] {
            for file in base.children(&base.root.join(folder)) {
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

fn rules(bases: &[Base]) -> Listing<RuleFile> {
    let mut listing = Listing::new();
    let mut seen = Vec::new();

    for base in bases {
        let mut files = vec![
            base.root.join("AGENTS.md"),
            base.root.join("CLAUDE.md"),
            base.root.join(".claude/CLAUDE.md"),
            base.root.join(".codex/AGENTS.md"),
        ];

        for folder in [".claude/rules", ".agents/rules"] {
            files.extend(
                base.children(&base.root.join(folder))
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

fn mcp(bases: &[Base]) -> Listing<McpServer> {
    let mut listing = Listing::new();

    for base in bases {
        let mut json_sources = Vec::new();

        match base.scope {
            Scope::Project => json_sources.push((".mcp.json", MAX_FILE_BYTES)),
            Scope::Machine => json_sources.push((".claude.json", MAX_CLAUDE_JSON_BYTES)),
        }

        for (file, limit) in json_sources {
            let path = base.root.join(file);
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
                    for other in bases.iter().filter(|other| other.scope == Scope::Project) {
                        let project_servers = value
                            .pointer("/projects")
                            .and_then(Value::as_object)
                            .and_then(|projects| {
                                projects.get(other.root.to_string_lossy().as_ref())
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
            let path = base.root.join(".codex/config.toml");
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

/// A readable file that is not valid JSON deserves a visible warning rather than an empty list.
fn json_parse_warning(base: &Base, path: &Path, limit: u64) -> Option<String> {
    let text = base.read(path, limit).ok().flatten()?;

    serde_json::from_str::<Value>(&text)
        .is_err()
        .then(|| format!("{}: không phải JSON hợp lệ", base.display(path)))
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

fn hooks(bases: &[Base]) -> Listing<HookEntry> {
    let mut listing = Listing::new();

    for base in bases {
        for file in [".claude/settings.json", ".claude/settings.local.json"] {
            let path = base.root.join(file);
            let display = base.display(&path);

            match base.read(&path, MAX_FILE_BYTES) {
                Ok(Some(text)) => match serde_json::from_str::<Value>(&text) {
                    Ok(value) => hooks_from_json(&value, base, &display, &mut listing.items),
                    Err(_) => listing
                        .warnings
                        .push(format!("{display}: không phải JSON hợp lệ")),
                },
                Ok(None) => {}
                Err(warning) => listing.warnings.push(warning),
            }
        }
    }

    listing
}

// ---------- commands ----------

/// `project_root` is the open project's folder; it is checked like any workspace root. Without it only the machine's own configuration is listed.
#[tauri::command]
pub fn tools_skills(project_root: Option<String>) -> Listing<ToolEntry> {
    skills(&bases(project_root.as_deref(), home_folder().as_deref()))
}

#[tauri::command]
pub fn tools_agents(project_root: Option<String>) -> Listing<ToolEntry> {
    agents(&bases(project_root.as_deref(), home_folder().as_deref()))
}

#[tauri::command]
pub fn tools_mcp(project_root: Option<String>) -> Listing<McpServer> {
    mcp(&bases(project_root.as_deref(), home_folder().as_deref()))
}

#[tauri::command]
pub fn tools_rules(project_root: Option<String>) -> Listing<RuleFile> {
    rules(&bases(project_root.as_deref(), home_folder().as_deref()))
}

#[tauri::command]
pub fn tools_hooks(project_root: Option<String>) -> Listing<HookEntry> {
    hooks(&bases(project_root.as_deref(), home_folder().as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn setup_pair() -> (tempfile::TempDir, tempfile::TempDir) {
        (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap())
    }

    fn pair_bases(project: &tempfile::TempDir, home: &tempfile::TempDir) -> Vec<Base> {
        bases(project.path().to_str(), Some(home.path()))
    }

    #[test]
    fn front_matter_reads_plain_folded_and_list_values() {
        let meta = front_matter("---\nname: \"demo\"\ndescription: >\n  one\n  two\ntools:\n  - Read\n  - Bash\nmodel: opus\n---\nbody");

        assert_eq!(meta.name.as_deref(), Some("demo"));
        assert_eq!(meta.description.as_deref(), Some("one two"));
        assert_eq!(meta.tools.as_deref(), Some("Read, Bash"));
        assert_eq!(meta.model.as_deref(), Some("opus"));
    }

    #[test]
    fn skills_come_from_project_and_home_without_duplicates() {
        let (project, home) = setup_pair();

        write(
            project.path(),
            ".claude/skills/a/SKILL.md",
            "---\nname: alpha\ndescription: first\n---\n",
        );
        write(home.path(), ".agents/skills/b/SKILL.md", "no front matter");

        let listing = skills(&pair_bases(&project, &home));
        let names: Vec<_> = listing
            .items
            .iter()
            .map(|item| (item.name.as_str(), item.scope))
            .collect();

        assert_eq!(names, [("alpha", Scope::Project), ("b", Scope::Machine)]);
        assert_eq!(listing.items[1].path, "~/.agents/skills/b/SKILL.md");
        assert_eq!(
            listing.items[0].relative_path.as_deref(),
            Some(".claude/skills/a/SKILL.md")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_leaving_the_base_is_refused_but_inside_is_followed() {
        let (project, home) = setup_pair();
        let outside = tempfile::tempdir().unwrap();

        write(outside.path(), "SKILL.md", "---\nname: leaked\n---\n");
        write(
            home.path(),
            ".agents/skills/real/SKILL.md",
            "---\nname: real\n---\n",
        );
        fs::create_dir_all(project.path().join(".claude/skills")).unwrap();
        std::os::unix::fs::symlink(outside.path(), project.path().join(".claude/skills/evil"))
            .unwrap();
        fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::os::unix::fs::symlink(
            home.path().join(".agents/skills"),
            home.path().join(".claude/skills"),
        )
        .unwrap();

        let listing = skills(&pair_bases(&project, &home));

        assert_eq!(listing.items.len(), 1);
        assert_eq!(listing.items[0].name, "real");
    }

    #[test]
    fn oversized_file_is_reported_as_warning() {
        let (project, home) = setup_pair();

        write(
            project.path(),
            "AGENTS.md",
            &"x".repeat(MAX_FILE_BYTES as usize + 1),
        );

        let listing = rules(&pair_bases(&project, &home));

        assert!(listing.items.is_empty());
        assert_eq!(listing.warnings.len(), 1);
    }

    #[test]
    fn agents_read_markdown_and_toml() {
        let (project, home) = setup_pair();

        write(
            project.path(),
            ".claude/agents/coder.md",
            "---\nname: coder\ndescription: writes\nmodel: sonnet\ntools: Read, Edit\n---\n",
        );
        write(
            home.path(),
            ".codex/agents/rev.toml",
            "name = \"rev\"\nmodel = \"gpt\"\n[x]\nname = \"no\"\n",
        );

        let listing = agents(&pair_bases(&project, &home));

        assert_eq!(listing.items[0].tools.as_deref(), Some("Read, Edit"));
        assert_eq!(listing.items[1].name, "rev");
        assert_eq!(listing.items[1].model.as_deref(), Some("gpt"));
    }

    #[test]
    fn mcp_never_returns_secrets() {
        let (project, home) = setup_pair();
        let root = fs::canonicalize(project.path()).unwrap();

        write(
            project.path(),
            ".mcp.json",
            r#"{"mcpServers":{"a":{"command":"npx","args":["--token","SECRET1"],"env":{"K":"SECRET2"}},"b":{"type":"http","url":"https://u:SECRET3@h.dev/x?key=SECRET4","headers":{"A":"SECRET5"}}}}"#,
        );
        write(
            home.path(),
            ".claude.json",
            &format!(
                r#"{{"mcpServers":{{"g":{{"command":"g"}}}},"projects":{{"{}":{{"mcpServers":{{"p":{{"command":"p"}}}}}}}}}}"#,
                root.display()
            ),
        );
        write(home.path(), ".codex/config.toml", "[mcp_servers.c]\ncommand = \"codex-mcp\"\n[mcp_servers.c.env]\nTOKEN = \"SECRET6\"\n[mcp_servers.w]\nurl = \"https://x.dev/y?t=SECRET7\"\n");

        let listing = mcp(&pair_bases(&project, &home));
        let json = serde_json::to_string(&listing).unwrap();
        let names: Vec<_> = listing
            .items
            .iter()
            .map(|item| item.name.as_str())
            .collect();

        assert_eq!(names, ["a", "b", "g", "p", "c", "w"]);
        assert!(!json.contains("SECRET"));
        assert_eq!(listing.items[1].target, "https://h.dev/x");
    }

    #[test]
    fn hooks_are_listed_and_broken_json_warns() {
        let (project, home) = setup_pair();

        write(
            project.path(),
            ".claude/settings.json",
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo hi"}]}]}}"#,
        );
        write(home.path(), ".claude/settings.json", "{ broken");

        let listing = hooks(&pair_bases(&project, &home));

        assert_eq!(listing.items.len(), 1);
        assert_eq!(listing.items[0].event, "PreToolUse");
        assert_eq!(listing.items[0].command, "echo hi");
        assert_eq!(listing.warnings.len(), 1);
    }

    #[test]
    fn without_a_project_only_the_machine_is_listed() {
        let home = tempfile::tempdir().unwrap();

        write(
            home.path(),
            ".claude/CLAUDE.md",
            "---\nx: y\n---\n# Title\nbody",
        );

        let listing = rules(&bases(None, Some(home.path())));

        assert_eq!(listing.items.len(), 1);
        assert_eq!(listing.items[0].excerpt, "# Title body");
    }
}
