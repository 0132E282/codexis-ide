use super::*;
use crate::db;
use crate::workspace::Workspace;
use serde_json::json;
use std::fs;

const ROOT: &str = "/work/app";
const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];

fn store() -> ActivityStore {
    ActivityStore::new(db::in_memory()).expect("store")
}

fn event(path: &str, action: FileAction) -> NewFileEvent {
    NewFileEvent::user(ROOT, path, action)
}

fn png(extra: u8, size: usize) -> Vec<u8> {
    let mut bytes = PNG.to_vec();

    bytes.resize(size, extra);
    bytes
}

#[test]
fn migration_runs_twice_and_keeps_rows() {
    let connection = Connection::open_in_memory().unwrap();

    connection
        .execute_batch(migrations::CREATE_ACTIVITY_TABLES)
        .unwrap();
    connection
        .execute(
            "INSERT INTO file_events (project_root, path, action, source, created_at) VALUES ('r', 'a', 'save', 'user', 1)",
            [],
        )
        .unwrap();
    connection
        .execute_batch(migrations::CREATE_ACTIVITY_TABLES)
        .unwrap();

    let rows: i64 = connection
        .query_row("SELECT COUNT(*) FROM file_events", [], |row| row.get(0))
        .unwrap();

    assert_eq!(rows, 1);
}

#[test]
fn the_schema_refuses_unknown_actions() {
    let connection = Connection::open_in_memory().unwrap();

    connection
        .execute_batch(migrations::CREATE_ACTIVITY_TABLES)
        .unwrap();

    assert!(connection
        .execute(
            "INSERT INTO file_events (project_root, path, action, source, created_at) VALUES ('r', 'a', 'explode', 'user', 1)",
            [],
        )
        .is_err());
}

#[test]
fn file_events_are_filtered_paged_and_newest_first() {
    let store = store();

    for (index, (path, action)) in [
        ("src/a.rs", FileAction::Save),
        ("src/b.rs", FileAction::Create),
        ("docs/c_d.md", FileAction::Save),
        ("docs/e.md", FileAction::Rename),
    ]
    .into_iter()
    .enumerate()
    {
        store
            .record_file_event_at(&event(path, action), 100 + i64::try_from(index).unwrap())
            .unwrap();
    }
    store
        .record_file_event_at(&NewFileEvent::ai_edit(ROOT, "src/a.rs"), 200)
        .unwrap();
    store
        .record_file_event_at(
            &NewFileEvent::user("/other", "src/a.rs", FileAction::Save),
            300,
        )
        .unwrap();

    let all = store
        .list_file_events(ROOT, &FileEventFilter::default(), 100, 0)
        .unwrap();

    assert_eq!(all.total, 5);
    assert_eq!(all.items[0].action, "ai_edit");
    assert_eq!(all.items[0].source, "ai");
    assert_eq!(all.items[0].lines_added, None);

    let page = store
        .list_file_events(ROOT, &FileEventFilter::default(), 2, 1)
        .unwrap();

    assert_eq!((page.items.len(), page.total), (2, 5));
    assert_eq!(page.items[0].path, "docs/e.md");

    let saved = FileEventFilter {
        action: Some("save".into()),
        ..FileEventFilter::default()
    };

    assert_eq!(
        store.list_file_events(ROOT, &saved, 100, 0).unwrap().total,
        2
    );

    let docs = FileEventFilter {
        path: Some("docs/".into()),
        ..FileEventFilter::default()
    };

    assert_eq!(
        store.list_file_events(ROOT, &docs, 100, 0).unwrap().total,
        2
    );

    // * `_` and `%` are plain characters of the path, not wildcards.
    let underscore = FileEventFilter {
        path: Some("c_d".into()),
        ..FileEventFilter::default()
    };
    let wildcard = FileEventFilter {
        path: Some("%".into()),
        ..FileEventFilter::default()
    };

    assert_eq!(
        store
            .list_file_events(ROOT, &underscore, 100, 0)
            .unwrap()
            .total,
        1
    );
    assert_eq!(
        store
            .list_file_events(ROOT, &wildcard, 100, 0)
            .unwrap()
            .total,
        0
    );

    let window = FileEventFilter {
        source: Some("user".into()),
        from: Some(101),
        to: Some(102),
        ..FileEventFilter::default()
    };

    assert_eq!(
        store.list_file_events(ROOT, &window, 100, 0).unwrap().total,
        2
    );
}

