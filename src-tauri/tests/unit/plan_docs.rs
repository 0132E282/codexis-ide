use super::*;
use std::fs;
use tempfile::TempDir;

fn project() -> (TempDir, Workspace) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();

    fs::create_dir_all(dir.path().join("docs/plans")).unwrap();

    (dir, workspace)
}

fn put(dir: &TempDir, name: &str, content: &str) {
    fs::write(dir.path().join("docs/plans").join(name), content).unwrap();
}

#[test]
fn missing_folder_is_an_empty_list() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();

    let result = list(&workspace);

    assert!(result.plans.is_empty());
    assert_eq!(result.skipped, 0);
    assert!(!result.root.is_empty());
}

#[test]
fn json_plan_reads_top_fields_and_counts_tasks() {
    let (dir, workspace) = project();

    put(
        &dir,
        "a-20261106.json",
        r#"{"title":"Alpha","description":"First","tags":["x","y"],"createdAt":"2026-11-06",
        "status":"DRAFT_CHO_DUYET",
        "tasks":[{"id":"1","status":"DONE"},{"id":"2","status":"TODO"}]}"#,
    );

    let result = list(&workspace);
    let plan = &result.plans[0];

    assert_eq!(result.skipped, 0);
    assert_eq!(plan.id, "docs/plans/a-20261106.json");
    assert_eq!(plan.title, "Alpha");
    assert_eq!(plan.tags, vec!["x", "y"]);
    assert_eq!(plan.status, PlanStatus::Draft);
    assert_eq!(plan.raw_status.as_deref(), Some("DRAFT_CHO_DUYET"));
    assert_eq!((plan.tasks_done, plan.tasks_total), (1, 2));
    assert_eq!(plan.format, PlanFormat::Json);
}

#[test]
fn json_without_status_is_inferred_from_tasks() {
    let (dir, workspace) = project();

    put(
        &dir,
        "done.json",
        r#"{"title":"D","tasks":[{"status":"DONE"},{"status":"DONE"}]}"#,
    );
    put(
        &dir,
        "todo.json",
        r#"{"title":"T","tasks":[{"status":"TODO"}]}"#,
    );
    put(
        &dir,
        "going.json",
        r#"{"title":"G","tasks":[{"status":"DONE"},{"status":"TODO"}]}"#,
    );
    put(&dir, "none.json", r#"{"title":"N"}"#);

    let by_title = |title: &str| {
        list(&workspace)
            .plans
            .into_iter()
            .find(|plan| plan.title == title)
            .unwrap()
            .status
    };

    assert_eq!(by_title("D"), PlanStatus::Done);
    assert_eq!(by_title("T"), PlanStatus::Todo);
    assert_eq!(by_title("G"), PlanStatus::InProgress);
    assert_eq!(by_title("N"), PlanStatus::Unknown);
}

#[test]
fn json_wrapped_in_content_and_groups_are_read() {
    let (dir, workspace) = project();

    put(
        &dir,
        "w.json",
        r#"{"title":"W","content":{"meta":{"status":"IN_PROGRESS"},
        "groups":[{"tasks":[{"status":"DONE"}]},{"tasks":[{"status":"TODO"}]}],
        "tasks":[{"status":"DONE"}]}}"#,
    );

    let plan = &list(&workspace).plans[0];

    assert_eq!(plan.status, PlanStatus::InProgress);
    assert_eq!((plan.tasks_done, plan.tasks_total), (2, 3));
}

#[test]
fn status_words_are_normalised() {
    for (word, expected) in [
        ("DONE", PlanStatus::Done),
        ("in-progress", PlanStatus::InProgress),
        ("PARTIAL", PlanStatus::Partial),
        ("TODO", PlanStatus::Todo),
        ("DRAFT", PlanStatus::Draft),
        ("DRAFT_CHO_DUYET", PlanStatus::Draft),
        ("CHO_DUYET", PlanStatus::Draft),
        ("CHO_KIEM_TRA", PlanStatus::Review),
        ("DA_TRIEN_KHAI_CHUA_KIEM_UI", PlanStatus::Partial),
        ("BLOCKED", PlanStatus::Unknown),
    ] {
        assert_eq!(PlanStatus::from_word(word), expected, "{word}");
    }
}

#[test]
fn markdown_reads_title_description_front_matter_and_checklist() {
    let (dir, workspace) = project();

    put(
        &dir,
        "m.md",
        "---\nstatus: partial\ntags: [a, \"b\"]\ncreatedAt: 2026-11-05\n---\n# Plan M\n\nFirst line\nsecond line.\n\nOther paragraph.\n\n- [x] one\n- [ ] two\n```\n- [x] ignored\n```\n",
    );
    put(&dir, "c.md", "# Checked\n\n- [x] a\n- [X] b\n");

    let result = list(&workspace);
    let m = result
        .plans
        .iter()
        .find(|plan| plan.title == "Plan M")
        .unwrap();
    let checked = result
        .plans
        .iter()
        .find(|plan| plan.title == "Checked")
        .unwrap();

    assert_eq!(m.description, "First line second line.");
    assert_eq!(m.tags, vec!["a", "b"]);
    assert_eq!(m.status, PlanStatus::Partial);
    assert_eq!(m.created_at.as_deref(), Some("2026-11-05"));
    assert_eq!((m.tasks_done, m.tasks_total), (1, 2));
    assert_eq!(m.format, PlanFormat::Md);
    assert_eq!(checked.status, PlanStatus::Done);
    assert_eq!(checked.description, "");
}

