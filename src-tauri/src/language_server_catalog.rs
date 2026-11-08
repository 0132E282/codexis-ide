//! The language servers Codexis IDE knows how to run, and where to find them on this machine.
//!
//! The catalog is the whitelist: a server is only ever started from a file this module resolved for a [`ServerSpec`], never from a path or program name sent by the front end. Sources, in order of preference: the server inside an extension that VS Code (or Cursor, ...) installed, then the program in `PATH` and the usual install folders.

use crate::vscode_extensions::{self, ExtensionOrigin, Version};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

/// How long `--version` of a server found in `PATH` may take (a `rustup` proxy can be slow).
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

pub const PROBLEM_NODE_MISSING: &str = "language_server.node_missing";
pub const PROBLEM_EXTENSION_CHANGED: &str = "language_server.extension_changed";
pub const PROBLEM_SYMLINK_OUTSIDE: &str = "language_server.symlink_outside";
pub const PROBLEM_NOT_EXECUTABLE: &str = "language_server.not_executable";
pub const PROBLEM_NAME_REJECTED: &str = "language_server.path_name_rejected";
pub const PROBLEM_VERSION_CHECK_FAILED: &str = "language_server.version_check_failed";

/// Where a server was found: an editor's extension folder, a program in `PATH`, or the app's own `npm` install.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CandidateOrigin {
    Vscode,
    Insiders,
    Cursor,
    Vscodium,
    Path,
    Download,
}

impl CandidateOrigin {
    fn from_extension(origin: ExtensionOrigin) -> Self {
        match origin {
            ExtensionOrigin::Vscode => Self::Vscode,
            ExtensionOrigin::Insiders => Self::Insiders,
            ExtensionOrigin::Cursor => Self::Cursor,
            ExtensionOrigin::Vscodium => Self::Vscodium,
        }
    }

    /// The editor, for an extension origin.
    pub fn extension(self) -> Option<ExtensionOrigin> {
        match self {
            Self::Vscode => Some(ExtensionOrigin::Vscode),
            Self::Insiders => Some(ExtensionOrigin::Insiders),
            Self::Cursor => Some(ExtensionOrigin::Cursor),
            Self::Vscodium => Some(ExtensionOrigin::Vscodium),
            Self::Path | Self::Download => None,
        }
    }
}

/// What the person chose for a server in the settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceChoice {
    #[default]
    Auto,
    Vscode,
    Path,
    /// The server the app installed itself with `npm`.
    Download,
}

/// How the file found in an extension is run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileKind {
    /// A native program, run directly (needs the execute bit).
    Binary,
    /// A JavaScript file, run by the Node found on this machine.
    NodeScript,
}

/// The server inside a VS Code extension.
#[derive(Debug)]
struct ExtensionServer {
    extension_id: &'static str,
    extension_name: &'static str,
    /// Path of the server file inside the extension folder.
    file: &'static str,
    kind: FileKind,
    arguments: &'static [&'static str],
}

/// A server the app can install itself with `npm`, into its own folder, pinned to one version.
#[derive(Debug)]
pub struct NpmInstall {
    pub package: &'static str,
    pub version: &'static str,
    /// Path of the server's JavaScript file inside the install folder.
    file: &'static str,
    arguments: &'static [&'static str],
}

#[derive(Debug)]
pub struct ServerSpec {
    pub id: &'static str,
    pub name: &'static str,
    /// File extension (without the dot) and the language id the server is told about it.
    languages: &'static [(&'static str, &'static str)],
    extension: Option<ExtensionServer>,
    /// Program names accepted when the server is found in `PATH`; nothing else is ever run from there.
    path_programs: &'static [&'static str],
    path_arguments: &'static [&'static str],
    /// Arguments that print the version, to tell a working program from a broken proxy; `None` = not asked.
    version_arguments: Option<&'static [&'static str]>,
    /// How the app installs it itself; `None` = it cannot.
    pub install: Option<NpmInstall>,
}

