use crate::attachments::{self, AttachmentError};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// Folder in the app cache where pasted attachments live.
fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("attachments"))
        .map_err(|_| AttachmentError::SaveFailed.to_string())
}

/// Saves a pasted image or file (the raw bytes are the request body, its name is in the `x-name` header, percent-encoded) and returns the path to give the CLI as `@path`.
#[tauri::command]
pub fn attachment_save(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(AttachmentError::Empty.to_string());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    let dir = attachments_dir(&app)?;

    attachments::save(&dir, &name, data)
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
}

/// Bytes of a pasted image or file saved earlier by `attachment_save`, so the chat can show it; paths outside the attachments folder are refused.
#[tauri::command]
pub fn attachment_read(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let dir = attachments_dir(&app)?;

    attachments::read(&dir, Path::new(&path))
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

/// Decodes `%XX` escapes (what `encodeURIComponent` produces); anything malformed is kept as it is.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        let escaped = (bytes[index] == b'%')
            .then(|| text.get(index + 1..index + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());

        match escaped {
            Some(byte) => {
                decoded.push(byte);
                index += 3;
            }
            None => {
                decoded.push(bytes[index]);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn percent_escapes_are_decoded_and_bad_ones_kept() {
        assert_eq!(percent_decode("a%20b.png"), "a b.png");
        assert_eq!(percent_decode("%E1%BA%A2nh.png"), "Ảnh.png");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }
}
