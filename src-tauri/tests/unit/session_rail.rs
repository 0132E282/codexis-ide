use super::*;
use std::path::Path;

fn steps(items: &[(&str, &str)]) -> String {
    let list: Vec<Value> = items
        .iter()
        .map(|(name, input)| serde_json::json!({ "kind": "tool", "id": "x", "name": name, "input": input }))
        .collect();

    Value::Array(list).to_string()
}

fn always(_: &str) -> bool {
    true
}

#[test]
fn outputs_keep_written_files_once_most_recent_first() {
    let root = Path::new("/work/app");
    let turns = vec![
        steps(&[
            ("Write", "/work/app/src/a.rs"),
            ("Bash", "ls"),
            ("Edit", "src/b.rs"),
        ]),
        steps(&[("Edit", "/work/app/src/a.rs")]),
    ];
    let files = output_files(&turns, root, always);

    assert_eq!(
        files,
        vec![
            OutputFile {
                path: "src/a.rs".into(),
                tool: "Edit".into()
            },
            OutputFile {
                path: "src/b.rs".into(),
                tool: "Edit".into()
            },
        ]
    );
}

#[test]
fn outputs_drop_outside_hidden_and_missing_files() {
    let root = Path::new("/work/app");
    let turns = vec![steps(&[
        ("Write", "/etc/passwd"),
        ("Write", "../escape.txt"),
        ("Write", "/work/app/.git/config"),
        ("Write", "/work/app/gone.txt"),
        ("Read", "/work/app/read.txt"),
        ("Write", "keep.txt"),
    ])];
    let files = output_files(&turns, root, |path| path != "gone.txt");

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "keep.txt");
}

#[test]
fn outputs_skip_turns_that_are_not_valid_steps() {
    let root = Path::new("/work/app");
    let turns = vec![
        "not json".to_string(),
        "{}".to_string(),
        steps(&[("Write", "a.txt")]),
    ];

    assert_eq!(output_files(&turns, root, always).len(), 1);
}

#[test]
fn outputs_are_capped() {
    let root = Path::new("/work/app");
    let many: Vec<(String, &str)> = (0..MAX_OUTPUTS + 20)
        .map(|index| (format!("f{index}.txt"), "Write"))
        .collect();
    let items: Vec<(&str, &str)> = many
        .iter()
        .map(|(path, tool)| (*tool, path.as_str()))
        .collect();

    assert_eq!(
        output_files(&[steps(&items)], root, always).len(),
        MAX_OUTPUTS
    );
}

#[test]
fn home_is_written_as_a_tilde() {
    let home = Path::new("/Users/me");

    assert_eq!(
        shorten_home(Path::new("/Users/me/code/app"), Some(home)),
        "~/code/app"
    );
    assert_eq!(shorten_home(Path::new("/Users/me"), Some(home)), "~");
    assert_eq!(shorten_home(Path::new("/srv/app"), Some(home)), "/srv/app");
    assert_eq!(shorten_home(Path::new("/srv/app"), None), "/srv/app");
}

#[test]
fn github_remote_forms_are_read_and_credentials_dropped() {
    let expected = Some(RepoRef {
        owner: "octo".into(),
        name: "app.js".into(),
        url: "https://github.com/octo/app.js".into(),
    });

    for url in [
        "https://github.com/octo/app.js.git",
        "https://github.com/octo/app.js",
        "https://user:secret@github.com/octo/app.js.git",
        "git@github.com:octo/app.js.git",
        "ssh://git@github.com/octo/app.js.git",
        "https://github.com/octo/app.js/\n",
    ] {
        assert_eq!(parse_github_remote(url), expected, "{url}");
    }
}

#[test]
fn other_hosts_and_odd_urls_are_not_github_repos() {
    for url in [
        "https://gitlab.com/octo/app.git",
        "https://github.com.evil.io/octo/app.git",
        "git@github.com:octo",
        "https://github.com/octo/../app",
        "https://github.com/octo/app name",
        "/local/path/repo",
        "",
    ] {
        assert_eq!(parse_github_remote(url), None, "{url}");
    }
}

#[test]
fn pull_request_is_the_first_of_the_list_with_a_github_link() {
    let json = r#"[{"number":7,"title":"Add rail","url":"https://github.com/o/r/pull/7"}]"#;

    assert_eq!(
        parse_pull_request(json),
        Some(PullRequest {
            number: 7,
            title: "Add rail".into(),
            url: "https://github.com/o/r/pull/7".into()
        })
    );
    assert_eq!(parse_pull_request("[]"), None);
    assert_eq!(parse_pull_request("nope"), None);
    assert_eq!(
        parse_pull_request(r#"[{"number":1,"title":"x","url":"https://evil.example/p/1"}]"#),
        None
    );
}

#[test]
fn tokens_are_estimated_from_characters_and_never_negative() {
    assert_eq!(estimate_tokens(0), 0);
    assert_eq!(estimate_tokens(7), 1);
    assert_eq!(estimate_tokens(4_000), 1_000);
    assert_eq!(estimate_tokens(-5), 0);
}