impl ServerSpec {
    /// File extensions (without the dot) of the files the server handles.
    pub fn file_extensions(&self) -> Vec<&'static str> {
        self.languages
            .iter()
            .map(|(extension, _)| *extension)
            .collect()
    }

    /// Language ids the server handles, without repeats.
    pub fn language_ids(&self) -> Vec<&'static str> {
        let mut ids: Vec<&'static str> = Vec::new();

        for (_, id) in self.languages {
            if !ids.contains(id) {
                ids.push(id);
            }
        }

        ids
    }
}

pub const SERVERS: [ServerSpec; 4] = [
    ServerSpec {
        id: "rust-analyzer",
        name: "rust-analyzer",
        languages: &[("rs", "rust")],
        extension: Some(ExtensionServer {
            extension_id: "rust-lang.rust-analyzer",
            extension_name: "rust-analyzer",
            file: "server/rust-analyzer",
            kind: FileKind::Binary,
            arguments: &[],
        }),
        path_programs: &["rust-analyzer"],
        path_arguments: &[],
        version_arguments: Some(&["--version"]),
        install: None,
    },
    ServerSpec {
        id: "intelephense",
        name: "Intelephense",
        languages: &[("php", "php")],
        extension: Some(ExtensionServer {
            extension_id: "bmewburn.vscode-intelephense-client",
            extension_name: "PHP Intelephense",
            file: "node_modules/intelephense/lib/intelephense.js",
            kind: FileKind::NodeScript,
            arguments: &["--stdio"],
        }),
        path_programs: &["intelephense"],
        path_arguments: &["--stdio"],
        version_arguments: None,
        install: Some(NpmInstall {
            package: "intelephense",
            version: "1.18.5",
            file: "node_modules/intelephense/lib/intelephense.js",
            arguments: &["--stdio"],
        }),
    },
    ServerSpec {
        id: "tailwindcss",
        name: "Tailwind CSS",
        languages: &[
            ("html", "html"),
            ("css", "css"),
            ("jsx", "javascriptreact"),
            ("tsx", "typescriptreact"),
        ],
        extension: Some(ExtensionServer {
            extension_id: "bradlc.vscode-tailwindcss",
            extension_name: "Tailwind CSS IntelliSense",
            file: "dist/tailwindServer.js",
            kind: FileKind::NodeScript,
            arguments: &["--stdio"],
        }),
        path_programs: &["tailwindcss-language-server"],
        path_arguments: &["--stdio"],
        version_arguments: None,
        install: Some(NpmInstall {
            package: "@tailwindcss/language-server",
            version: "0.16.0",
            file: "node_modules/@tailwindcss/language-server/bin/tailwindcss-language-server",
            arguments: &["--stdio"],
        }),
    },
    ServerSpec {
        id: "csharp-ls",
        name: "csharp-ls",
        languages: &[("cs", "csharp")],
        extension: None,
        path_programs: &["csharp-ls"],
        path_arguments: &[],
        version_arguments: Some(&["--version"]),
        install: None,
    },
];

pub fn spec(id: &str) -> Option<&'static ServerSpec> {
    SERVERS.iter().find(|spec| spec.id == id)
}

/// The server for a file and the language id it is opened with. Blade templates (`*.blade.php`) are not PHP to Intelephense, so they get no server.
pub fn spec_for_path(relative: &str) -> Option<(&'static ServerSpec, &'static str)> {
    let name = relative.rsplit('/').next()?.to_ascii_lowercase();

    if name.ends_with(".blade.php") {
        return None;
    }

    let extension = name.rsplit_once('.')?.1;

    SERVERS.iter().find_map(|spec| {
        spec.languages
            .iter()
            .find(|(candidate, _)| *candidate == extension)
            .map(|(_, language_id)| (spec, *language_id))
    })
}

/// What to say when no source is usable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallHint {
    /// VS Code extension that carries the server; `None` when there is none to install.
    pub extension_id: Option<&'static str>,
    pub display_name: &'static str,
    /// i18n key of the instruction.
    pub message_key: &'static str,
}

