//! Read-only look at the extensions VS Code (and its Insiders, Cursor and VSCodium relatives) installed, to reuse the language servers inside them .
//!
//! Only four fixed folders under `$HOME` are read, and only `package.json`, `extensions.json` and `.obsolete` (each at most 1 MiB). Nothing is written and no script of an extension is run; a folder or file that links out of the folder it must be in is left out with a reason.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Largest file read from an extension folder.
const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// Platform suffixes an extension folder name can carry (`<id>-<version>-<platform>`).
const PLATFORMS: [&str; 10] = [
    "darwin-arm64",
    "darwin-x64",
    "linux-x64",
    "linux-arm64",
    "linux-armhf",
    "alpine-x64",
    "alpine-arm64",
    "win32-x64",
    "win32-arm64",
    "web",
];

pub const PROBLEM_OBSOLETE: &str = "language_server.obsolete";
pub const PROBLEM_PLATFORM_MISMATCH: &str = "language_server.platform_mismatch";
pub const PROBLEM_SYMLINK_OUTSIDE: &str = "language_server.symlink_outside";
pub const PROBLEM_BAD_MANIFEST: &str = "language_server.bad_manifest";

/// Which editor an extension folder belongs to; the name (`vscode`, ...) is what the settings and the front end use to refer to its folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionOrigin {
    Vscode,
    Insiders,
    Cursor,
    Vscodium,
}

impl ExtensionOrigin {
    pub const ALL: [Self; 4] = [Self::Vscode, Self::Insiders, Self::Cursor, Self::Vscodium];

    /// The origin named `name`, `None` for anything but the four names.
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|origin| origin.name() == name)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Vscode => "vscode",
            Self::Insiders => "insiders",
            Self::Cursor => "cursor",
            Self::Vscodium => "vscodium",
        }
    }

    /// The only folder of this editor ever read, under `$HOME`.
    pub fn extensions_folder(self) -> &'static str {
        match self {
            Self::Vscode => ".vscode/extensions",
            Self::Insiders => ".vscode-insiders/extensions",
            Self::Cursor => ".cursor/extensions",
            Self::Vscodium => ".vscode-oss/extensions",
        }
    }
}

/// `major.minor.patch` with an optional pre-release, compared the way semver does (a pre-release is older than its release).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    major: u64,
    minor: u64,
    patch: u64,
    pre_release: Option<String>,
}

impl Version {
    /// `1.2.3`, `1.2.3-pre.1`, `v1.2.3` or `1.2.3+build`; `None` for anything else.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.strip_prefix('v').unwrap_or(text);
        let text = text.split('+').next()?;
        let (numbers, pre_release) = match text.split_once('-') {
            Some((numbers, pre)) if !pre.is_empty() => (numbers, Some(pre.to_string())),
            Some(_) => return None,
            None => (text, None),
        };
        let mut parts = numbers.split('.');
        let mut next = || -> Option<u64> {
            let part = parts.next()?;

            (!part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| part.parse().ok())?
        };
        let (major, minor, patch) = (next()?, next()?, next()?);

        parts.next().is_none().then_some(Self {
            major,
            minor,
            patch,
            pre_release,
        })
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (&self.pre_release, &other.pre_release) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(left), Some(right)) => compare_pre_release(left, right),
            })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Dot-separated identifiers: numbers compare as numbers and sort before words.
fn compare_pre_release(left: &str, right: &str) -> Ordering {
    let mut left = left.split('.');
    let mut right = right.split('.');

    loop {
        match (left.next(), right.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(a), Some(b)) => {
                let ordering = match (a.parse::<u64>(), b.parse::<u64>()) {
                    (Ok(a), Ok(b)) => a.cmp(&b),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => a.cmp(b),
                };

                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
        }
    }
}

/// The platform suffix extension folders use on this machine, `None` where none is supported.
pub fn current_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "x86_64") => Some("linux-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        _ => None,
    }
}

/// An installed extension found in one editor's folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledExtension {
    /// `publisher.name`, as given by the caller.
    pub extension_id: String,
    pub display_name: String,
    pub version: String,
    pub origin: ExtensionOrigin,
    /// Real path of the extension folder (inside the real path of the root).
    pub folder: PathBuf,
    /// Why this folder cannot be used; `None` for the usable (newest) version.
    pub problem: Option<&'static str>,
}

