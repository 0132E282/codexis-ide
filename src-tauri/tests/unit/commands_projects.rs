use super::*;

#[test]
fn one_folder_keeps_its_label_and_a_group_gets_another() {
    let one = vec!["/work/a".to_string()];
    let group = vec!["/work/a".to_string(), "/work/b".to_string()];
    let reversed = vec!["/work/b".to_string(), "/work/a".to_string()];

    assert_eq!(
        code_window_label(&one),
        format!(
            "project-code-{}",
            &format!("{:x}", Sha256::digest("/work/a".as_bytes()))[..16]
        )
    );
    assert_ne!(code_window_label(&group), code_window_label(&one));
    assert_ne!(code_window_label(&group), code_window_label(&reversed));
    assert!(code_window_label(&group)
        .chars()
        .all(|c| c.is_ascii_hexdigit() || c == '-' || c.is_ascii_lowercase()));
}
