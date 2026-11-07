use super::*;
use crate::plan::{StoredPlan, Todo, TodoStatus};
use std::fs;

// 2026-11-07
const SAMPLE: i64 = 1_794_046_830;

fn markdown(text: &str) -> StoredPlan {
    StoredPlan {
        todos: vec![],
        markdown: Some(text.into()),
    }
}

fn workspace(folder: &tempfile::TempDir) -> Workspace {
    Workspace::open(folder.path()).unwrap()
}

#[test]
fn slugs_are_plain_ascii() {
    assert_eq!(
        slug_of("Kế hoạch: Thêm đăng nhập!"),
        "ke-hoach-them-dang-nhap"
    );
    assert_eq!(slug_of("  --  "), "plan");
    assert_eq!(slug_of("A/B  c"), "a-b-c");
    assert!(slug_of(&"x".repeat(200)).len() <= 60);
    assert_eq!(day_stamp(SAMPLE), "20261107");
}

#[test]
fn plans_folder_must_be_a_plain_relative_path() {
    assert_eq!(checked_plans_dir(""), Some("docs/plans".into()));
    assert_eq!(checked_plans_dir("docs/plans/"), Some("docs/plans".into()));
    assert_eq!(checked_plans_dir("notes"), Some("notes".into()));

    for bad in [
        "../outside",
        "a/../../b",
        "/etc",
        "C:/x",
        ".git/plans",
        "a\0b",
        "docs/../..",
    ] {
        assert_eq!(checked_plans_dir(bad), None, "{bad}");
    }
}

#[test]
fn a_markdown_plan_is_written_into_a_new_folder() {
    let folder = tempfile::tempdir().unwrap();
    let saved = save(
        &workspace(&folder),
        "docs/plans",
        &markdown("# Thêm đăng nhập\n\nNội dung"),
        SAMPLE,
    )
    .unwrap();

    assert_eq!(saved.path, "docs/plans/them-dang-nhap-20261107.md");
    assert_eq!(
        (saved.format, saved.title.as_str(), saved.status),
        ("md", "Thêm đăng nhập", "draft")
    );

    let text = fs::read_to_string(folder.path().join(&saved.path)).unwrap();

    assert!(text.starts_with("# Thêm đăng nhập") && text.ends_with('\n'));
}

#[test]
fn an_existing_file_is_never_overwritten() {
    let folder = tempfile::tempdir().unwrap();
    let plans = folder.path().join("docs/plans");

    fs::create_dir_all(&plans).unwrap();
    fs::write(plans.join("a-20261107.md"), "mine").unwrap();

    let workspace = workspace(&folder);
    let second = save(&workspace, "docs/plans", &markdown("# A"), SAMPLE).unwrap();
    let third = save(&workspace, "docs/plans", &markdown("# A"), SAMPLE).unwrap();

    assert_eq!(second.path, "docs/plans/a-20261107-2.md");
    assert_eq!(third.path, "docs/plans/a-20261107-3.md");
    assert_eq!(
        fs::read_to_string(plans.join("a-20261107.md")).unwrap(),
        "mine"
    );
}

#[test]
fn tasks_become_a_checklist_or_a_json_plan() {
    let folder = tempfile::tempdir().unwrap();
    let workspace = workspace(&folder);
    let todos = vec![
        Todo {
            content: "một".into(),
            status: TodoStatus::Completed,
        },
        Todo {
            content: "hai".into(),
            status: TodoStatus::Pending,
        },
    ];
    let with_text = save(
        &workspace,
        "plans",
        &StoredPlan {
            todos: todos.clone(),
            markdown: Some("# Có việc".into()),
        },
        SAMPLE,
    )
    .unwrap();
    let text = fs::read_to_string(folder.path().join(&with_text.path)).unwrap();

    assert!(text.contains("- [x] một") && text.contains("- [ ] hai"));
    assert_eq!(
        (
            with_text.tasks_total,
            with_text.tasks_done,
            with_text.status
        ),
        (2, 1, "in_progress")
    );

    let only_tasks = save(
        &workspace,
        "plans",
        &StoredPlan {
            todos,
            markdown: None,
        },
        SAMPLE,
    )
    .unwrap();

    assert_eq!(only_tasks.path, "plans/plan-20261107-20261107.json");
    assert_eq!(only_tasks.format, "json");

    let value: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(folder.path().join(&only_tasks.path)).unwrap())
            .unwrap();

    assert_eq!(value["tasks"][0]["status"], "done");
    assert_eq!(value["createdAt"], "2026-11-07");
}

#[test]
fn nothing_is_written_for_an_empty_plan_or_a_bad_folder() {
    let folder = tempfile::tempdir().unwrap();
    let workspace = workspace(&folder);

    assert_eq!(
        save(&workspace, "docs/plans", &StoredPlan::default(), SAMPLE),
        Err(PlanSaveError::Empty)
    );
    assert_eq!(
        save(&workspace, "../escape", &markdown("# x"), SAMPLE),
        Err(PlanSaveError::BadDirectory)
    );
    assert_eq!(
        save(&workspace, "/abs", &markdown("# x"), SAMPLE),
        Err(PlanSaveError::BadDirectory)
    );
    assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 0);
}
