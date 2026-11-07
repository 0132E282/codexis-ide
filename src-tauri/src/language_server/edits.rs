//! Writing the confirmed edits of a rename to the files that are not open in the editor.

use super::LanguageServerError;
use crate::language_server_protocol::{apply_edits, Range};
use crate::workspace::{self, Workspace, MAX_WRITE_BYTES};
use serde::{Deserialize, Serialize};

/// Edits to one file of the project, with the hash of the file they were computed against (`None`: it could not be read then, nothing is written).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEdit {
    pub path: String,
    pub expected_hash: Option<String>,
    pub edits: Vec<TextEditInput>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct TextEditInput {
    pub range: Range,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FailedEdit {
    pub path: String,
    pub error: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct ApplyReport {
    pub written: Vec<String>,
    pub failed: Vec<FailedEdit>,
}

/// Writes the confirmed edits of a rename to the files that are not open in the editor, through the workspace's guards and with the hash each file had when the edits were computed. A file that fails (rules, hash, overlapping edits, size) is reported and the others are still written: nothing is written to a file whose check failed.
pub fn apply_file_edits(workspace: &Workspace, files: &[FileEdit]) -> ApplyReport {
    let mut report = ApplyReport::default();

    for file in files {
        match prepare_edit(workspace, file) {
            Ok((content, expected_hash)) => {
                match workspace.write(&file.path, &content, Some(&expected_hash)) {
                    Ok(_) => report.written.push(file.path.clone()),
                    Err(error) => report.failed.push(FailedEdit {
                        path: file.path.clone(),
                        error: error.message(),
                    }),
                }
            }
            Err(error) => report.failed.push(FailedEdit {
                path: file.path.clone(),
                error,
            }),
        }
    }

    report
}

/// The changed text and the hash to write against.
fn prepare_edit(
    workspace: &Workspace,
    file: &FileEdit,
) -> std::result::Result<(String, String), &'static str> {
    let expected_hash = file
        .expected_hash
        .clone()
        .ok_or(workspace::WorkspaceError::NotFound.message())?;
    let content = workspace
        .read(&file.path)
        .map_err(workspace::WorkspaceError::message)?;

    if workspace::hash(&content) != expected_hash {
        return Err(workspace::WorkspaceError::Conflict.message());
    }

    let edits: Vec<(Range, String)> = file
        .edits
        .iter()
        .map(|edit| (edit.range, edit.text.clone()))
        .collect();
    let changed = apply_edits(&content, &edits).ok_or(LanguageServerError::BadRequest.key())?;

    if changed.len() > MAX_WRITE_BYTES {
        return Err(workspace::WorkspaceError::TooLarge.message());
    }

    Ok((changed, expected_hash))
}
