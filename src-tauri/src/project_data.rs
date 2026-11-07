//! Thư mục lưu dữ liệu theo dự án trong dữ liệu của app
//! (`<data_dir>/projects/<khoá-dự-án>/`), không phải thư mục dự án của người dùng.

use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};

const PROJECTS_DIR: &str = "projects";
const OWNER_FILE: &str = ".project-id";
const MAX_KEY_CHARS: usize = 64;
const ID_SUFFIX_CHARS: usize = 8;

pub struct ProjectData;

impl ProjectData {
    /// Thư mục của dự án, tạo nếu chưa có. Khoá là tên đã làm sạch; nếu tên
    /// rỗng thì dùng `id`; nếu thư mục cùng khoá đã thuộc dự án khác thì thêm
    /// 8 ký tự đầu của `id`. Kết quả luôn nằm trong `<data_dir>/projects/`.
    pub fn dir(data_dir: &Path, name: &str, id: &str) -> io::Result<PathBuf> {
        let root = data_dir.join(PROJECTS_DIR);
        fs::create_dir_all(&root)?;
        let root = root.canonicalize()?;

        let id_key = sanitize(id);
        if id_key.is_empty() {
            return Err(invalid("id dự án rỗng"));
        }
        let base = match sanitize(name) {
            key if key.is_empty() => id_key.clone(),
            key => key,
        };

        let mut key = base.clone();
        if owner_of(&root.join(&key)).is_some_and(|owner| owner != id) {
            let suffix: String = id_key.chars().take(ID_SUFFIX_CHARS).collect();
            key = format!("{base}-{suffix}");
        }

        let dir = root.join(&key);
        fs::create_dir_all(&dir)?;
        let dir = dir.canonicalize()?;
        if dir.parent() != Some(root.as_path()) {
            return Err(invalid("thư mục dự án nằm ngoài projects/"));
        }
        if owner_of(&dir).is_none() {
            fs::write(dir.join(OWNER_FILE), id)?;
        }
        Ok(dir)
    }

    /// Ghi nguyên tử `relative` (đường dẫn tương đối, không `..`) dưới `dir`:
    /// ghi tệp tạm rồi đổi tên. `dir` phải là kết quả của [`ProjectData::dir`].
    pub fn write_atomic(dir: &Path, relative: &Path, bytes: &[u8]) -> io::Result<()> {
        let (target, parent) = checked_target(dir, relative)?;
        let mut temp_name = target.file_name().unwrap_or_default().to_os_string();
        temp_name.push(".tmp");
        let temp = parent.join(temp_name);
        fs::write(&temp, bytes)?;
        fs::rename(&temp, &target).inspect_err(|_| {
            let _ = fs::remove_file(&temp);
        })
    }

    /// Đọc `relative` dưới `dir` (cùng kiểm tra đường dẫn như ghi); `None` nếu
    /// chưa có hoặc không đọc được. Không tạo thư mục con.
    pub fn read(dir: &Path, relative: &Path) -> Option<String> {
        let target = dir.join(relative);
        let base = dir.canonicalize().ok()?;
        let real = target.canonicalize().ok()?;
        real.starts_with(&base)
            .then(|| fs::read_to_string(real).ok())
            .flatten()
    }

    /// Nối `line` (kèm xuống dòng) vào cuối `relative` dưới `dir`; bỏ qua khi tệp
    /// đã đạt `max_bytes`. Trả `Ok(false)` nếu bị bỏ qua vì đầy.
    pub fn append_line(
        dir: &Path,
        relative: &Path,
        line: &str,
        max_bytes: u64,
    ) -> io::Result<bool> {
        let (target, _) = checked_target(dir, relative)?;
        if fs::metadata(&target).is_ok_and(|meta| meta.len() >= max_bytes) {
            return Ok(false);
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target)?;
        writeln!(file, "{line}")?;
        Ok(true)
    }
}

/// Đích `dir/relative` đã kiểm: đường dẫn chỉ gồm thành phần thường, thư mục cha
/// (được tạo) nằm trong `dir` và đích không phải symlink. Trả (đích, thư mục cha).
fn checked_target(dir: &Path, relative: &Path) -> io::Result<(PathBuf, PathBuf)> {
    if relative.as_os_str().is_empty()
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err(invalid("đường dẫn tương đối không hợp lệ"));
    }
    let target = dir.join(relative);
    let parent = target
        .parent()
        .ok_or_else(|| invalid("thiếu thư mục cha"))?
        .to_path_buf();
    fs::create_dir_all(&parent)?;
    let base = dir.canonicalize()?;
    if !parent.canonicalize()?.starts_with(&base) {
        return Err(invalid("đường dẫn thoát khỏi thư mục dự án"));
    }
    if fs::symlink_metadata(&target).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(invalid("đích là symlink"));
    }
    Ok((target, parent))
}

/// Giữ chữ, số, `-`, `_`; bỏ ký tự khác (nên `..` và dấu phân cách biến mất).
fn sanitize(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(MAX_KEY_CHARS)
        .collect()
}