/// What was read once from the four extension folders under a home: per folder its entries, `.obsolete` and `extensions.json`. Looking up several extensions in one scan (the settings tab lists every server) reads these files once instead of once per extension; a scan is a snapshot, so make a new one to see later changes.
#[derive(Debug, Clone, Default)]
pub struct ExtensionScan {
    roots: OnceLock<Vec<ScannedRoot>>,
}

#[derive(Debug, Clone)]
struct ScannedRoot {
    origin: ExtensionOrigin,
    /// Real path of the extensions folder.
    path: PathBuf,
    /// Names of the folders directly inside `path`.
    entries: Vec<String>,
    obsolete: HashSet<String>,
    /// Folder names `extensions.json` lists, by lowercased extension id; `None` when the file cannot be read.
    installed: Option<HashMap<String, HashSet<String>>>,
}

impl ExtensionScan {
    /// The roots under `home`, read on first use.
    fn roots(&self, home: &Path) -> &[ScannedRoot] {
        self.roots.get_or_init(|| {
            ExtensionOrigin::ALL
                .into_iter()
                .filter_map(|origin| scan_root(home, origin))
                .collect()
        })
    }
}

fn scan_root(home: &Path, origin: ExtensionOrigin) -> Option<ScannedRoot> {
    let path = fs::canonicalize(home.join(origin.extensions_folder())).ok()?;
    let entries = fs::read_dir(&path)
        .ok()?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    let obsolete = obsolete_folders(&path);
    let installed = installed_folders(&path);

    Some(ScannedRoot {
        origin,
        path,
        entries,
        obsolete,
        installed,
    })
}

/// What the extension `extension_id` looks like in every root under `home`: per root the newest usable version for `platform` (no `problem`), then the folders that were left out, with their `problem` (`obsolete`, `platform_mismatch`, `symlink_outside`, `bad_manifest`), newest first. Folders whose name is not `<id>-<version>[-<platform>]` are not the extension and not listed.
pub fn find(home: &Path, extension_id: &str, platform: Option<&str>) -> Vec<InstalledExtension> {
    find_in(&ExtensionScan::default(), home, extension_id, platform)
}

/// Like [`find`], reading the folders only the first time `scan` is used.
pub fn find_in(
    scan: &ExtensionScan,
    home: &Path,
    extension_id: &str,
    platform: Option<&str>,
) -> Vec<InstalledExtension> {
    scan.roots(home)
        .iter()
        .flat_map(|root| find_in_root(root, extension_id, platform))
        .collect()
}

struct FolderName {
    version: Version,
    version_text: String,
    platform: Option<&'static str>,
}

/// `<id>-<version>[-<platform>]`, the id compared without case.
fn parse_folder_name(name: &str, extension_id: &str) -> Option<FolderName> {
    let prefix = name.get(..extension_id.len())?;
    let rest = name.get(extension_id.len()..)?.strip_prefix('-')?;

    if !prefix.eq_ignore_ascii_case(extension_id) {
        return None;
    }

    let (version_text, platform) = PLATFORMS
        .iter()
        .find_map(|platform| {
            rest.strip_suffix(platform)
                .and_then(|text| text.strip_suffix('-'))
                .map(|text| (text, Some(*platform)))
        })
        .unwrap_or((rest, None));

    Some(FolderName {
        version: Version::parse(version_text)?,
        version_text: version_text.to_string(),
        platform,
    })
}

