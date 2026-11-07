use super::*;
use crate::activity::{FileAction, NewFileEvent, NewPlanRecord};
use crate::db;
use rusqlite::params;
use std::fs;
use std::time::Duration;

const ROOT: &str = "/work/app";
const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn store() -> ActivityStore {
    ActivityStore::new(db::in_memory()).expect("store")
}

fn fill(store: &ActivityStore) {
    for index in 0..3 {
        store
            .record_file_event_at(
                &NewFileEvent::user(ROOT, "a.rs", FileAction::Save),
                100 + index,
            )
            .unwrap();
    }
    store
        .record_file_event_at(&NewFileEvent::user("/other", "b.rs", FileAction::Save), 100)
        .unwrap();

    let mut image = PNG.to_vec();

    image.resize(1000, 1);
    store.save_image(ROOT, None, "a.png", &image).unwrap();
    store
        .upsert_plan_record(
            ROOT,
            &NewPlanRecord {
                path: "docs/plans/a.md".into(),
                title: "A".into(),
                status: "todo".into(),
                tasks_total: 0,
                tasks_done: 0,
                format: "md".into(),
            },
        )
        .unwrap();
    store
        .read(|connection| {
            connection.execute(
                "INSERT INTO chat_turns (workspace, id, position, cli, prompt, answer) VALUES (?1, 't1', 1, 'claude', 'hello', 'world!')",
                params![ROOT],
            )
        })
        .unwrap();
}

struct Layout {
    data: tempfile::TempDir,
    project: PathBuf,
    other: PathBuf,
}

fn layout() -> Layout {
    let data = tempfile::tempdir().unwrap();
    let project = data.path().join("projects/app");
    let other = data.path().join("projects/second");

    for (dir, log, plan) in [(&project, 100, 40), (&other, 10, 5)] {
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::create_dir_all(dir.join("plans")).unwrap();
        fs::write(dir.join("logs/2026-11-07.log"), vec![b'x'; log]).unwrap();
        fs::write(dir.join("plans/sess.json"), vec![b'y'; plan]).unwrap();
        fs::write(dir.join(".project-id"), "id").unwrap();
    }

    fs::write(data.path().join("codexis.db"), vec![0_u8; 500]).unwrap();

    Layout {
        project,
        other,
        data,
    }
}

fn sources<'a>(layout: &'a Layout, database: &'a Path, projects: &'a Path) -> Sources<'a> {
    Sources {
        root: Some(ROOT),
        projects_dir: projects,
        project_dir: Some(&layout.project),
        database,
    }
}

fn item<'a>(items: &'a [UsageItem], kind: &str) -> &'a UsageItem {
    items.iter().find(|item| item.kind == kind).unwrap()
}

#[test]
fn usage_counts_the_project_and_the_whole_app() {
    let store = store();
    let layout = layout();
    let database = layout.data.path().join("codexis.db");
    let projects = layout.data.path().join("projects");

    fill(&store);

    let report = usage(
        &store,
        &sources(&layout, &database, &projects),
        &Thresholds::standard(1),
        true,
    )
    .unwrap();

    assert_eq!(item(&report.items, "file_events").count, 3);
    assert_eq!(item(&report.items, "chat_images").count, 1);
    assert_eq!(item(&report.items, "chat_images").bytes, 1000);
    assert_eq!(item(&report.items, "plan_records").count, 1);
    assert_eq!(item(&report.items, "run_logs").count, 1);
    assert_eq!(item(&report.items, "run_logs").bytes, 100);
    assert_eq!(item(&report.items, "session_plans").bytes, 40);
    assert_eq!(item(&report.items, "chat_history").count, 1);
    assert!(item(&report.items, "chat_history").bytes > 11);
    assert_eq!(report.db_bytes, 500);
    assert_eq!(item(&report.app.items, "file_events").count, 4);
    assert_eq!(item(&report.app.items, "run_logs").bytes, 110);
    assert_eq!(
        report.total_bytes,
        report.items.iter().map(|item| item.bytes).sum::<i64>()
    );
    assert!(report.warnings.is_empty() && report.app.warnings.is_empty());
}

