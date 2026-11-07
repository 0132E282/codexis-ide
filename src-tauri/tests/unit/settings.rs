use super::*;

/// Base64 of the PNG signature plus padding bytes.
const PNG_AVATAR: &str = "data:image/png;base64,iVBORw0KGgo=";

fn store() -> SettingsStore {
    SettingsStore::new(db::in_memory()).expect("store")
}

#[test]
fn defaults_when_nothing_saved() {
    assert_eq!(store().get().unwrap(), ChatSettings::default());
}

#[test]
fn saves_and_replaces() {
    let store = store();
    let mut settings = ChatSettings {
        assistant_name: "Trợ lý".into(),
        default_cli: CliKind::Claude.name().into(),
        avatar: PNG_AVATAR.into(),
        ..ChatSettings::default()
    };

    store.save(&settings).unwrap();
    assert_eq!(store.get().unwrap(), settings);

    settings.assistant_name = "Khác".into();
    store.save(&settings).unwrap();
    assert_eq!(store.get().unwrap().assistant_name, "Khác");
}

#[test]
fn rejects_invalid_values() {
    let store = store();
    let bad_avatar = ChatSettings {
        avatar: "https://example.com/a.png".into(),
        ..ChatSettings::default()
    };
    let big_avatar = ChatSettings {
        avatar: format!("data:image/png;base64,{}", "A".repeat(MAX_AVATAR_BYTES)),
        ..ChatSettings::default()
    };
    let bad_cli = ChatSettings {
        default_cli: "other".into(),
        ..ChatSettings::default()
    };
    let long_name = ChatSettings {
        user_name: "a".repeat(MAX_NAME_CHARS + 1),
        ..ChatSettings::default()
    };

    for settings in [bad_cli, long_name] {
        assert_eq!(store.save(&settings), Err(SettingsError::Invalid));
    }
    assert_eq!(
        store.save(&bad_avatar),
        Err(SettingsError::Rejected(validation::KEY_BAD_AVATAR))
    );
    assert_eq!(
        store.save(&big_avatar),
        Err(SettingsError::Rejected(validation::KEY_TOO_LONG))
    );
    assert_eq!(store.get().unwrap(), ChatSettings::default());
}

#[test]
fn language_must_be_known() {
    let store = store();
    let english = ChatSettings {
        language: "en".into(),
        ..ChatSettings::default()
    };
    let unknown = ChatSettings {
        language: "fr".into(),
        ..ChatSettings::default()
    };

    store.save(&english).unwrap();
    assert_eq!(store.get().unwrap().language, "en");
    assert_eq!(store.save(&unknown), Err(SettingsError::Invalid));
}

#[test]
fn appearance_and_code_colors_must_be_known() {
    let store = store();
    let dark = ChatSettings {
        appearance: "dark".into(),
        code_colors: "dark-colorblind".into(),
        ..ChatSettings::default()
    };
    let bad_look = ChatSettings {
        appearance: "sepia".into(),
        ..ChatSettings::default()
    };
    let bad_colors = ChatSettings {
        code_colors: "sepia".into(),
        ..ChatSettings::default()
    };

    store.save(&dark).unwrap();
    assert_eq!(store.get().unwrap(), dark);
    assert_eq!(store.save(&bad_look), Err(SettingsError::Invalid));
    assert_eq!(store.save(&bad_colors), Err(SettingsError::Invalid));
}

#[test]
fn plans_must_be_known() {
    let store = store();
    let mut settings = ChatSettings {
        claude_plan: "max5".into(),
        codex_plan: "plus".into(),
        ..ChatSettings::default()
    };

    store.save(&settings).unwrap();
    assert_eq!(store.get().unwrap(), settings);

    settings.codex_plan = "max5".into();
    assert_eq!(store.save(&settings), Err(SettingsError::Invalid));
}

fn put_raw(store: &SettingsStore, json: &str) {
    sql::upsert(
        &store.connection.lock().unwrap(),
        "settings",
        &["key"],
        vec![("key", Value::from(KEY)), ("value", Value::from(json))],
    )
    .unwrap();
}