pub fn install_hint(spec: &ServerSpec) -> InstallHint {
    match &spec.extension {
        Some(server) => InstallHint {
            extension_id: Some(server.extension_id),
            display_name: server.extension_name,
            message_key: "language_server.hint_install_extension",
        },
        None => InstallHint {
            extension_id: None,
            display_name: spec.name,
            message_key: "language_server.hint_install_program",
        },
    }
}

/// The places the machine keeps programs, so tests can point them at a temporary folder.
#[derive(Debug, Clone)]
pub struct Locator {
    pub home: PathBuf,
    /// Platform suffix of extension folders on this machine.
    pub platform: Option<&'static str>,
    /// The folders of `PATH`.
    pub path_dirs: Vec<PathBuf>,
    /// Install folders outside `$HOME` searched after `PATH` (a desktop app does not inherit the shell's `PATH`).
    pub fixed_dirs: Vec<PathBuf>,
    /// What was read from the editors' extension folders; shared by the servers listed with this locator, so a listing reads them once.
    pub extensions: vscode_extensions::ExtensionScan,
    /// Folder the app installs servers into (one folder per server id); `None` = the app installs none.
    pub installed_dir: Option<PathBuf>,
}

impl Locator {
    /// This machine; `None` when `$HOME` is unknown.
    pub fn system() -> Option<Self> {
        let home = PathBuf::from(std::env::var_os("HOME").filter(|home| !home.is_empty())?);
        let path = std::env::var_os("PATH").unwrap_or_default();

        Some(Self {
            home,
            platform: vscode_extensions::current_platform(),
            path_dirs: std::env::split_paths(&path).collect(),
            fixed_dirs: vec![
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/local/bin"),
            ],
            extensions: vscode_extensions::ExtensionScan::default(),
            installed_dir: None,
        })
    }

    /// The same locator that also finds the servers the app installed itself into `directory`.
    #[must_use]
    pub fn with_installed_dir(mut self, directory: PathBuf) -> Self {
        self.installed_dir = Some(directory);

        self
    }

    /// The folder `spec` is installed into by the app.
    pub fn install_folder(&self, spec: &ServerSpec) -> Option<PathBuf> {
        spec.install.as_ref()?;

        Some(self.installed_dir.as_ref()?.join(spec.id))
    }

    /// Folders searched for a server program, in order.
    fn program_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = self.path_dirs.clone();

        dirs.extend(self.fixed_dirs.iter().cloned());
        dirs.extend(
            [".local/bin", ".cargo/bin", ".dotnet/tools"]
                .iter()
                .map(|relative| self.home.join(relative)),
        );

        dirs
    }

    /// Folders added to the `PATH` of a server: a server started from the desktop needs `cargo`, `dotnet` and `node` to be found like in a terminal.
    fn child_path_dirs(&self, program: &Path) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = program
            .parent()
            .map(Path::to_path_buf)
            .into_iter()
            .collect();

        dirs.extend(
            self.node()
                .and_then(|node| node.parent().map(Path::to_path_buf)),
        );
        dirs.extend(self.program_dirs());
        dirs.retain(|dir| dir.is_absolute());
        dirs.dedup();

        dirs
    }

    /// The Node to run JavaScript servers: `PATH`, Homebrew, Volta, then the newest nvm and fnm install.
    pub fn node(&self) -> Option<PathBuf> {
        let mut dirs = self.path_dirs.clone();

        dirs.extend(self.fixed_dirs.iter().cloned());
        dirs.push(self.home.join(".volta/bin"));

        let fixed = dirs.iter().map(|dir| dir.join("node"));
        let nvm = newest_version_dir(&self.home.join(".nvm/versions/node"))
            .map(|version| version.join("bin/node"));
        let fnm = [
            ".local/share/fnm/node-versions",
            "Library/Application Support/fnm/node-versions",
        ]
        .iter()
        .find_map(|relative| newest_version_dir(&self.home.join(relative)))
        .map(|version| version.join("installation/bin/node"));

        fixed
            .chain(nvm)
            .chain(fnm)
            .find(|candidate| is_executable_file(candidate))
    }
}

