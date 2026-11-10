use super::*;

#[test]
fn account_is_the_last_signed_in_email_of_the_log() {
    let log = "I1 server_oauth.go:226] OAuth: authenticated successfully as old@x.y\n\
               W2 not logged into Antigravity\n\
               I3 server_oauth.go:226] OAuth: authenticated successfully as new@x.y\n";

    assert_eq!(account_in_log(log), Some("new@x.y".to_string()));
    assert_eq!(account_in_log("nothing here"), None);
}

#[test]
fn sign_in_follows_the_models_command() {
    use std::os::unix::process::ExitStatusExt;

    let home = tempfile::tempdir().unwrap();
    let log_folder = home.path().join(".gemini/antigravity-cli/log");
    std::fs::create_dir_all(&log_folder).unwrap();
    std::fs::write(
        log_folder.join("cli-1.log"),
        "OAuth: authenticated successfully as me@x.y\n",
    )
    .unwrap();
    let environment = vec![("HOME", home.path().display().to_string())];
    let signed_in = Output {
        status: std::process::ExitStatus::from_raw(0),
        stdout: b"gemini-x\tGemini X\n".to_vec(),
        stderr: Vec::new(),
    };
    let signed_out = Output {
        status: std::process::ExitStatus::from_raw(256),
        stdout: Vec::new(),
        stderr: b"Please sign in".to_vec(),
    };

    let state = AntigravityAuth.read_sign_in(&signed_in, &environment);
    assert!(state.logged_in);
    assert_eq!(state.account, Some("me@x.y".to_string()));

    let state = AntigravityAuth.read_sign_in(&signed_out, &environment);
    assert!(!state.logged_in);
    assert_eq!(state.account, None);
}

#[test]
fn logout_is_not_supported() {
    assert_eq!(
        AntigravityAuth.logout(&[]),
        Err("auth.logout_unsupported".to_string())
    );
}
