use super::*;

fn store() -> CredentialStore {
    CredentialStore::new(db::in_memory()).expect("store")
}

#[test]
fn nothing_set_at_first() {
    let status = store().status().unwrap();

    assert_eq!(status[0].name, ANTHROPIC_API_KEY);
    assert!(!status[0].set);
    assert_eq!(status[0].hint, None);
    assert!(store().environment().is_empty());
}

#[test]
fn saved_key_shows_only_its_end_and_reaches_the_environment() {
    let store = store();

    store
        .save(ANTHROPIC_API_KEY, "  sk-ant-secret-1234  ")
        .unwrap();

    let status = store.status().unwrap();

    assert!(status[0].set);
    assert_eq!(status[0].hint.as_deref(), Some("1234"));
    assert_eq!(
        store.environment(),
        vec![("ANTHROPIC_API_KEY", "sk-ant-secret-1234".to_string())]
    );
}

#[test]
fn saving_again_replaces_the_value() {
    let store = store();

    store.save(ANTHROPIC_API_KEY, "first-0001").unwrap();
    store.save(ANTHROPIC_API_KEY, "second-0002").unwrap();

    let rows: i64 = store
        .connection
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM credentials", [], |row| row.get(0))
        .unwrap();

    assert_eq!(rows, 1);
    assert_eq!(store.status().unwrap()[0].hint.as_deref(), Some("0002"));
}

#[test]
fn removed_key_is_gone() {
    let store = store();

    store.save(ANTHROPIC_API_KEY, "abcd").unwrap();
    store.remove(ANTHROPIC_API_KEY).unwrap();

    assert!(!store.status().unwrap()[0].set);
    assert!(store.environment().is_empty());
}

#[test]
fn bad_names_and_values_are_refused() {
    let store = store();

    assert_eq!(store.save("other", "abcd"), Err(CredentialError::Invalid));
    assert_eq!(
        store.save(ANTHROPIC_API_KEY, "   "),
        Err(CredentialError::Invalid)
    );
    assert_eq!(
        store.save(ANTHROPIC_API_KEY, "two words"),
        Err(CredentialError::Invalid)
    );
    assert_eq!(
        store.save(
            ANTHROPIC_API_KEY,
            &"x".repeat(crate::validation::MAX_API_KEY_CHARS + 1)
        ),
        Err(CredentialError::Invalid)
    );
    assert_eq!(store.remove("other"), Err(CredentialError::Invalid));
    assert!(!store.status().unwrap()[0].set);
}

#[test]
fn only_printable_ascii_is_a_key() {
    let store = store();

    for bad in ["a\0b", "a\u{7f}b", "khoá-bí-mật", "a\tb", "a\u{200b}b"] {
        assert_eq!(
            store.save(ANTHROPIC_API_KEY, bad),
            Err(CredentialError::Invalid),
            "{bad:?}"
        );
    }

    assert!(!store.status().unwrap()[0].set);
    assert!(store.save(ANTHROPIC_API_KEY, "sk-ant-api03_AZ~!").is_ok());
}
