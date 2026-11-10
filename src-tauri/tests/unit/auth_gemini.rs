use super::*;

#[test]
fn active_account_is_the_active_email() {
    assert_eq!(
        active_account(r#"{"active": "a@b.c", "old": ["x@y.z"]}"#),
        Some("a@b.c".to_string())
    );
    assert_eq!(active_account(r#"{"active": null, "old": []}"#), None);
    assert_eq!(active_account(r#"{"active": ""}"#), None);
    assert_eq!(active_account("not json"), None);
}

#[test]
fn folder_is_the_gemini_folder_inside_the_profile_home() {
    let environment = vec![("GEMINI_CLI_HOME", "/tmp/profile".to_string())];

    assert_eq!(
        gemini_folder(&environment),
        Some(PathBuf::from("/tmp/profile/.gemini"))
    );
}

#[test]
fn sign_in_follows_the_credentials_file() {
    let home = tempfile::tempdir().unwrap();
    let environment = vec![("GEMINI_CLI_HOME", home.path().display().to_string())];
    let folder = home.path().join(".gemini");
    let output = std::process::Command::new("true").output().unwrap();

    assert!(!GeminiAuth.read_sign_in(&output, &environment).logged_in);

    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("oauth_creds.json"), "{}").unwrap();
    std::fs::write(
        folder.join("google_accounts.json"),
        r#"{"active": "a@b.c"}"#,
    )
    .unwrap();

    let sign_in = GeminiAuth.read_sign_in(&output, &environment);

    assert!(sign_in.logged_in);
    assert_eq!(sign_in.account, Some("a@b.c".to_string()));
}

#[test]
fn logout_removes_the_credential_files_and_accepts_none() {
    let home = tempfile::tempdir().unwrap();
    let environment = vec![("GEMINI_CLI_HOME", home.path().display().to_string())];
    let folder = home.path().join(".gemini");

    assert_eq!(GeminiAuth.logout(&environment), Ok(()));

    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("oauth_creds.json"), "{}").unwrap();
    std::fs::write(folder.join("google_accounts.json"), "{}").unwrap();

    assert_eq!(GeminiAuth.logout(&environment), Ok(()));
    assert!(!folder.join("oauth_creds.json").exists());
    assert!(!folder.join("google_accounts.json").exists());
}
