use super::*;
use crate::language_server_catalog::spec;
use std::path::Path;
use tempfile::TempDir;

fn locator(home: &Path) -> Locator {
    Locator {
        home: home.to_path_buf(),
        platform: None,
        path_dirs: Vec::new(),
        fixed_dirs: Vec::new(),
        extensions: Default::default(),
        installed_dir: Some(home.join("installed")),
    }
}

#[test]
fn a_server_without_a_package_cannot_be_installed() {
    let home = TempDir::new().unwrap();
    let place = locator(home.path());

    assert_eq!(
        install(spec("rust-analyzer").unwrap(), &place),
        Err(ERROR_NOT_INSTALLABLE)
    );
    assert_eq!(
        uninstall(spec("csharp-ls").unwrap(), &place),
        Err(ERROR_NOT_INSTALLABLE)
    );
}

#[test]
fn install_needs_node_and_npm() {
    let home = TempDir::new().unwrap();
    let mut place = locator(home.path());
    let tailwind = spec("tailwindcss").unwrap();

    assert_eq!(install(tailwind, &place), Err(ERROR_NODE_MISSING));

    // * A Node without the `npm` next to it.
    let bin = home.path().join("bin");

    fs::create_dir_all(&bin).unwrap();
    fs::write(bin.join("node"), "#!/bin/sh\n").unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(bin.join("node"), fs::Permissions::from_mode(0o755)).unwrap();
    }

    place.path_dirs = vec![bin];

    assert_eq!(install(tailwind, &place), Err(ERROR_NPM_MISSING));
}

#[test]
fn uninstall_removes_only_the_servers_folder() {
    let home = TempDir::new().unwrap();
    let place = locator(home.path());
    let tailwind = spec("tailwindcss").unwrap();
    let own = place.install_folder(tailwind).unwrap();
    let other = home.path().join("installed/intelephense");

    fs::create_dir_all(own.join("node_modules")).unwrap();
    fs::create_dir_all(&other).unwrap();

    assert_eq!(uninstall(tailwind, &place), Ok(()));
    assert!(!own.exists());
    assert!(other.exists());
    // * Nothing there any more is not an error.
    assert_eq!(uninstall(tailwind, &place), Ok(()));
}
