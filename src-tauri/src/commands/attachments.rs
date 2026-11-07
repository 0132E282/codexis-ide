use super::activity::CHAT_IMAGE_STORE_FAILED;
use super::state::AppState;
use crate::activity::{self, ActivityStore};
use crate::attachments::{self, AttachmentError};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

/// Folder in the app cache where pasted attachments live.
fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("attachments"))
        .map_err(|_| AttachmentError::SaveFailed.to_string())
}

/// Saves a pasted image or file (the raw bytes are the request body, its name is in the `x-name` header, percent-encoded) and returns the path to give the CLI as `@path`. A picture is also kept in the database to look at again, under the project named by the optional `x-root` header (percent-encoded; the open project when absent) and the conversation of the optional `x-conversation` header; a failure there is reported as the `chat-image-store-failed` event and never fails the save.
#[tauri::command]
pub fn attachment_save(
    app: AppHandle,
    state: State<AppState>,
    request: Request<'_>,
) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(AttachmentError::Empty.to_string());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|value| value.to_str().ok())
        .map(|value| percent_decode(truncate_to_boundary(value, attachments::MAX_RAW_NAME_BYTES)))
        .unwrap_or_default();
    let dir = attachments_dir(&app)?;
    let path = attachments::save(&dir, &name, data).map_err(|error| error.to_string())?;

    if activity::image_mime(data).is_some() {
        let header = |key: &str| {
            request
                .headers()
                .get(key)
                .and_then(|value| value.to_str().ok())
                .map(|value| {
                    percent_decode(truncate_to_boundary(value, attachments::MAX_RAW_NAME_BYTES))
                })
        };
        let conversation = header("x-conversation").and_then(|value| value.parse::<i64>().ok());
        let stored = state
            .workspace_key(header("x-root").as_deref())
            .and_then(|root| {
                app.try_state::<ActivityStore>()
                    .ok_or_else(|| "activity.save_failed".to_string())
                    .and_then(|store| {
                        store
                            .save_image(&root, conversation, &name, data)
                            .map_err(|error| error.to_string())
                    })
            });

        if let Err(error) = stored {
            let _ = app.emit(
                CHAT_IMAGE_STORE_FAILED,
                serde_json::json!({ "error": error }),
            );
        }
    }

    Ok(path.display().to_string())
}

/// Bytes of a pasted image or file saved earlier by `attachment_save`, so the chat can show it; paths outside the attachments folder are refused.
#[tauri::command]
pub fn attachment_read(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let dir = attachments_dir(&app)?;

    attachments::read(&dir, Path::new(&path))
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

/// At most `limit` bytes of `text`, cut on a character boundary.
fn truncate_to_boundary(text: &str, limit: usize) -> &str {
    let mut end = limit.min(text.len());

    while !text.is_char_boundary(end) {
        end -= 1;
    }

    &text[..end]
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
    use super::{percent_decode, truncate_to_boundary};

    #[test]
    fn percent_escapes_are_decoded_and_bad_ones_kept() {
        assert_eq!(percent_decode("a%20b.png"), "a b.png");
        assert_eq!(percent_decode("%E1%BA%A2nh.png"), "Ảnh.png");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn long_names_are_cut_on_a_character_boundary() {
        assert_eq!(truncate_to_boundary("abc", 10), "abc");
        assert_eq!(truncate_to_boundary("abcd", 2), "ab");
        assert_eq!(truncate_to_boundary("\u{1EA1}\u{1EA1}", 4), "\u{1EA1}");
    }
}