/// The folder with the greatest version number (`v22.14.0`, `22.14.0`) directly inside `directory`.
fn newest_version_dir(directory: &Path) -> Option<PathBuf> {
    fs::read_dir(directory)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let version = Version::parse(entry.file_name().to_str()?)?;

            Some((version, entry.path()))
        })
        .max_by(|(left, _), (right, _)| left.cmp(right))
        .map(|(_, path)| path)
}

/// A regular file (a link to one counts) that may be run.
fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        metadata.is_file()
    }
}

/// What the manager runs: the program, its fixed arguments and the folders added to its `PATH`. Built here from the catalog only.
#[derive(Debug, Clone, PartialEq)]
pub struct LaunchPlan {
    pub program: PathBuf,
    pub arguments: Vec<String>,
    pub extra_path: Vec<PathBuf>,
    /// `initializationOptions` of the server's `initialize`; `null` when it takes none.
    pub initialization_options: Value,
}

/// One place a server was found.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub origin: CandidateOrigin,
    /// Display name of the extension, or the name of the program.
    pub label: String,
    pub extension_id: Option<String>,
    pub version: Option<String>,
    /// The server file on this machine, shown in the settings only.
    pub path: String,
    /// Why it cannot be used: a `language_server.*` key.
    pub problem: Option<&'static str>,
    #[serde(skip)]
    pub launch: Option<LaunchPlan>,
}

impl Candidate {
    pub fn is_usable(&self) -> bool {
        self.problem.is_none() && self.launch.is_some()
    }

    fn rejected(mut self, problem: &'static str) -> Self {
        self.problem = Some(problem);
        self.launch = None;
        self
    }
}

/// Every place the server of `spec` is found: the extensions first (newest usable version per editor, then the folders that had to be left out), then `PATH`. `probe` runs `--version` of the `PATH` program, which can take a few seconds; starting a server skips it.
pub fn candidates(spec: &ServerSpec, locator: &Locator, probe: bool) -> Vec<Candidate> {
    let mut found = Vec::new();

    if let Some(server) = &spec.extension {
        for extension in vscode_extensions::find_in(
            &locator.extensions,
            &locator.home,
            server.extension_id,
            locator.platform,
        ) {
            let base = Candidate {
                origin: CandidateOrigin::from_extension(extension.origin),
                label: extension.display_name.clone(),
                extension_id: Some(extension.extension_id.clone()),
                version: Some(extension.version.clone()),
                path: extension.folder.join(server.file).display().to_string(),
                problem: None,
                launch: None,
            };

            found.push(match extension.problem {
                Some(problem) => base.rejected(problem),
                None => extension_candidate(base, server, &extension.folder, locator),
            });
        }
    }

    found.extend(path_candidate(spec, locator, probe));
    found.extend(installed_candidate(spec, locator));

    found
}

/// The server the app installed itself with `npm`, when it is there.
fn installed_candidate(spec: &ServerSpec, locator: &Locator) -> Option<Candidate> {
    let install = spec.install.as_ref()?;
    let folder = locator.install_folder(spec)?;
    let file = folder.join(install.file);

    if !file.is_file() {
        return None;
    }

    let base = Candidate {
        origin: CandidateOrigin::Download,
        label: install.package.to_string(),
        extension_id: None,
        version: Some(install.version.to_string()),
        path: file.display().to_string(),
        problem: None,
        launch: None,
    };
    let Ok(canonical) = fs::canonicalize(&file) else {
        return Some(base.rejected(PROBLEM_EXTENSION_CHANGED));
    };

    // * Same rule as for an extension: the file must still be inside the install folder after links are followed.
    if !fs::canonicalize(&folder).is_ok_and(|root| canonical.starts_with(root)) {
        return Some(base.rejected(PROBLEM_SYMLINK_OUTSIDE));
    }

    let Some(node) = locator.node() else {
        return Some(base.rejected(PROBLEM_NODE_MISSING));
    };
    let mut arguments = vec![canonical.display().to_string()];

    arguments.extend(owned(install.arguments));

    Some(Candidate {
        launch: Some(LaunchPlan {
            extra_path: locator.child_path_dirs(&node),
            program: node,
            arguments,
            initialization_options: Value::Null,
        }),
        ..base
    })
}