#[test]
fn deleting_rows_removes_only_those_rows_and_never_a_file() {
    let store = store();
    let folder = tempfile::tempdir().unwrap();
    let file = folder.path().join("keep.txt");

    fs::write(&file, "code").unwrap();

    for seconds in [10, 20, 30] {
        store
            .record_file_event_at(&event("keep.txt", FileAction::Save), seconds)
            .unwrap();
    }

    let items = store
        .list_file_events(ROOT, &FileEventFilter::default(), 100, 0)
        .unwrap()
        .items;

    assert_eq!(store.delete_file_events(&[items[0].id]).unwrap(), 1);
    assert_eq!(store.delete_file_events(&[]).unwrap(), 0);
    assert_eq!(store.clear_file_events(ROOT, Some(15)).unwrap(), 1);
    assert_eq!(store.clear_file_events("/other", None).unwrap(), 0);
    assert_eq!(store.clear_file_events(ROOT, None).unwrap(), 1);
    assert_eq!(
        store
            .list_file_events(ROOT, &FileEventFilter::default(), 100, 0)
            .unwrap()
            .total,
        0
    );
    assert_eq!(fs::read_to_string(&file).unwrap(), "code");
    assert_eq!(
        store.delete_file_events(&vec![1; MAX_IDS + 1]),
        Err(ActivityError::TooManyIds)
    );
}

#[test]
fn edits_of_the_viewer_are_logged_after_they_succeed() {
    let store = store();
    let folder = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(folder.path()).unwrap();
    let root = workspace.root().display().to_string();

    // * What the commands do: the operation first, then the event.
    let created = workspace.create_for_viewer("", "a.txt", false).unwrap();

    store
        .record_file_event(&NewFileEvent::user(&root, &created, FileAction::Create))
        .unwrap();

    let before = workspace.read("a.txt").ok();

    workspace
        .write("a.txt", "one\ntwo\n", Some(&crate::workspace::hash("")))
        .unwrap();

    let (added, removed) = line_change(before.as_deref().unwrap_or(""), "one\ntwo\n");

    store
        .record_file_event(&NewFileEvent {
            lines_added: Some(added),
            lines_removed: Some(removed),
            bytes_after: Some(8),
            ..NewFileEvent::user(&root, "a.txt", FileAction::Save)
        })
        .unwrap();

    let renamed = workspace.rename_for_viewer("a.txt", "b.txt").unwrap();

    store
        .record_file_event(
            &NewFileEvent::user(&root, &renamed, FileAction::Rename).with_old_path("a.txt"),
        )
        .unwrap();

    let items = store
        .list_file_events(&root, &FileEventFilter::default(), 100, 0)
        .unwrap()
        .items;

    assert_eq!(items.len(), 3);
    assert_eq!(items[0].old_path.as_deref(), Some("a.txt"));
    assert_eq!(
        (items[1].lines_added, items[1].lines_removed),
        (Some(2), Some(0))
    );
}

#[test]
fn a_database_that_fails_is_reported_and_the_operation_stands() {
    let store = store();
    let folder = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(folder.path()).unwrap();

    workspace.create_for_viewer("", "kept.txt", false).unwrap();

    // * The database goes bad after the edit was done.
    store
        .read(|connection| connection.execute_batch("DROP TABLE file_events"))
        .unwrap();

    let mut reported = Vec::new();

    record_or_report(
        &store,
        &event("kept.txt", FileAction::Create),
        |event, key| {
            reported.push((event.path.clone(), key));
        },
    );

    assert_eq!(
        reported,
        vec![("kept.txt".to_string(), "activity.save_failed")]
    );
    assert!(folder.path().join("kept.txt").exists());

    let working = self::store();
    let mut quiet = 0;

    record_or_report(&working, &event("a", FileAction::Save), |_, _| quiet += 1);
    assert_eq!(quiet, 0);
}

#[test]
fn a_read_only_database_is_reported() {
    let store = store();

    store
        .read(|connection| connection.execute_batch("PRAGMA query_only = ON"))
        .unwrap();

    let mut keys = Vec::new();

    record_or_report(&store, &event("a", FileAction::Save), |_, key| {
        keys.push(key)
    });
    assert_eq!(keys, vec!["activity.save_failed"]);
}

