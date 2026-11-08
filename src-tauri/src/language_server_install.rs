//! Installs a language server into the app's own folder with `npm`, pinned to the version in the catalog.
//!
//! Only a server whose [`ServerSpec`] has an `install` entry can be installed, and only with the package and version written there: nothing the front end sends is passed to `npm`.

use crate::language_server_catalog::{joined_path, Locator, ServerSpec};
use std::fs;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// `npm install` of one package: a few seconds with a network, so this only stops a hung one.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(300);

pub const ERROR_NOT_INSTALLABLE: &str = "language_server.not_installable";
pub const ERROR_NODE_MISSING: &str = "language_server.node_missing";
pub const ERROR_NPM_MISSING: &str = "language_server.npm_missing";
pub const ERROR_INSTALL_FAILED: &str = "language_server.install_failed";
pub const ERROR_INSTALL_TIMEOUT: &str = "language_server.install_timeout";

/// Installs the server of `spec` into its folder, replacing what was there.
///
/// # Errors
/// Fails with a `language_server.*` key when the server cannot be installed, Node or `npm` is missing, `npm` fails or runs too long.
pub fn install(spec: &ServerSpec, locator: &Locator) -> Result<(), &'static str> {
    let (Some(package), Some(folder)) = (spec.install.as_ref(), locator.install_folder(spec))
    else {
        return Err(ERROR_NOT_INSTALLABLE);
    };
    let node = locator.node().ok_or(ERROR_NODE_MISSING)?;
    let node_dir = node.parent().ok_or(ERROR_NODE_MISSING)?;
    let npm = node_dir.join("npm");

    if !npm.is_file() {
        return Err(ERROR_NPM_MISSING);
    }

    // * A fresh folder each time: a half-finished earlier install must not be mixed with this one.
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).map_err(|_| ERROR_INSTALL_FAILED)?;

    let mut path = vec![node_dir.to_path_buf()];

    path.extend(locator.path_dirs.iter().cloned());

    let mut command = Command::new(&npm);

    command
        .arg("install")
        .arg("--prefix")
        .arg(&folder)
        .args([
            "--no-audit",
            "--no-fund",
            "--ignore-scripts",
            "--loglevel=error",
        ])
        .arg(format!("{}@{}", package.package, package.version))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(path) = joined_path(&path) {
        command.env("PATH", path);
    }

    let result = run_with_timeout(&mut command);

    if result.is_err() {
        let _ = fs::remove_dir_all(&folder);
    }

    result
}

/// Removes the server the app installed; nothing to do when it is not there.
///
/// # Errors
/// Fails with a `language_server.*` key when the server cannot be installed by the app or the folder cannot be removed.
pub fn uninstall(spec: &ServerSpec, locator: &Locator) -> Result<(), &'static str> {
    let folder = locator.install_folder(spec).ok_or(ERROR_NOT_INSTALLABLE)?;

    match fs::remove_dir_all(&folder) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ERROR_INSTALL_FAILED),
    }
}

fn run_with_timeout(command: &mut Command) -> Result<(), &'static str> {
    let mut child = command.spawn().map_err(|_| ERROR_INSTALL_FAILED)?;
    let started = Instant::now();

    loop {
        match child.try_wait().map_err(|_| ERROR_INSTALL_FAILED)? {
            Some(status) if status.success() => return Ok(()),
            Some(_) => return Err(ERROR_INSTALL_FAILED),
            None if started.elapsed() >= INSTALL_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();

                return Err(ERROR_INSTALL_TIMEOUT);
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

#[cfg(test)]
#[path = "../tests/unit/language_server_install.rs"]
mod tests;