#[test]
fn levels_follow_the_thresholds() {
    let limits = |warning, critical| Limits {
        warning: Limit {
            bytes: None,
            count: Some(warning),
        },
        critical: Limit {
            bytes: None,
            count: Some(critical),
        },
    };
    let thresholds = Thresholds(vec![("file_events", limits(10, 20))]);
    let level = |count| {
        evaluate(
            &[UsageItem {
                kind: "file_events",
                count,
                bytes: 0,
            }],
            None,
            &thresholds,
        )
        .first()
        .map(|warning| (warning.level, warning.threshold_count))
    };

    assert_eq!(level(4), None);
    assert_eq!(level(5), None);
    assert_eq!(level(6), Some(("notice", Some(5))));
    assert_eq!(level(10), Some(("notice", Some(5))));
    assert_eq!(level(11), Some(("warning", Some(10))));
    assert_eq!(level(21), Some(("critical", Some(20))));

    let sized = Thresholds(vec![("db", bytes(100, 200))]);
    let warnings = evaluate(&[], Some(250), &sized);

    assert_eq!(
        (
            warnings[0].kind,
            warnings[0].level,
            warnings[0].threshold_bytes
        ),
        ("db", "critical", Some(200))
    );
    assert!(evaluate(&[], None, &sized).is_empty());
}

#[test]
fn default_limits_scale_with_the_multiplier() {
    let standard = Thresholds::standard(1);
    let tenfold = Thresholds::standard(10);
    let zero = Thresholds::standard(0);

    assert_eq!(
        standard.of("chat_images").unwrap().warning.bytes,
        Some(IMAGES_WARNING_BYTES)
    );
    assert_eq!(
        tenfold.of("file_events").unwrap().critical.count,
        Some(FILE_EVENTS_CRITICAL_COUNT * 10)
    );
    assert_eq!(zero, standard);
}

#[test]
fn usage_warns_by_the_limits_and_can_be_turned_off() {
    let store = store();
    let layout = layout();
    let database = layout.data.path().join("codexis.db");
    let projects = layout.data.path().join("projects");
    let small = Thresholds(vec![
        ("file_events", count(1, 2)),
        ("run_logs", bytes(50, 90)),
        ("db", bytes(100, 400)),
    ]);

    fill(&store);

    let report = usage(
        &store,
        &sources(&layout, &database, &projects),
        &small,
        true,
    )
    .unwrap();
    let kinds: Vec<_> = report
        .warnings
        .iter()
        .map(|warning| (warning.kind, warning.level))
        .collect();

    assert!(kinds.contains(&("file_events", "critical")));
    assert!(kinds.contains(&("run_logs", "critical")));
    assert!(report
        .app
        .warnings
        .iter()
        .any(|warning| warning.kind == "db" && warning.level == "critical"));
    assert!(!report.warnings.iter().any(|warning| warning.kind == "db"));

    let off = usage(
        &store,
        &sources(&layout, &database, &projects),
        &small,
        false,
    )
    .unwrap();

    assert!(off.warnings.is_empty() && off.app.warnings.is_empty());
    assert_eq!(item(&off.items, "file_events").count, 3);
}

