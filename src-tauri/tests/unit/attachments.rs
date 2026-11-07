use super::*;

#[test]
fn only_files_inside_the_folder_can_be_read_back() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let path = save(dir.path(), "a.png", b"png").unwrap();
    let other = outside.path().join("secret.txt");

    fs::write(&other, b"secret").unwrap();

    assert_eq!(read(dir.path(), &path).unwrap(), b"png");
    assert!(read(dir.path(), &other).is_err());
    assert!(read(dir.path(), &dir.path().join("../x")).is_err());
}

#[test]
fn saved_file_has_the_content_and_stays_inside_the_folder() {
    let dir = tempfile::tempdir().unwrap();
    let path = save(dir.path(), "../../etc/passwd", b"hello").unwrap();

    assert_eq!(path.parent().unwrap(), dir.path());
    assert!(path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .ends_with("-passwd"));
    assert_eq!(fs::read(&path).unwrap(), b"hello");
}

#[test]
fn same_content_and_name_is_one_file() {
    let dir = tempfile::tempdir().unwrap();

    assert_eq!(
        save(dir.path(), "image.png", b"x").unwrap(),
        save(dir.path(), "image.png", b"x").unwrap()
    );
    assert_ne!(
        save(dir.path(), "image.png", b"x").unwrap(),
        save(dir.path(), "image.png", b"y").unwrap()
    );
}

#[test]
fn odd_names_are_made_safe() {
    assert_eq!(safe_name("Ảnh chụp màn hình.png"), "_nh_ch_p_m_n_h_nh.png");
    assert_eq!(safe_name(".hidden"), "hidden");
    assert_eq!(safe_name(""), "file");
    assert_eq!(safe_name("a\\b\\c.txt"), "c.txt");
    assert!(safe_name(&"x".repeat(500)).chars().count() <= MAX_NAME_CHARS);
}

#[test]
fn empty_and_oversized_data_are_refused() {
    let dir = tempfile::tempdir().unwrap();

    assert_eq!(save(dir.path(), "a", b""), Err(AttachmentError::Empty));
    assert_eq!(
        save(dir.path(), "a", &vec![0; MAX_BYTES + 1]),
        Err(AttachmentError::TooLarge)
    );
}

#[test]
fn file_name_carries_sixteen_hex_characters_of_the_hash() {
    let dir = tempfile::tempdir().unwrap();
    let path = save(dir.path(), "a.txt", b"x").unwrap();
    let name = path.file_name().unwrap().to_string_lossy().into_owned();
    let (prefix, rest) = name.split_once('-').unwrap();

    assert_eq!(prefix.len(), 16);
    assert!(prefix.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(rest, "a.txt");
}

#[test]
fn windows_device_names_are_replaced() {
    assert_eq!(safe_name("CON"), "file");
    assert_eq!(safe_name("nul.txt"), "file");
    assert_eq!(safe_name("COM1.png"), "file");
    assert_eq!(safe_name("lpt9"), "file");
    assert_eq!(safe_name("console.txt"), "console.txt");
    assert_eq!(safe_name("COM10"), "COM10");
}

#[cfg(unix)]
#[test]
fn a_symlink_at_the_target_is_not_written_through() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let victim = outside.path().join("victim.txt");
    let path = save(dir.path(), "a.txt", b"x").unwrap();

    fs::write(&victim, b"keep").unwrap();
    fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(&victim, &path).unwrap();

    assert_eq!(
        save(dir.path(), "a.txt", b"x"),
        Err(AttachmentError::SaveFailed)
    );
    assert_eq!(fs::read(&victim).unwrap(), b"keep");
}
