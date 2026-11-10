use super::*;

fn store() -> (tempfile::TempDir, ProfileStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = ProfileStore::new(db::in_memory(), dir.path().join("profiles")).unwrap();

    (dir, store)
}

fn names(store: &ProfileStore, cli: &str) -> Vec<String> {
    store
        .list()
        .unwrap()
        .into_iter()
        .filter(|profile| profile.cli == cli)
        .map(|profile| profile.name)
        .collect()
}

#[test]
fn default_profile_is_always_first_and_active() {
    let (_dir, store) = store();
    let list = store.list().unwrap();

    assert_eq!(list.len(), 5);
    assert!(list
        .iter()
        .all(|profile| profile.id == DEFAULT_PROFILE && profile.active));
    assert!(store.active_environment("claude").is_empty());
}

#[test]
fn added_account_has_a_private_folder_and_an_environment() {
    let (dir, store) = store();

    store.add("claude", " Công việc ").unwrap();

    assert_eq!(names(&store, "claude"), ["Mặc định", "Công việc"]);
    assert_eq!(names(&store, "codex"), ["Mặc định"]);

    let id = store
        .list()
        .unwrap()
        .iter()
        .find(|p| p.name == "Công việc")
        .unwrap()
        .id;
    let environment = store.environment("claude", id).unwrap();

    assert_eq!(environment[0].0, "CLAUDE_CONFIG_DIR");
    assert_eq!(
        PathBuf::from(&environment[0].1),
        dir.path().join("profiles").join(format!("claude-{id}"))
    );
    assert!(PathBuf::from(&environment[0].1).is_dir());
}

#[test]
fn selecting_switches_the_environment_and_removing_goes_back() {
    let (_dir, store) = store();

    store.add("codex", "Cá nhân").unwrap();

    let id = store
        .list()
        .unwrap()
        .iter()
        .find(|p| p.name == "Cá nhân")
        .unwrap()
        .id;

    store.select("codex", id).unwrap();
    assert_eq!(store.active_id("codex"), id);
    assert_eq!(store.active_environment("codex")[0].0, "CODEX_HOME");

    let folder = PathBuf::from(&store.active_environment("codex")[0].1);

    store.remove("codex", id).unwrap();
    assert_eq!(store.active_id("codex"), DEFAULT_PROFILE);
    assert!(store.active_environment("codex").is_empty());
    assert!(!folder.exists());
}

#[test]
fn an_account_can_be_renamed_but_not_the_default() {
    let (_dir, store) = store();

    store.add("claude", "Tài khoản 2").unwrap();

    let id = store
        .list()
        .unwrap()
        .iter()
        .find(|p| p.name == "Tài khoản 2")
        .unwrap()
        .id;

    store.rename("claude", id, " Công việc ").unwrap();
    assert_eq!(names(&store, "claude"), ["Mặc định", "Công việc"]);
    assert_eq!(
        store.rename("claude", DEFAULT_PROFILE, "x"),
        Err(ProfileError::Invalid)
    );
    assert_eq!(store.rename("claude", id, "  "), Err(ProfileError::Invalid));
    assert_eq!(store.rename("codex", id, "x"), Err(ProfileError::NotFound));
}

#[test]
fn bad_requests_are_refused() {
    let (_dir, store) = store();

    assert_eq!(store.add("unknown", "x"), Err(ProfileError::Invalid));
    assert_eq!(store.add("claude", "  "), Err(ProfileError::Invalid));
    assert_eq!(
        store.add("claude", &"x".repeat(41)),
        Err(ProfileError::Invalid)
    );
    assert_eq!(
        store.remove("claude", DEFAULT_PROFILE),
        Err(ProfileError::Invalid)
    );
    assert_eq!(store.remove("claude", 99), Err(ProfileError::NotFound));
    assert_eq!(store.select("claude", 99), Err(ProfileError::NotFound));
    assert!(store.environment("claude", 99).is_err());
}

#[test]
fn an_id_of_another_cli_is_not_found() {
    let (_dir, store) = store();

    store.add("claude", "A").unwrap();

    let id = store
        .list()
        .unwrap()
        .iter()
        .find(|p| p.name == "A")
        .unwrap()
        .id;

    assert_eq!(store.select("codex", id), Err(ProfileError::NotFound));
}

#[test]
fn number_of_accounts_is_limited() {
    let (_dir, store) = store();

    for index in 0..MAX_PER_CLI {
        store.add("claude", &format!("A{index}")).unwrap();
    }

    assert_eq!(store.add("claude", "one more"), Err(ProfileError::TooMany));
    store.add("codex", "other cli").unwrap();
}

#[test]
fn names_with_control_characters_are_refused() {
    let (_dir, store) = store();

    assert_eq!(store.add("claude", "a\nb"), Err(ProfileError::Invalid));
    assert_eq!(store.add("claude", "a\0b"), Err(ProfileError::Invalid));
    assert_eq!(names(&store, "claude"), ["Mặc định"]);

    store.add("claude", "Công việc").unwrap();

    let id = store
        .list()
        .unwrap()
        .into_iter()
        .find(|p| p.name == "Công việc")
        .unwrap()
        .id;

    assert_eq!(
        store.rename("claude", id, "x\u{1b}"),
        Err(ProfileError::Invalid)
    );
}
