use super::*;

#[test]
fn unsupported_type_gives_none() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();

    assert!(lint(&workspace, "a.rs", "fn main() {}").is_empty());
}

#[test]
fn bad_paths_and_oversize_content_give_none() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();

    assert!(lint(&workspace, "../a.ts", "var x").is_empty());
    assert!(lint(&workspace, "a\0.ts", "var x").is_empty());
    assert!(lint(&workspace, "/etc/a.ts", "var x").is_empty());
    assert!(lint(&workspace, "a.ts", &" ".repeat(MAX_WRITE_BYTES + 1)).is_empty());
}

#[test]
fn a_report_gives_its_messages() {
    let report = r#"[{"filePath":"/p/a.ts","messages":[
        {"ruleId":"no-unused-vars","severity":2,"message":"'x' is unused","line":3,"column":7,"endLine":3,"endColumn":8},
        {"ruleId":null,"severity":2,"message":"Parsing error","line":1,"column":2},
        {"ruleId":"semi","severity":1,"message":"Missing semicolon","line":5,"column":1,"endLine":5,"endColumn":4}
    ]}]"#;
    let messages = parse_report(report);

    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0].rule.as_deref(), Some("no-unused-vars"));
    assert_eq!((messages[0].line, messages[0].column), (3, 7));
    assert_eq!((messages[0].end_line, messages[0].end_column), (3, 8));
    assert_eq!(messages[1].rule, None);
    assert_eq!((messages[1].end_line, messages[1].end_column), (1, 3));
    assert_eq!(messages[2].severity, 1);
}

#[test]
fn a_message_without_a_position_is_dropped() {
    let report = r#"[{"messages":[{"ruleId":null,"severity":1,"message":"File ignored"}]}]"#;

    assert!(parse_report(report).is_empty());
}

#[test]
fn a_broken_report_gives_none() {
    assert!(parse_report("").is_empty());
    assert!(parse_report("not json").is_empty());
    assert!(parse_report(r#"{"messages":[]}"#).is_empty());
}

#[test]
fn messages_are_capped() {
    let one = r#"{"ruleId":"r","severity":1,"message":"m","line":1,"column":1}"#;
    let report = format!(
        r#"[{{"messages":[{}]}}]"#,
        vec![one; MAX_MESSAGES + 50].join(",")
    );

    assert_eq!(parse_report(&report).len(), MAX_MESSAGES);
}