#[test]
fn json_wins_over_markdown_with_the_same_name() {
    let (dir, workspace) = project();

    put(&dir, "p.json", r#"{"title":"Json one","status":"DONE"}"#);
    put(&dir, "p.md", "# Md one\n");

    let result = list(&workspace);

    assert_eq!(result.plans.len(), 1);
    assert_eq!(result.plans[0].title, "Json one");
    assert!(result.plans[0].has_markdown);
}

#[test]
fn broken_oversized_and_foreign_files_are_skipped_or_ignored() {
    let (dir, workspace) = project();

    put(&dir, "ok.json", r#"{"title":"Ok"}"#);
    put(&dir, "broken.json", "{not json");
    put(&dir, "array.json", "[1,2]");
    put(&dir, "notes.txt", "x");
    put(
        &dir,
        "big.json",
        &format!(r#"{{"title":"Big","pad":"{}"}}"#, "a".repeat(2_100_000)),
    );
    fs::create_dir(dir.path().join("docs/plans/sub")).unwrap();
    put(&dir, "sub/deep.json", "{}");

    let result = list(&workspace);

    assert_eq!(result.plans.len(), 1);
    assert_eq!(result.skipped, 3);
}

#[test]
fn index_json_is_a_fallback_not_a_card() {
    let (dir, workspace) = project();

    put(&dir, "a.json", r#"{"status":"DONE"}"#);
    put(
        &dir,
        "index.json",
        r#"[{"title":"From index","description":"Desc","tags":["t"],"path":"docs/plans/a.json"}]"#,
    );

    let result = list(&workspace);

    assert_eq!(result.plans.len(), 1);
    assert_eq!(result.plans[0].title, "From index");
    assert_eq!(result.plans[0].description, "Desc");
    assert_eq!(result.plans[0].tags, vec!["t"]);
}

#[test]
fn newest_first_and_capped_at_the_file_limit() {
    let (dir, workspace) = project();

    put(
        &dir,
        "old.json",
        r#"{"title":"Old","createdAt":"2026-01-01"}"#,
    );
    put(
        &dir,
        "new.json",
        r#"{"title":"New","createdAt":"2026-12-01"}"#,
    );

    let titles: Vec<String> = list(&workspace)
        .plans
        .into_iter()
        .map(|plan| plan.title)
        .collect();

    assert_eq!(titles, vec!["New", "Old"]);

    for number in 0..MAX_FILES {
        put(&dir, &format!("f{number:03}.json"), "{}");
    }

    let result = list(&workspace);

    assert!(result.truncated);
    assert_eq!(result.plans.len() + result.skipped, MAX_FILES);
}

#[cfg(unix)]
#[test]
fn links_leaving_the_project_are_skipped() {
    use std::os::unix::fs::symlink;

    let (dir, workspace) = project();
    let outside = tempfile::tempdir().unwrap();

    fs::write(outside.path().join("evil.json"), r#"{"title":"Evil"}"#).unwrap();
    symlink(
        outside.path().join("evil.json"),
        dir.path().join("docs/plans/evil.json"),
    )
    .unwrap();
    put(&dir, "ok.json", r#"{"title":"Ok"}"#);

    let result = list(&workspace);

    assert_eq!(result.plans.len(), 1);
    assert_eq!(result.plans[0].title, "Ok");
    assert_eq!(result.skipped, 1);
}

#[cfg(unix)]
#[test]
fn a_plans_folder_that_is_a_link_out_is_empty() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();
    let outside = tempfile::tempdir().unwrap();

    fs::write(outside.path().join("x.json"), r#"{"title":"X"}"#).unwrap();
    fs::create_dir(dir.path().join("docs")).unwrap();
    symlink(outside.path(), dir.path().join("docs/plans")).unwrap();

    let result = list(&workspace);

    assert!(result.plans.is_empty());
    assert_eq!(result.skipped, 0);
    assert!(!result.root.is_empty());
}

#[test]
fn the_real_plans_of_this_repository_parse() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let Ok(workspace) = Workspace::open(&root) else {
        return;
    };
    let result = list(&workspace);

    for plan in &result.plans {
        eprintln!(
            "{:?} {:?} {}/{} {:?} {}",
            plan.status,
            plan.raw_status,
            plan.tasks_done,
            plan.tasks_total,
            plan.created_at,
            plan.id
        );
    }

    eprintln!("skipped {} total {}", result.skipped, result.plans.len());
    assert_eq!(result.skipped, 0);
}

#[test]
fn detail_of_a_json_plan_has_sections_tasks_and_files() {
    let (dir, workspace) = project();

    put(
        &dir,
        "d.json",
        r#"{"title":"D","status":"IN_PROGRESS",
        "requirements":[{"id":"REQ-1","source":"user","text":"Do it"}],
        "acceptanceCriteria":[{"id":"AC-1","requirement":"REQ-1","text":"Works"}],
        "openQuestions":[{"id":"Q1","question":"Why?","default":"Because"},"Plain question"],
        "tasks":[{"id":"T1","title":"One","status":"DONE","priority":"P0",
          "filesToChange":[{"path":"a.rs","changes":"x"},"b.rs"]}]}"#,
    );

    let detail = read(&workspace, "docs/plans/d.json").unwrap();

    assert_eq!(detail.summary.title, "D");
    assert_eq!(detail.requirements[0].id.as_deref(), Some("REQ-1"));
    assert_eq!(detail.requirements[0].note.as_deref(), Some("user"));
    assert_eq!(detail.acceptance_criteria[0].text, "Works");
    assert_eq!(detail.open_questions.len(), 2);
    assert_eq!(detail.open_questions[1].text, "Plain question");
    assert_eq!(detail.tasks[0].status, PlanStatus::Done);
    assert_eq!(detail.tasks[0].files, vec!["a.rs", "b.rs"]);
    assert_eq!(detail.tasks[0].priority.as_deref(), Some("P0"));
}

#[test]
fn detail_of_a_markdown_plan_has_blocks() {
    let (dir, workspace) = project();

    put(
        &dir,
        "m.md",
        "---\nstatus: done\n---\n# T\n\nSome\ntext.\n\n- item\n- [x] done\n- [ ] open\n\n```\ncode\n```\n## Sub\n",
    );

    let blocks = read(&workspace, "docs/plans/m.md").unwrap().blocks;

    assert_eq!(
        blocks,
        vec![
            MarkdownBlock::Heading {
                level: 1,
                text: "T".into()
            },
            MarkdownBlock::Paragraph {
                text: "Some text.".into()
            },
            MarkdownBlock::Bullet {
                text: "item".into()
            },
            MarkdownBlock::Checklist {
                text: "done".into(),
                checked: true
            },
            MarkdownBlock::Checklist {
                text: "open".into(),
                checked: false
            },
            MarkdownBlock::Code {
                text: "code".into()
            },
            MarkdownBlock::Heading {
                level: 2,
                text: "Sub".into()
            },
        ]
    );
}

#[test]
fn detail_refuses_other_paths_and_missing_files() {
    let (dir, workspace) = project();

    put(&dir, "ok.json", "{}");
    put(&dir, "index.json", "[]");

    for path in [
        "../secret.json",
        "docs/plans/../../x.json",
        "src/main.rs",
        "docs/plans/index.json",
        "docs/plans/sub/a.json",
        "docs/plans/a.txt",
        "/etc/passwd",
    ] {
        assert_eq!(
            read(&workspace, path).unwrap_err(),
            "plan_docs.bad_path",
            "{path}"
        );
    }

    assert_eq!(
        read(&workspace, "docs/plans/none.json").unwrap_err(),
        "plan_docs.not_found"
    );
    assert!(read(&workspace, "docs/plans/ok.json").is_ok());
}

#[cfg(unix)]
#[test]
fn detail_refuses_a_link_leaving_the_project() {
    use std::os::unix::fs::symlink;

    let (dir, workspace) = project();
    let outside = tempfile::tempdir().unwrap();

    fs::write(outside.path().join("e.json"), "{}").unwrap();
    symlink(
        outside.path().join("e.json"),
        dir.path().join("docs/plans/e.json"),
    )
    .unwrap();

    assert_eq!(
        read(&workspace, "docs/plans/e.json").unwrap_err(),
        "plan_docs.not_found"
    );
}

#[test]
fn fingerprint_of_a_missing_folder_is_empty() {
    let dir = tempfile::tempdir().unwrap();

    assert!(fingerprint(&dir.path().join("docs/plans")).is_empty());
}

#[test]
fn fingerprint_changes_when_a_plan_is_added_edited_or_removed() {
    let (dir, _workspace) = project();
    let folder = dir.path().join("docs/plans");
    let empty = fingerprint(&folder);

    put(&dir, "a.json", "{}");
    let added = fingerprint(&folder);
    assert_ne!(empty, added);
    assert_eq!(added, fingerprint(&folder));

    put(&dir, "a.json", "{\"status\":\"DONE\"}");
    let edited = fingerprint(&folder);
    assert_ne!(added, edited);

    put(&dir, "notes.txt", "ignored");
    assert_eq!(edited, fingerprint(&folder));

    fs::remove_file(folder.join("a.json")).unwrap();
    assert_eq!(empty, fingerprint(&folder));
}
