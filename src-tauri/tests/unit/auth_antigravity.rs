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

#[test]
fn url_is_found_once_its_line_is_complete() {
    let partial = "Authentication required. Please visit the URL to log in:\r\n  https://accounts.google.com/o/oauth2/auth?a=1&b=";
    let complete = format!("{partial}2\r\n\r\nWaiting for authentication (timeout 60s)...\r\n");

    assert_eq!(find_url(partial), None);
    assert_eq!(
        find_url(&complete),
        Some("https://accounts.google.com/o/oauth2/auth?a=1&b=2".to_string())
    );
    assert_eq!(find_url("no link here\r\n"), None);
}

#[test]
fn refusal_is_read_from_the_output() {
    assert!(is_rejection(
        "Error: Authentication failed: token exchange failed\r\n"
    ));
    assert!(!is_rejection("Waiting for authentication (timeout 60s)..."));
}

#[test]
fn code_is_one_trimmed_line() {
    assert_eq!(check_code("  4/0Abc-d_e \n"), Ok("4/0Abc-d_e"));
    assert!(check_code("   ").is_err());
    assert!(check_code("a\nb").is_err());
    assert!(check_code(&"x".repeat(MAX_CODE_CHARS + 1)).is_err());
}

#[test]
fn code_without_a_waiting_login_is_refused() {
    let environment = vec![("HOME", "/no/such/login/home".to_string())];

    assert_eq!(
        AntigravityAuth.submit_code(&environment, "abc"),
        Err("auth.no_pending_login".to_string())
    );
}

#[test]
fn cancel_without_a_waiting_login_is_accepted() {
    let environment = vec![("HOME", "/no/such/login/home".to_string())];

    AntigravityAuth.cancel_login(&environment);
}

#[test]
fn cancel_stops_a_waiting_login() {
    #[derive(Debug, Clone)]
    struct DummyKiller(Arc<AtomicBool>);

    impl ChildKiller for DummyKiller {
        fn kill(&mut self) -> Result<(), std::io::Error> {
            self.0.store(true, Ordering::SeqCst);
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(self.clone())
        }
    }

    let pair = native_pty_system().openpty(PtySize::default()).unwrap();
    let killed = Arc::new(AtomicBool::new(false));
    let key = "/test/cancel/home".to_string();
    let login = Login {
        writer: Box::new(std::io::sink()),
        terminator: Terminator {
            killer: Box::new(DummyKiller(Arc::clone(&killed))),
            process_id: None,
        },
        state: Arc::new(LoginState::default()),
        _master: pair.master,
    };

    LOGINS.replace(key.clone(), login);
    let environment = vec![("HOME", key)];
    AntigravityAuth.cancel_login(&environment);

    assert!(killed.load(Ordering::SeqCst));
}