#[test]
fn line_change_counts_added_and_removed_lines() {
    assert_eq!(line_change("", "a\nb\n"), (2, 0));
    assert_eq!(line_change("a\nb\n", ""), (0, 2));
    assert_eq!(line_change("a\nb\nc\n", "a\nx\nc\n"), (1, 1));
    assert_eq!(line_change("a\nb\n", "b\na\n"), (0, 0));
    assert_eq!(line_change("a\na\n", "a\n"), (0, 1));
}

#[test]
fn ai_edits_name_only_a_path_inside_the_project() {
    let root = Path::new("/work/app");
    let worktree = Path::new("/work/app-tree");
    let roots = [worktree, root];
    let edit = |name: &str, input: Value| ai_edit_path(name, &input, &roots);

    assert_eq!(
        edit(
            "Edit",
            json!({"file_path": "/work/app/src/a.rs", "old_string": "SECRET", "new_string": "x"})
        ),
        Some("src/a.rs".into())
    );
    assert_eq!(
        edit(
            "Write",
            json!({"file_path": "/work/app-tree/b.txt", "content": "x"})
        ),
        Some("b.txt".into())
    );
    assert_eq!(
        edit("MultiEdit", json!({"file_path": "src/c.rs"})),
        Some("src/c.rs".into())
    );
    assert_eq!(
        edit(
            "NotebookEdit",
            json!({"notebook_path": "/work/app/n.ipynb"})
        ),
        Some("n.ipynb".into())
    );
    assert_eq!(edit("Edit", json!({"file_path": "/etc/passwd"})), None);
    assert_eq!(edit("Edit", json!({"file_path": "../x"})), None);
    assert_eq!(edit("Bash", json!({"file_path": "a"})), None);
    assert_eq!(edit("Edit", json!({})), None);
    assert!(is_edit_tool("MultiEdit") && !is_edit_tool("Read"));

    let store = store();

    store
        .record_file_event(&NewFileEvent::ai_edit(ROOT, "src/a.rs"))
        .unwrap();

    let item = &store
        .list_file_events(ROOT, &FileEventFilter::default(), 10, 0)
        .unwrap()
        .items[0];

    assert_eq!(
        (item.action.as_str(), item.source.as_str()),
        ("ai_edit", "ai")
    );
    assert!(item.bytes_after.is_none() && item.lines_added.is_none());
}

#[test]
fn base64_matches_the_standard_vectors() {
    assert_eq!(base64_encode(b""), "");
    assert_eq!(base64_encode(b"f"), "Zg==");
    assert_eq!(base64_encode(b"fo"), "Zm8=");
    assert_eq!(base64_encode(b"foo"), "Zm9v");
    assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
}

#[test]
fn only_pictures_are_kept_and_the_same_content_once() {
    let store = store();
    let first = store
        .save_image(ROOT, Some(3), "dir/shot one.png", &png(1, 64))
        .unwrap();
    let again = store
        .save_image(ROOT, None, "other.png", &png(1, 64))
        .unwrap();
    let other_project = store
        .save_image("/other", None, "shot.png", &png(1, 64))
        .unwrap();

    assert_eq!(first, again);
    assert_ne!(first, other_project);
    assert_eq!(
        store.save_image(ROOT, None, "a.txt", b"plain text"),
        Err(ActivityError::ImageNotImage)
    );
    assert_eq!(
        store.save_image(ROOT, None, "big.png", &png(0, MAX_IMAGE_BYTES + 1)),
        Err(ActivityError::ImageTooLarge)
    );

    let listed = store.list_images(ROOT, 10, 0).unwrap();

    assert_eq!(listed.total, 1);
    assert_eq!(listed.items[0].name, "shot one.png");
    assert_eq!(listed.items[0].mime, "image/png");
    assert_eq!(listed.items[0].conversation_id, Some(3));
    assert!(listed.items[0].thumbnail_base64.is_some());

    let data = store.image(first).unwrap();

    assert_eq!(data.mime, "image/png");
    assert_eq!(data.data_base64, base64_encode(&png(1, 64)));
    assert_eq!(store.image(9999), Err(ActivityError::ImageNotFound));
}

