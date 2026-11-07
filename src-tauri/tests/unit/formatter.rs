use super::*;

#[test]
fn unsupported_type_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();

    assert_eq!(format(&workspace, "a.rs", "fn  main(){}"), "fn  main(){}");
}

#[test]
fn path_leaving_the_root_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();

    assert_eq!(format(&workspace, "../a.json", "{ }"), "{ }");
}

#[test]
fn bad_paths_and_oversize_content_are_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();

    assert_eq!(format(&workspace, "a\0.ts", "x  =  1"), "x  =  1");
    assert_eq!(format(&workspace, "a\\b.ts", "x  =  1"), "x  =  1");
    assert_eq!(format(&workspace, "/etc/a.json", "{ }"), "{ }");

    let big = " ".repeat(MAX_WRITE_BYTES + 1);

    assert_eq!(format(&workspace, "a.json", &big), big);
}