#[test]
fn cleanup_needs_confirmation_and_removes_only_app_data_of_the_project() {
    let store = store();
    let layout = layout();
    let database = layout.data.path().join("codexis.db");
    let projects = layout.data.path().join("projects");
    let sources = sources(&layout, &database, &projects);
    let repo = tempfile::tempdir().unwrap();

    fs::write(repo.path().join("main.rs"), "fn main() {}").unwrap();
    fill(&store);

    for kind in [
        CleanupKind::FileEvents,
        CleanupKind::ChatImages,
        CleanupKind::PlanRecords,
        CleanupKind::RunLogs,
        CleanupKind::SessionPlans,
    ] {
        assert_eq!(
            cleanup(&store, kind, &sources, None, false, 1_000),
            Err(StorageError::ConfirmRequired)
        );
    }

    assert!(layout.project.join("logs/2026-11-07.log").exists());
    assert_eq!(store.list_plan_records(ROOT).unwrap().len(), 1);

    assert_eq!(
        cleanup(&store, CleanupKind::FileEvents, &sources, None, true, 1_000)
            .unwrap()
            .deleted,
        3
    );
    // * The other project's events stay.
    assert_eq!(
        store
            .list_file_events("/other", &Default::default(), 10, 0)
            .unwrap()
            .total,
        1
    );

    let images = cleanup(&store, CleanupKind::ChatImages, &sources, None, true, 1_000).unwrap();

    assert_eq!((images.deleted, images.bytes), (1, 1000));
    assert_eq!(
        cleanup(
            &store,
            CleanupKind::PlanRecords,
            &sources,
            None,
            true,
            1_000
        )
        .unwrap()
        .deleted,
        1
    );

    let logs = cleanup(&store, CleanupKind::RunLogs, &sources, None, true, 1_000).unwrap();

    assert_eq!((logs.deleted, logs.bytes), (1, 100));
    assert!(!layout.project.join("logs/2026-11-07.log").exists());
    assert!(layout.other.join("logs/2026-11-07.log").exists());

    assert_eq!(
        cleanup(
            &store,
            CleanupKind::SessionPlans,
            &sources,
            None,
            true,
            1_000
        )
        .unwrap()
        .deleted,
        1
    );
    assert!(layout.project.join(".project-id").exists());
    assert!(layout.project.join("logs").is_dir());
    assert_eq!(
        fs::read_to_string(repo.path().join("main.rs")).unwrap(),
        "fn main() {}"
    );
    assert_eq!(CleanupKind::parse("chat_history"), None);
    assert_eq!(CleanupKind::parse("nonsense"), None);
}

#[test]
fn cleanup_by_age_keeps_recent_rows_and_files() {
    let store = store();
    let layout = layout();
    let database = layout.data.path().join("codexis.db");
    let projects = layout.data.path().join("projects");
    let sources = sources(&layout, &database, &projects);
    let day = 86_400;
    let now = 100 * day;

    store
        .record_file_event_at(
            &NewFileEvent::user(ROOT, "old", FileAction::Save),
            now - 40 * day,
        )
        .unwrap();
    store
        .record_file_event_at(
            &NewFileEvent::user(ROOT, "new", FileAction::Save),
            now - day,
        )
        .unwrap();

    let cleaned = cleanup(
        &store,
        CleanupKind::FileEvents,
        &sources,
        Some(30),
        true,
        now,
    )
    .unwrap();

    assert_eq!(cleaned.deleted, 1);
    assert_eq!(
        store
            .list_file_events(ROOT, &Default::default(), 10, 0)
            .unwrap()
            .items[0]
            .path,
        "new"
    );

    // * Files: the one made "now" is recent, one dated long ago is removed.
    let old_log = layout.project.join("logs/2020-01-01.log");

    fs::write(&old_log, "old").unwrap();
    fs::File::options()
        .write(true)
        .open(&old_log)
        .unwrap()
        .set_modified(SystemTime::now() - Duration::from_secs(90 * 86_400))
        .unwrap();

    let real_now = i64::try_from(
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    )
    .unwrap();
    let logs = cleanup(
        &store,
        CleanupKind::RunLogs,
        &sources,
        Some(30),
        true,
        real_now,
    )
    .unwrap();

    assert_eq!(logs.deleted, 1);
    assert!(!old_log.exists());
    assert!(layout.project.join("logs/2026-11-07.log").exists());
}
