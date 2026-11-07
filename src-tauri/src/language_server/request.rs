//! What the editor asks of a server: the change events it sends, the kinds of request and their options, and how each becomes an LSP message.

use super::{LanguageServerError, Result, MAX_NEW_NAME_CHARS};
use crate::language_server_protocol::{Position, Range};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// One change event from the editor: a range replaced by `text`, or the whole text when there is no range.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContentChange {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    pub text: String,
}

/// What a request asks the server for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestKind {
    Completion,
    CompletionResolve,
    Hover,
    SignatureHelp,
    Definition,
    PrepareRename,
    Rename,
    Formatting,
}

/// The extra inputs of a request; only those of its kind are read.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RequestOptions {
    /// LSP `CompletionTriggerKind` / `SignatureHelpTriggerKind` (1 invoked, 2 trigger character, 3 content change or incomplete).
    pub trigger_kind: Option<u8>,
    pub trigger_character: Option<String>,
    pub is_retrigger: bool,
    /// Which item of the last completion to resolve.
    pub resolve_key: Option<String>,
    pub new_name: Option<String>,
    pub tab_size: Option<u32>,
    pub insert_spaces: Option<bool>,
}

impl RequestOptions {
    /// The LSP context object for completion and signature help.
    fn context(&self, signature: bool) -> Result<Option<Value>> {
        let Some(kind) = self.trigger_kind else {
            return Ok(None);
        };

        if !(1..=3).contains(&kind) {
            return Err(LanguageServerError::BadRequest);
        }

        let mut context = json!({ "triggerKind": kind });

        if let Some(character) = self.trigger_character.as_deref().filter(|c| !c.is_empty()) {
            context["triggerCharacter"] = json!(character);
        }

        if signature {
            context["isRetrigger"] = json!(self.is_retrigger);
        }

        Ok(Some(context))
    }
}

impl RequestKind {
    /// Whether the capabilities the server announced include what this request needs.
    pub(super) fn is_supported(self, capabilities: &Value) -> bool {
        let provides = |name: &str| {
            capabilities
                .get(name)
                .is_some_and(|value| !matches!(value, Value::Null | Value::Bool(false)))
        };

        match self {
            Self::Completion => provides("completionProvider"),
            Self::CompletionResolve => {
                capabilities.pointer("/completionProvider/resolveProvider")
                    == Some(&Value::Bool(true))
            }
            Self::Hover => provides("hoverProvider"),
            Self::SignatureHelp => provides("signatureHelpProvider"),
            Self::Definition => provides("definitionProvider"),
            Self::PrepareRename | Self::Rename => provides("renameProvider"),
            Self::Formatting => provides("documentFormattingProvider"),
        }
    }

    /// The LSP method and parameters for a document at `uri`. `resolving` is the original completion item for `CompletionResolve`.
    pub(super) fn build(
        self,
        uri: &str,
        position: Option<Position>,
        options: &RequestOptions,
        resolving: Option<Value>,
    ) -> Result<(&'static str, Value)> {
        let document = json!({ "uri": uri });
        let at = || position.ok_or(LanguageServerError::BadRequest);

        Ok(match self {
            Self::Completion => {
                let mut params = json!({ "textDocument": document, "position": at()? });

                if let Some(context) = options.context(false)? {
                    params["context"] = context;
                }

                ("textDocument/completion", params)
            }
            Self::CompletionResolve => (
                "completionItem/resolve",
                resolving.ok_or(LanguageServerError::BadRequest)?,
            ),
            Self::Hover => (
                "textDocument/hover",
                json!({ "textDocument": document, "position": at()? }),
            ),
            Self::SignatureHelp => {
                let mut params = json!({ "textDocument": document, "position": at()? });

                if let Some(context) = options.context(true)? {
                    params["context"] = context;
                }

                ("textDocument/signatureHelp", params)
            }
            Self::Definition => (
                "textDocument/definition",
                json!({ "textDocument": document, "position": at()? }),
            ),
            Self::PrepareRename => (
                "textDocument/prepareRename",
                json!({ "textDocument": document, "position": at()? }),
            ),
            Self::Rename => {
                let name = options
                    .new_name
                    .as_deref()
                    .ok_or(LanguageServerError::BadRequest)?;

                if name.is_empty()
                    || name.chars().count() > MAX_NEW_NAME_CHARS
                    || name.chars().any(char::is_control)
                {
                    return Err(LanguageServerError::BadRequest);
                }

                (
                    "textDocument/rename",
                    json!({ "textDocument": document, "position": at()?, "newName": name }),
                )
            }
            Self::Formatting => {
                let tab_size = options.tab_size.unwrap_or(4);

                if !(1..=16).contains(&tab_size) {
                    return Err(LanguageServerError::BadRequest);
                }

                (
                    "textDocument/formatting",
                    json!({
                        "textDocument": document,
                        "options": { "tabSize": tab_size, "insertSpaces": options.insert_spaces.unwrap_or(true) },
                    }),
                )
            }
        })
    }
}