fn owner_of(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join(OWNER_FILE)).ok()
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn name_is_sanitized_and_stays_inside_projects() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "../../etc/pass wd", "p1").unwrap();
        let root = data.path().join("projects").canonicalize().unwrap();
        assert_eq!(dir, root.join("etcpasswd"));
    }

    #[test]
    fn same_project_reuses_directory_other_project_gets_suffix() {
        let data = tempdir().unwrap();
        let first = ProjectData::dir(data.path(), "app", "aaaaaaaaaaaa").unwrap();
        let again = ProjectData::dir(data.path(), "app", "aaaaaaaaaaaa").unwrap();
        let other = ProjectData::dir(data.path(), "app", "bbbbbbbbbbbb").unwrap();
        assert_eq!(first, again);
        assert_ne!(first, other);
        assert!(other.ends_with("app-bbbbbbbb"));
    }

    #[test]
    fn empty_name_uses_id() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "../..", "p9").unwrap();
        assert!(dir.ends_with("p9"));
    }

    #[test]
    fn empty_id_is_rejected() {
        let data = tempdir().unwrap();
        assert!(ProjectData::dir(data.path(), "app", "..").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_leaving_projects_is_rejected() {
        let data = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let root = data.path().join("projects");
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("evil")).unwrap();
        assert!(ProjectData::dir(data.path(), "evil", "p1").is_err());
        assert!(!outside.path().join(OWNER_FILE).exists());
    }

    #[cfg(unix)]
    #[test]
    fn write_through_symlinked_subdir_is_rejected() {
        let data = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.join("plans")).unwrap();
        let result = ProjectData::write_atomic(&dir, Path::new("plans/s.json"), b"{}");
        assert!(result.is_err());
        assert!(!outside.path().join("s.json").exists());
    }

    #[test]
    fn write_atomic_twice_replaces_content_and_leaves_no_temp() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        let file = Path::new("plans/s.json");
        ProjectData::write_atomic(&dir, file, b"one").unwrap();
        ProjectData::write_atomic(&dir, file, b"two").unwrap();
        assert_eq!(fs::read_to_string(dir.join(file)).unwrap(), "two");
        assert!(!dir.join("plans/s.json.tmp").exists());
    }

    #[test]
    fn write_atomic_rejects_parent_and_absolute_paths() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        for bad in ["../x", "/tmp/x", ""] {
            assert!(ProjectData::write_atomic(&dir, Path::new(bad), b"x").is_err());
        }
    }

    #[test]
    fn names_colliding_after_sanitize_get_separate_directories() {
        let data = tempdir().unwrap();
        let first = ProjectData::dir(data.path(), "my app", "aaaaaaaaaaaa").unwrap();
        let second = ProjectData::dir(data.path(), "myapp", "bbbbbbbbbbbb").unwrap();
        assert_ne!(first, second);
        assert!(first.ends_with("myapp"));
        assert!(second.ends_with("myapp-bbbbbbbb"));
    }

    #[test]
    fn write_atomic_rejects_current_dir_and_nested_parent() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        for bad in ["./x", "a/../../x"] {
            assert!(ProjectData::write_atomic(&dir, Path::new(bad), b"x").is_err());
        }
        assert!(!data.path().join("projects/x").exists());
    }

    #[cfg(unix)]
    #[test]
    fn write_atomic_rejects_symlink_target_file() {
        let data = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        let victim = outside.path().join("victim.txt");
        fs::write(&victim, "keep").unwrap();
        std::os::unix::fs::symlink(&victim, dir.join("link.txt")).unwrap();
        assert!(ProjectData::write_atomic(&dir, Path::new("link.txt"), b"x").is_err());
        assert_eq!(fs::read_to_string(&victim).unwrap(), "keep");
    }

    #[test]
    fn read_returns_written_content_and_none_when_missing() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        let file = Path::new("plans/s.json");
        assert_eq!(ProjectData::read(&dir, file), None);
        ProjectData::write_atomic(&dir, file, b"hi").unwrap();
        assert_eq!(ProjectData::read(&dir, file).as_deref(), Some("hi"));
    }

    #[cfg(unix)]
    #[test]
    fn read_refuses_a_symlink_leaving_the_project() {
        let data = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), dir.join("link.txt"))
            .unwrap();
        assert_eq!(ProjectData::read(&dir, Path::new("link.txt")), None);
    }

    #[test]
    fn append_line_adds_lines_and_stops_at_the_limit() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        let file = Path::new("logs/d.log");
        assert!(ProjectData::append_line(&dir, file, "one", 8).unwrap());
        assert!(ProjectData::append_line(&dir, file, "two", 8).unwrap());
        assert!(!ProjectData::append_line(&dir, file, "three", 8).unwrap());
        assert_eq!(fs::read_to_string(dir.join(file)).unwrap(), "one\ntwo\n");
    }

    #[test]
    fn append_line_rejects_bad_paths() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        assert!(ProjectData::append_line(&dir, Path::new("../x"), "x", 100).is_err());
    }
}