/// The server file of an extension folder, resolved and checked.
fn extension_candidate(
    base: Candidate,
    server: &ExtensionServer,
    folder: &Path,
    locator: &Locator,
) -> Candidate {
    // * The file must be inside the extension folder after links are followed: an extension cannot make us run something elsewhere.
    let Ok(file) = fs::canonicalize(folder.join(server.file)) else {
        return base.rejected(PROBLEM_EXTENSION_CHANGED);
    };

    if !file.starts_with(folder) {
        return base.rejected(PROBLEM_SYMLINK_OUTSIDE);
    }

    match server.kind {
        FileKind::Binary => {
            if !file.is_file() {
                return base.rejected(PROBLEM_EXTENSION_CHANGED);
            }

            if !is_executable_file(&file) {
                return base.rejected(PROBLEM_NOT_EXECUTABLE);
            }

            let launch = LaunchPlan {
                extra_path: locator.child_path_dirs(&file),
                program: file,
                arguments: owned(server.arguments),
                initialization_options: Value::Null,
            };

            Candidate {
                launch: Some(launch),
                ..base
            }
        }
        FileKind::NodeScript => {
            if fs::File::open(&file).is_err() || !file.is_file() {
                return base.rejected(PROBLEM_EXTENSION_CHANGED);
            }

            let Some(node) = locator.node() else {
                return base.rejected(PROBLEM_NODE_MISSING);
            };
            let mut arguments = vec![file.display().to_string()];

            arguments.extend(owned(server.arguments));

            Candidate {
                launch: Some(LaunchPlan {
                    extra_path: locator.child_path_dirs(&node),
                    program: node,
                    arguments,
                    initialization_options: Value::Null,
                }),
                ..base
            }
        }
    }
}

fn owned(arguments: &[&str]) -> Vec<String> {
    arguments
        .iter()
        .map(|argument| (*argument).to_string())
        .collect()
}

/// The server program of `spec` found in `PATH` or a usual install folder.
fn path_candidate(spec: &ServerSpec, locator: &Locator, probe: bool) -> Option<Candidate> {
    let dirs = locator.program_dirs();
    let found = spec.path_programs.iter().find_map(|program| {
        dirs.iter()
            .map(|dir| dir.join(program))
            .find(|candidate| candidate.is_file())
    })?;
    let base = Candidate {
        origin: CandidateOrigin::Path,
        label: found
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
        extension_id: None,
        version: None,
        path: found.display().to_string(),
        problem: None,
        launch: None,
    };
    let program = match check_path_program(spec, &found) {
        Ok(program) => program,
        Err(problem) => return Some(base.rejected(problem)),
    };
    let extra_path = locator.child_path_dirs(&program);
    let mut version = None;

    if let (true, Some(arguments)) = (probe, spec.version_arguments) {
        match cached_version(&program, arguments, &extra_path) {
            Some(text) => version = Some(text),
            None => return Some(base.rejected(PROBLEM_VERSION_CHECK_FAILED)),
        }
    }

    Some(Candidate {
        version,
        launch: Some(LaunchPlan {
            program,
            arguments: owned(spec.path_arguments),
            extra_path,
            initialization_options: Value::Null,
        }),
        ..base
    })
}

/// A program found in `PATH` may be run only when its name is one of the spec's and it can be executed.
///
/// # Errors
/// Fails with the reason key when the base name is not on the spec's whitelist or the file cannot be executed.
pub fn check_path_program(spec: &ServerSpec, program: &Path) -> Result<PathBuf, &'static str> {
    let allowed = program
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| spec.path_programs.contains(&name));

    if !allowed {
        return Err(PROBLEM_NAME_REJECTED);
    }

    if !is_executable_file(program) {
        return Err(PROBLEM_NOT_EXECUTABLE);
    }

    Ok(program.to_path_buf())
}