#[test]
fn big_pictures_have_no_thumbnail() {
    let store = store();
    let size = usize::try_from(THUMBNAIL_MAX_BYTES).unwrap() + 1;

    store
        .save_image(ROOT, None, "big.png", &png(7, size))
        .unwrap();

    assert!(store.list_images(ROOT, 10, 0).unwrap().items[0]
        .thumbnail_base64
        .is_none());
}

#[test]
fn the_oldest_pictures_go_when_the_quota_is_passed() {
    let store = store();
    let quota = 250;
    let oldest = store
        .save_image_with(ROOT, None, "1.png", &png(1, 100), quota, 1)
        .unwrap();
    let middle = store
        .save_image_with(ROOT, None, "2.png", &png(2, 100), quota, 2)
        .unwrap();
    let newest = store
        .save_image_with(ROOT, None, "3.png", &png(3, 100), quota, 3)
        .unwrap();

    assert_eq!(store.image(oldest), Err(ActivityError::ImageNotFound));
    assert!(store.image(middle).is_ok() && store.image(newest).is_ok());

    // * Another project has its own room.
    let other = store
        .save_image_with("/other", None, "4.png", &png(4, 100), quota, 4)
        .unwrap();

    assert!(store.image(other).is_ok() && store.image(middle).is_ok());
    // * A picture bigger than the whole quota is still kept (alone).
    let huge = store
        .save_image_with(ROOT, None, "5.png", &png(5, 300), quota, 5)
        .unwrap();

    assert!(store.image(huge).is_ok());
    assert_eq!(store.list_images(ROOT, 10, 0).unwrap().total, 1);
}

#[test]
fn images_are_deleted_by_id() {
    let store = store();
    let id = store.save_image(ROOT, None, "a.png", &png(1, 40)).unwrap();

    assert_eq!(store.delete_images(&[id, 12345]).unwrap(), 1);
    assert_eq!(store.list_images(ROOT, 10, 0).unwrap().total, 0);
}

fn plan(path: &str, status: &str) -> NewPlanRecord {
    NewPlanRecord {
        path: path.into(),
        title: "Kế hoạch".into(),
        status: status.into(),
        tasks_total: 4,
        tasks_done: 1,
        format: "md".into(),
    }
}

#[test]
fn plan_records_are_unique_per_path_and_deleted_without_touching_files() {
    let store = store();
    let folder = tempfile::tempdir().unwrap();
    let file = folder.path().join("plan.md");

    fs::write(&file, "# plan").unwrap();

    let first = store
        .upsert_plan_record(ROOT, &plan("docs/plans/a.md", "todo"))
        .unwrap();
    let again = store
        .upsert_plan_record(ROOT, &plan("docs/plans/a.md", "done"))
        .unwrap();

    assert_eq!(first, again);

    let records = store.list_plan_records(ROOT).unwrap();

    assert_eq!(records.len(), 1);
    assert_eq!(records[0].status, "done");
    assert_eq!(records[0].tasks_total, 4);
    assert_eq!(store.delete_plan_records(&[first]).unwrap(), 1);
    assert!(store.list_plan_records(ROOT).unwrap().is_empty());
    assert!(file.exists());
}

#[test]
fn sync_adds_refreshes_and_prunes_only_when_asked() {
    let store = store();

    store
        .upsert_plan_record(ROOT, &plan("docs/plans/gone.md", "todo"))
        .unwrap();
    store
        .upsert_plan_record("/other", &plan("docs/plans/gone.md", "todo"))
        .unwrap();

    let found = [plan("docs/plans/new.md", "draft")];

    assert_eq!(
        store.sync_plan_records(ROOT, &found, false).unwrap(),
        (1, 0)
    );
    assert_eq!(store.list_plan_records(ROOT).unwrap().len(), 2);
    assert_eq!(store.sync_plan_records(ROOT, &found, true).unwrap(), (1, 1));

    let records = store.list_plan_records(ROOT).unwrap();

    assert_eq!(records.len(), 1);
    assert_eq!(records[0].path, "docs/plans/new.md");
    assert_eq!(store.list_plan_records("/other").unwrap().len(), 1);
}
