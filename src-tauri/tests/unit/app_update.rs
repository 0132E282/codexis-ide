use super::*;

#[test]
fn a_higher_version_is_newer_in_any_part() {
    assert!(is_newer("0.1.0", "0.1.1"));
    assert!(is_newer("0.1.9", "0.2.0"));
    assert!(is_newer("0.9.9", "1.0.0"));
    assert!(is_newer("0.1.9", "0.1.10"));
    assert!(is_newer("1.2", "1.2.1"));
}

#[test]
fn the_same_or_a_lower_version_is_not_newer() {
    assert!(!is_newer("0.1.0", "0.1.0"));
    assert!(!is_newer("0.2.0", "0.1.9"));
    assert!(!is_newer("1.0", "1.0.0"));
}

#[test]
fn a_prefix_and_a_pre_release_tail_are_ignored() {
    assert!(is_newer("0.1.0", "v0.2.0"));
    assert!(is_newer("0.1.0", "0.2.0-beta.1"));
    assert!(!is_newer("0.2.0+7", "0.2.0"));
}

#[test]
fn an_unreadable_version_is_never_newer() {
    assert!(!is_newer("0.1.0", "latest"));
    assert!(!is_newer("nonsense", "0.1.0"));
    assert!(!is_newer("0.1.0", ""));
}

#[test]
fn a_version_is_announced_once() {
    assert!(should_announce("0.1.0", None, "0.2.0"));
    assert!(!should_announce("0.1.0", Some("0.2.0"), "0.2.0"));
    assert!(should_announce("0.1.0", Some("0.2.0"), "0.3.0"));
    assert!(!should_announce("0.3.0", None, "0.2.0"));
}

#[test]
fn a_check_is_due_after_the_gap_only() {
    let gap = Duration::from_secs(60);

    assert!(is_check_due(None, 1_000, gap));
    assert!(!is_check_due(Some(1_000), 1_059, gap));
    assert!(is_check_due(Some(1_000), 1_060, gap));
    assert!(is_check_due(Some(2_000), 1_000, gap));
}

#[test]
fn progress_is_a_percent_when_the_size_is_known() {
    assert_eq!(progress(50, Some(200)).percent, Some(25));
    assert_eq!(progress(300, Some(200)).percent, Some(100));
    assert_eq!(progress(0, Some(0)).percent, None);
    assert_eq!(progress(10, None).percent, None);
    assert_eq!(progress(10, None).downloaded, 10);
}

#[test]
fn payloads_are_camel_case() {
    let update = AvailableUpdate {
        version: "0.2.0".into(),
        current_version: "0.1.0".into(),
        notes: None,
    };
    let json = serde_json::to_value(&update).unwrap();

    assert_eq!(json["currentVersion"], "0.1.0");
    assert_eq!(json["notes"], serde_json::Value::Null);
    assert_eq!(
        serde_json::to_value(progress(1, Some(2))).unwrap()["percent"],
        50
    );
}