/// Versions that were read, by program and modification time, so listing the servers again does not run every program again. A failure is never cached: the person may fix it (install the component) without the file changing.
fn cached_version(program: &Path, arguments: &[&str], extra_path: &[PathBuf]) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<(PathBuf, SystemTime), String>>> = OnceLock::new();

    let modified = fs::metadata(program)
        .and_then(|metadata| metadata.modified())
        .ok()?;
    let key = (program.to_path_buf(), modified);
    let cache = CACHE.get_or_init(Mutex::default);

    if let Some(version) = cache.lock().ok()?.get(&key) {
        return Some(version.clone());
    }

    let version = probe_version(program, arguments, extra_path)?;

    cache.lock().ok()?.insert(key, version.clone());

    Some(version)
}

/// First line of the program's version output; `None` when it fails, prints nothing or takes longer than the timeout (it is killed then).
fn probe_version(program: &Path, arguments: &[&str], extra_path: &[PathBuf]) -> Option<String> {
    let mut command = Command::new(program);

    command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    if let Some(path) = joined_path(extra_path) {
        command.env("PATH", path);
    }

    let mut child = command.spawn().ok()?;
    let started = Instant::now();

    loop {
        match child.try_wait().ok()? {
            Some(status) if status.success() => break,
            Some(_) => return None,
            None if started.elapsed() >= VERSION_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();

                return None;
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }

    let output = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next()?.trim();

    if line.is_empty() {
        return None;
    }

    Some(
        line.split_whitespace()
            .find(|word| word.starts_with(|first: char| first.is_ascii_digit()))
            .unwrap_or(line)
            .to_string(),
    )
}

/// `extra` followed by the current `PATH`, as one value for the `PATH` variable of a child.
pub fn joined_path(extra: &[PathBuf]) -> Option<std::ffi::OsString> {
    let current = std::env::var_os("PATH").unwrap_or_default();

    std::env::join_paths(extra.iter().cloned().chain(std::env::split_paths(&current))).ok()
}

/// Index of the candidate to run for the person's choice, `None` when nothing usable matches. `Auto` takes the first usable extension (VS Code, Insiders, Cursor, VSCodium), then `PATH`; a chosen `extension_root` only matches that editor.
pub fn select(
    candidates: &[Candidate],
    choice: SourceChoice,
    extension_root: Option<ExtensionOrigin>,
) -> Option<usize> {
    let first = |matches: &dyn Fn(CandidateOrigin) -> bool| {
        candidates
            .iter()
            .position(|candidate| candidate.is_usable() && matches(candidate.origin))
    };
    let extension = |origin: CandidateOrigin| {
        origin
            .extension()
            .is_some_and(|editor| extension_root.is_none_or(|root| root == editor))
    };
    let path = |origin: CandidateOrigin| origin == CandidateOrigin::Path;
    let installed = |origin: CandidateOrigin| origin == CandidateOrigin::Download;

    match choice {
        SourceChoice::Auto => first(&|origin| origin.extension().is_some())
            .or_else(|| first(&path))
            .or_else(|| first(&installed)),
        SourceChoice::Vscode => first(&extension),
        SourceChoice::Path => first(&path),
        SourceChoice::Download => first(&installed),
    }
}

/// `initializationOptions` the server wants. Intelephense keeps its index under `storage`, one folder per project, so it is not rebuilt at every start.
pub fn initialization_options(spec: &ServerSpec, storage: &Path) -> Value {
    match spec.id {
        "intelephense" => json!({
            "storagePath": storage.join("workspace").display().to_string(),
            "globalStoragePath": storage.join("global").display().to_string(),
        }),
        _ => Value::Null,
    }
}

#[cfg(test)]
#[path = "../tests/unit/language_server_catalog.rs"]
mod tests;
