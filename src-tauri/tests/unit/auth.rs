use super::*;

#[test]
fn every_cli_has_its_own_auth_tool() {
    for kind in CliKind::ALL {
        assert_eq!(kind.auth().kind(), kind);
    }
}

#[test]
fn login_arguments_start_the_tools_own_flow() {
    assert_eq!(CliKind::Claude.auth().login_args(), ["auth", "login"]);
    assert_eq!(CliKind::Codex.auth().login_args(), ["login"]);
    assert!(CliKind::Github.auth().login_args().contains(&"--web"));
}

#[test]
fn details_are_trimmed_and_empty_ones_dropped() {
    assert_eq!(detail("label", "  value \n").unwrap().value, "value");
    assert!(detail("label", "   ").is_none());
}
