use super::*;

fn write(root: &Path, relative: &str, content: &str) {
    let path = root.join(relative);

    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn setup_pair() -> (tempfile::TempDir, tempfile::TempDir) {
    (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap())
}

fn pair_bases(project: &tempfile::TempDir, home: &tempfile::TempDir) -> ToolScanner {
    ToolScanner::new(project.path().to_str(), Some(home.path()))
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

    let listing = pair_bases(&project, &home).skills();
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
    std::os::unix::fs::symlink(outside.path(), project.path().join(".claude/skills/evil")).unwrap();
    fs::create_dir_all(home.path().join(".claude")).unwrap();
    std::os::unix::fs::symlink(
        home.path().join(".agents/skills"),
        home.path().join(".claude/skills"),
    )
    .unwrap();

    let listing = pair_bases(&project, &home).skills();

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

    let listing = pair_bases(&project, &home).rules();

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

    let listing = pair_bases(&project, &home).agents();

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

    let listing = pair_bases(&project, &home).mcp();
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

    let listing = pair_bases(&project, &home).hooks();

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

    let listing = ToolScanner::new(None, Some(home.path())).rules();

    assert_eq!(listing.items.len(), 1);
    assert_eq!(listing.items[0].excerpt, "# Title body");
}

#[test]
fn a_root_outside_the_known_projects_gives_no_project_entries() {
    let data = tempfile::tempdir().unwrap();
    let stranger = tempfile::tempdir().unwrap();
    let database = data.path().join("app.db");
    let state = AppState::new(
        crate::projects::ProjectStore::load(database.clone()),
        crate::chats::ChatStore::open(database),
    );

    write(stranger.path(), ".claude/CLAUDE.md", "# Secret rule");

    assert!(allowed_project(&state, None).is_none());
    assert!(allowed_project(&state, stranger.path().to_str()).is_none());
}
