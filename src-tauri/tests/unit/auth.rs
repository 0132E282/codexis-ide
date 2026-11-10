use super::*;

#[test]
fn listed_auth_clis_have_auth_and_ollama_does_not() {
    for kind in CliKind::ALL {
        assert_eq!(kind.auth().map(AuthTool::kind), Some(kind));
    }
    assert!(CliKind::Ollama.auth().is_none());
}

#[test]
fn login_arguments_start_the_tools_own_flow() {
    assert_eq!(ClaudeAuth.login_args(), ["auth", "login"]);
    assert_eq!(CodexAuth.login_args(), ["login"]);
    assert_eq!(GeminiAuth.login_args(), ["--prompt", "hi"]);
    assert!(GithubAuth.login_args().contains(&"--web"));
}

#[test]
fn details_are_trimmed_and_empty_ones_dropped() {
    assert_eq!(detail("label", "  value \n").unwrap().value, "value");
    assert!(detail("label", "   ").is_none());
}