fn find_in_root(
    root: &ScannedRoot,
    extension_id: &str,
    platform: Option<&str>,
) -> Vec<InstalledExtension> {
    let installed = root
        .installed
        .as_ref()
        .and_then(|by_id| by_id.get(&extension_id.to_ascii_lowercase()));
    let mut usable: Vec<(Version, InstalledExtension)> = Vec::new();
    let mut rejected: Vec<(Version, InstalledExtension)> = Vec::new();

    for name in &root.entries {
        let Some(parsed) = parse_folder_name(name, extension_id) else {
            continue;
        };

        // * What `extensions.json` does not list is not the installed version any more, whatever is left on disk.
        let listed = installed.is_none_or(|names| names.contains(name));
        let for_this_machine = parsed.platform.is_none() || parsed.platform == platform;
        let early_problem = if root.obsolete.contains(name) || !listed {
            Some(PROBLEM_OBSOLETE)
        } else if !for_this_machine {
            Some(PROBLEM_PLATFORM_MISMATCH)
        } else {
            None
        };
        let mut extension = InstalledExtension {
            extension_id: extension_id.to_string(),
            display_name: extension_id.to_string(),
            version: parsed.version_text,
            origin: root.origin,
            folder: root.path.join(name),
            problem: early_problem,
        };

        if early_problem.is_none() {
            match inspect_folder(&root.path, &extension.folder, extension_id) {
                Ok((folder, display_name)) => {
                    extension.folder = folder;
                    extension.display_name = display_name;
                    usable.push((parsed.version, extension));

                    continue;
                }
                Err(problem) => extension.problem = Some(problem),
            }
        }

        rejected.push((parsed.version, extension));
    }

    usable.sort_by(|(left, _), (right, _)| right.cmp(left));
    rejected.sort_by(|(left, _), (right, _)| right.cmp(left));

    usable
        .into_iter()
        .take(1)
        .chain(rejected)
        .map(|(_, extension)| extension)
        .collect()
}

/// The real folder and the display name of an extension folder, or the reason it cannot be used.
fn inspect_folder(
    root: &Path,
    folder: &Path,
    extension_id: &str,
) -> Result<(PathBuf, String), &'static str> {
    let real = fs::canonicalize(folder).map_err(|_| PROBLEM_BAD_MANIFEST)?;

    if !real.starts_with(root) || !real.is_dir() {
        return Err(PROBLEM_SYMLINK_OUTSIDE);
    }

    let manifest = read_inside(&real, "package.json").ok_or(PROBLEM_BAD_MANIFEST)?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&manifest).map_err(|_| PROBLEM_BAD_MANIFEST)?;
    let text = |key: &str| manifest.get(key).and_then(serde_json::Value::as_str);
    let (Some(publisher), Some(name)) = (text("publisher"), text("name")) else {
        return Err(PROBLEM_BAD_MANIFEST);
    };

    if !format!("{publisher}.{name}").eq_ignore_ascii_case(extension_id) {
        return Err(PROBLEM_BAD_MANIFEST);
    }

    // * `%displayName%` is a placeholder for a translation file; the plain name is shown then.
    let display_name = text("displayName")
        .filter(|display_name| !display_name.is_empty() && !display_name.starts_with('%'))
        .unwrap_or(name);

    Ok((real, display_name.to_string()))
}

/// Bytes of the file `name` directly inside `directory` (a real path): at most 1 MiB, and not a link to somewhere else.
fn read_inside(directory: &Path, name: &str) -> Option<Vec<u8>> {
    let real = fs::canonicalize(directory.join(name)).ok()?;

    if real.parent()? != directory {
        return None;
    }

    let mut bytes = Vec::new();

    fs::File::open(real)
        .ok()?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;

    (bytes.len() as u64 <= MAX_FILE_BYTES).then_some(bytes)
}

/// Folder names VS Code marked as removed (`.obsolete` maps name to `true`).
fn obsolete_folders(root: &Path) -> HashSet<String> {
    read_inside(root, ".obsolete")
        .and_then(|bytes| {
            serde_json::from_slice::<serde_json::Map<String, serde_json::Value>>(&bytes).ok()
        })
        .map(|map| {
            map.into_iter()
                .filter(|(_, value)| value.as_bool() == Some(true))
                .map(|(name, _)| name)
                .collect()
        })
        .unwrap_or_default()
}

/// Folder names `extensions.json` lists, by lowercased extension id; `None` when the file cannot be read (the folder names are used then).
fn installed_folders(root: &Path) -> Option<HashMap<String, HashSet<String>>> {
    let bytes = read_inside(root, "extensions.json")?;
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&bytes).ok()?;
    let mut by_id: HashMap<String, HashSet<String>> = HashMap::new();

    for entry in &entries {
        let id = entry
            .pointer("/identifier/id")
            .and_then(serde_json::Value::as_str);
        let location = entry
            .get("relativeLocation")
            .and_then(serde_json::Value::as_str);

        if let (Some(id), Some(location)) = (id, location) {
            by_id
                .entry(id.to_ascii_lowercase())
                .or_default()
                .insert(location.to_string());
        }
    }

    Some(by_id)
}

#[cfg(test)]
#[path = "../tests/unit/vscode_extensions.rs"]
mod tests;
