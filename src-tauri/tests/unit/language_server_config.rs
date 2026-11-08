use super::*;
use crate::settings;

fn store() -> LanguageServerConfigStore {
    LanguageServerConfigStore::new(db::in_memory()).expect("store")
}

/// Writes the raw row, as an older or damaged install might have left it. It goes around `save`, so it drops the kept answer the way `save` does.
fn write_row(store: &LanguageServerConfigStore, json: &str) {
    *store.cache.lock().unwrap() = None;

    let connection = store.connection.lock().unwrap();

    sql::upsert(
        &connection,
        "settings",
        &["key"],
        vec![("key", Value::from(KEY)), ("value", Value::from(json))],
    )
    .unwrap();
}

fn find<'a>(settings: &'a [ServerSetting], id: &str) -> &'a ServerSetting {
    settings.iter().find(|setting| setting.id == id).unwrap()
}

#[test]
fn every_server_is_off_with_the_automatic_source_by_default() {
    let settings = store().get();

    assert_eq!(settings.len(), catalog::SERVERS.len());
    assert!(settings.iter().all(|setting| !setting.enabled
        && setting.source == SourceChoice::Auto
        && setting.extension_root.is_none()));
}

#[test]
fn saves_and_reads_back_one_server_without_touching_the_others() {
    let store = store();

    store
        .save("rust-analyzer", true, SourceChoice::Vscode, Some("cursor"))
        .unwrap();
    store
        .save("intelephense", true, SourceChoice::Path, None)
        .unwrap();

    let settings = store.get();

    assert_eq!(
        find(&settings, "rust-analyzer"),
        &ServerSetting {
            id: "rust-analyzer".into(),
            enabled: true,
            source: SourceChoice::Vscode,
            extension_root: Some("cursor".into()),
        }
    );
    assert!(find(&settings, "intelephense").enabled);
    assert!(!find(&settings, "csharp-ls").enabled);
    assert_eq!(
        store.setting("intelephense").unwrap().source,
        SourceChoice::Path
    );

    store
        .save("rust-analyzer", false, SourceChoice::Auto, None)
        .unwrap();

    assert!(!store.setting("rust-analyzer").unwrap().enabled);
    assert!(store.setting("intelephense").unwrap().enabled);
    assert_eq!(store.setting("nope"), None);
}

#[test]
fn an_extension_root_only_counts_with_the_vscode_source() {
    let store = store();
    let saved = store
        .save("rust-analyzer", true, SourceChoice::Path, Some("vscode"))
        .unwrap();

    assert_eq!(saved.extension_root, None);
    assert_eq!(store.setting("rust-analyzer").unwrap().extension_root, None);
}

#[test]
fn rejects_an_unknown_server_and_an_extension_root_outside_the_whitelist() {
    let store = store();

    assert_eq!(
        store.save("evil", true, SourceChoice::Auto, None),
        Err(ConfigError::UnknownServer)
    );

    for root in ["/etc", "../.ssh", ".vscode/extensions/..", "", ".vscode"] {
        assert_eq!(
            store.save("rust-analyzer", true, SourceChoice::Vscode, Some(root)),
            Err(ConfigError::Invalid),
            "{root:?}"
        );
    }

    assert!(!store.setting("rust-analyzer").unwrap().enabled);
}

#[test]
fn a_damaged_row_means_the_defaults() {
    let store = store();

    for json in ["{ not json", "[]", "\"text\"", "null", ""] {
        write_row(&store, json);

        assert!(
            store.get().iter().all(|setting| !setting.enabled),
            "{json:?}"
        );
    }
}

#[test]
fn unknown_servers_sources_and_roots_are_dropped_and_the_rest_is_kept() {
    let store = store();

    write_row(
        &store,
        r#"{"servers":[
            {"id":"rust-analyzer","enabled":true,"source":"vscode","extensionRoot":"/etc"},
            {"id":"ghost","enabled":true,"source":"auto"},
            {"id":"intelephense","enabled":true,"source":"custom"},
            {"id":"csharp-ls","enabled":true,"source":"path"},
            {"id":"csharp-ls","enabled":false,"source":"auto"}
        ]}"#,
    );

    let settings = store.get();

    assert_eq!(settings.len(), catalog::SERVERS.len());
    assert_eq!(
        find(&settings, "rust-analyzer"),
        &ServerSetting {
            id: "rust-analyzer".into(),
            enabled: true,
            source: SourceChoice::Vscode,
            extension_root: None,
        }
    );
    assert!(!find(&settings, "intelephense").enabled);
    assert_eq!(find(&settings, "csharp-ls").source, SourceChoice::Path);
}

#[test]
fn the_chat_settings_row_is_not_affected() {
    let connection = db::in_memory();
    let chat = settings::ChatSettings {
        assistant_name: "Trợ lý".into(),
        ..settings::ChatSettings::default()
    };

    connection
        .execute_batch(migrations::CREATE_SETTINGS_TABLE)
        .unwrap();
    sql::upsert(
        &connection,
        "settings",
        &["key"],
        vec![
            ("key", Value::from("chat")),
            ("value", Value::from(serde_json::to_string(&chat).unwrap())),
        ],
    )
    .unwrap();

    let store = LanguageServerConfigStore::new(connection).unwrap();

    store
        .save("rust-analyzer", true, SourceChoice::Auto, None)
        .unwrap();

    let connection = store.connection.lock().unwrap();
    let rows: i64 = connection
        .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
        .unwrap();
    let chat_json: String = connection
        .query_row("SELECT value FROM settings WHERE key = 'chat'", [], |row| {
            row.get(0)
        })
        .unwrap();

    assert_eq!(rows, 2);
    assert_eq!(
        serde_json::from_str::<settings::ChatSettings>(&chat_json).unwrap(),
        chat
    );
}

#[test]
fn the_kept_answer_is_dropped_by_save_and_shared_by_clones() {
    let store = store();
    let clone = store.clone();

    assert!(!store.setting("rust-analyzer").unwrap().enabled);
    assert!(store.cache.lock().unwrap().is_some());

    // * Behind the store's back the row now says "on": a kept answer is still served.
    {
        let connection = store.connection.lock().unwrap();

        sql::upsert(
            &connection,
            "settings",
            &["key"],
            vec![
                ("key", Value::from(KEY)),
                (
                    "value",
                    Value::from(
                        r#"{"servers":[{"id":"rust-analyzer","enabled":true,"source":"auto"}]}"#,
                    ),
                ),
            ],
        )
        .unwrap();
    }

    assert!(!clone.setting("rust-analyzer").unwrap().enabled);

    store
        .save("intelephense", true, SourceChoice::Auto, None)
        .unwrap();

    assert!(store.cache.lock().unwrap().is_none());
    // * After the save the row is read again, by the clone too.
    assert!(clone.setting("intelephense").unwrap().enabled);
}

#[test]
fn a_failed_read_is_not_kept() {
    let store = store();

    store
        .connection
        .lock()
        .unwrap()
        .execute_batch("DROP TABLE settings")
        .unwrap();

    assert!(store.get().iter().all(|setting| !setting.enabled));
    assert!(store.cache.lock().unwrap().is_none());
}