#[test]
fn old_row_without_default_cli_loads_with_ask_each_time() {
    let store = store();
    put_raw(&store, r#"{"assistantName":"Cũ"}"#);

    let loaded = store.get().unwrap();
    assert_eq!(loaded.assistant_name, "Cũ");
    assert_eq!(loaded.default_cli, "");
    assert_eq!(loaded.language, "");
}

#[test]
fn old_row_with_claude_default_cli_keeps_it_and_is_valid() {
    let store = store();
    put_raw(&store, r#"{"defaultCli":"claude"}"#);

    let loaded = store.get().unwrap();
    assert_eq!(loaded.default_cli, CliKind::Claude.name());
    assert_eq!(store.save(&loaded), Ok(()));
}

#[test]
fn default_cli_names_come_from_cli_kind() {
    let store = store();
    for name in [CliKind::Claude.name(), CliKind::Codex.name()] {
        let settings = ChatSettings {
            default_cli: name.into(),
            ..ChatSettings::default()
        };
        assert_eq!(store.save(&settings), Ok(()), "{name}");
    }
    let upper = ChatSettings {
        default_cli: "CLAUDE".into(),
        ..ChatSettings::default()
    };
    assert_eq!(store.save(&upper), Err(SettingsError::Invalid));
}

#[test]
fn avatar_must_be_a_real_image() {
    let store = store();
    let avatar = |value: &str| ChatSettings {
        avatar: value.into(),
        ..ChatSettings::default()
    };
    let bad = Err(SettingsError::Rejected(validation::KEY_BAD_AVATAR));

    assert_eq!(store.save(&avatar(PNG_AVATAR)), Ok(()));
    assert_eq!(store.save(&avatar("data:image/png;base64,<script>")), bad);
    assert_eq!(store.save(&avatar("data:image/png;base64,iVBOR")), bad);
    assert_eq!(store.save(&avatar("data:image/png;base64,")), bad);
    // JPEG signature under a PNG type.
    assert_eq!(store.save(&avatar("data:image/png;base64,/9j/4AAQ")), bad);
    assert_eq!(
        store.save(&avatar("data:image/jpeg;base64,/9j/4AAQ")),
        Ok(())
    );
}

#[test]
fn models_follow_the_model_rule() {
    let store = store();
    let claude = |model: &str| ChatSettings {
        claude_model: model.into(),
        ..ChatSettings::default()
    };
    let bad = Err(SettingsError::Rejected(validation::KEY_BAD_MODEL));

    assert_eq!(store.save(&claude("claude-opus-4.1")), Ok(()));
    assert_eq!(store.save(&claude("")), Ok(()));
    assert_eq!(store.save(&claude("--evil")), bad);
    assert_eq!(store.save(&claude("a b")), bad);
    assert_eq!(
        store.save(&ChatSettings {
            codex_model: "x".repeat(101),
            ..ChatSettings::default()
        }),
        bad
    );
}

#[test]
fn text_fields_refuse_control_characters() {
    let store = store();
    let control = Err(SettingsError::Rejected(validation::KEY_CONTROL_CHAR));
    let name = ChatSettings {
        user_name: "a\nb".into(),
        ..ChatSettings::default()
    };
    let voice = ChatSettings {
        voice: "a\0b".into(),
        ..ChatSettings::default()
    };
    let escape = ChatSettings {
        custom_instructions: "a\u{1b}[31m".into(),
        ..ChatSettings::default()
    };
    let multiline = ChatSettings {
        custom_instructions: "dòng 1\n\tdòng 2\r\n".into(),
        ..ChatSettings::default()
    };

    assert_eq!(store.save(&name), control);
    assert_eq!(store.save(&voice), control);
    assert_eq!(store.save(&escape), control);
    assert_eq!(store.save(&multiline), Ok(()));
}

#[test]
fn invalid_stored_fields_fall_back_to_defaults() {
    let store = store();
    put_raw(
        &store,
        r#"{"avatar":"data:image/png;base64,<x>","userName":"a\u0000b","assistantName":"Giữ","claudeModel":"--evil","codexModel":"gpt-5","language":"fr","defaultCli":"other","fallbackOrder":["claude","claude"],"claudePlan":"max5"}"#,
    );

    let loaded = store.get().unwrap();
    assert_eq!(loaded.avatar, "");
    assert_eq!(loaded.user_name, "");
    assert_eq!(loaded.claude_model, "");
    assert_eq!(loaded.language, "");
    assert_eq!(loaded.default_cli, "");
    assert!(loaded.fallback_order.is_empty());
    assert_eq!(loaded.assistant_name, "Giữ");
    assert_eq!(loaded.codex_model, "gpt-5");
    assert_eq!(loaded.claude_plan, "max5");
    assert_eq!(store.save(&loaded), Ok(()));
}
