use super::*;

#[test]
fn parse_knows_every_cli() {
    assert_eq!(CliKind::parse("claude"), Some(CliKind::Claude));
    assert_eq!(CliKind::parse("codex"), Some(CliKind::Codex));
    assert_eq!(CliKind::parse("gemini"), Some(CliKind::Gemini));
    assert_eq!(CliKind::parse("antigravity"), Some(CliKind::Antigravity));
    assert_eq!(CliKind::parse("github"), Some(CliKind::Github));
    assert_eq!(CliKind::parse("gh"), None);
    assert_eq!(CliKind::parse(""), None);
}

#[test]
fn parse_agent_rejects_github() {
    assert_eq!(CliKind::parse_agent("claude"), Some(CliKind::Claude));
    assert_eq!(CliKind::parse_agent("codex"), Some(CliKind::Codex));
    assert_eq!(CliKind::parse_agent("gemini"), None);
    assert_eq!(CliKind::parse_agent("github"), None);
}

#[test]
fn lists_keep_their_order() {
    assert_eq!(
        CliKind::ALL,
        [
            CliKind::Claude,
            CliKind::Codex,
            CliKind::Gemini,
            CliKind::Antigravity,
            CliKind::Github
        ]
    );
    assert_eq!(
        CliKind::AGENTS,
        [CliKind::Claude, CliKind::Codex, CliKind::Antigravity]
    );
}

#[test]
fn names_programs_and_variables_match_the_old_tables() {
    let rows: Vec<_> = CliKind::ALL
        .into_iter()
        .map(|kind| (kind.name(), kind.program(), kind.config_variable()))
        .collect();
    assert_eq!(
        rows,
        [
            ("claude", "claude", "CLAUDE_CONFIG_DIR"),
            ("codex", "codex", "CODEX_HOME"),
            ("gemini", "gemini", "GEMINI_CLI_HOME"),
            ("antigravity", "agy", "HOME"),
            ("github", "gh", "GH_CONFIG_DIR"),
        ]
    );
}

#[test]
fn command_sets_the_environment_without_stdin() {
    let environment = vec![("CODEX_HOME", "/tmp/profile".to_string())];
    let command = command(Path::new("codex"), &environment);
    let value = command
        .get_envs()
        .find(|(name, _)| *name == "CODEX_HOME")
        .and_then(|(_, value)| value);
    assert_eq!(value, Some(std::ffi::OsStr::new("/tmp/profile")));
}

#[test]
fn locate_finds_nothing_for_a_missing_program() {
    assert_eq!(locate("rynox-no-such-program"), None);
}
