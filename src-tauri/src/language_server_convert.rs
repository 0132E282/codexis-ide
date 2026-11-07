//! Turns what language servers speak (LSP, zero-based, many result shapes) into what the editor takes (Monaco: one-based lines and columns, one shape per answer), and back.
//!
//! The front end never sees raw LSP. Columns are UTF-16 code units on both sides, so a position only moves by one.

use crate::language_server_protocol::{offset_of, Position, Range};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// A position as Monaco gives it: one-based line and UTF-16 column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorPosition {
    pub line_number: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorRange {
    pub start_line_number: u32,
    pub start_column: u32,
    pub end_line_number: u32,
    pub end_column: u32,
}

/// A replacement of a range, in editor coordinates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextEdit {
    pub range: EditorRange,
    pub text: String,
}

/// One change as Monaco reports it; no range means the whole text is replaced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentChange {
    pub range: Option<EditorRange>,
    pub text: String,
}

impl EditorPosition {
    /// The protocol position; `None` for a line or column below 1.
    pub fn to_lsp(self) -> Option<Position> {
        Some(Position {
            line: self.line_number.checked_sub(1)?,
            character: self.column.checked_sub(1)?,
        })
    }
}

impl EditorRange {
    pub fn to_lsp(self) -> Option<Range> {
        Some(Range {
            start: EditorPosition {
                line_number: self.start_line_number,
                column: self.start_column,
            }
            .to_lsp()?,
            end: EditorPosition {
                line_number: self.end_line_number,
                column: self.end_column,
            }
            .to_lsp()?,
        })
    }

    pub fn from_lsp(range: Range) -> Self {
        Self {
            start_line_number: range.start.line.saturating_add(1),
            start_column: range.start.character.saturating_add(1),
            end_line_number: range.end.line.saturating_add(1),
            end_column: range.end.character.saturating_add(1),
        }
    }
}

/// The range of a protocol value (`{ start, end }`) in editor coordinates.
pub fn editor_range(value: &Value) -> Option<EditorRange> {
    Range::deserialize(value).ok().map(EditorRange::from_lsp)
}

fn range_value(value: &Value) -> Value {
    editor_range(value).map_or(Value::Null, |range| json!(range))
}

fn text_of(value: &Value) -> Option<String> {
    value.as_str().map(str::to_string)
}

/// `MarkupContent`, `MarkedString`, an array of them or a plain string, as one markdown string.
pub fn markdown(value: &Value) -> Option<String> {
    let text = match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(markdown)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        Value::Object(object) => {
            let text = object
                .get("value")
                .and_then(Value::as_str)
                .unwrap_or_default();

            match (
                object.get("language").and_then(Value::as_str),
                object.get("kind").and_then(Value::as_str),
            ) {
                // * `MarkedString` with a language is a code block.
                (Some(language), _) => format!("```{language}\n{text}\n```"),
                // * Plain text must not be read as markdown.
                (None, Some("plaintext")) => escape_markdown(text),
                _ => text.to_string(),
            }
        }
        _ => return None,
    };

    Some(text)
}

fn escape_markdown(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());

    for character in text.chars() {
        if "\\`*_{}[]<>()#+-.!|".contains(character) {
            escaped.push('\\');
        }

        escaped.push(character);
    }

    escaped
}

fn markdown_or_null(value: Option<&Value>) -> Value {
    value
        .and_then(markdown)
        .filter(|text| !text.is_empty())
        .map_or(Value::Null, Value::String)
}

/// Completion answer: `{ isIncomplete, items }` and the original items, kept so one can be resolved later.
///
/// Takes the answer by value: the kept items are moved out of it, not deep-copied (up to `max_items` of them).
pub fn completion(result: Value, max_items: usize, generation: u64) -> (Value, Vec<Value>) {
    let (is_incomplete, list) = match result {
        Value::Array(items) => (false, items),
        Value::Object(mut object) => (
            object
                .get("isIncomplete")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            match object.remove("items") {
                Some(Value::Array(items)) => items,
                _ => Vec::new(),
            },
        ),
        _ => (false, Vec::new()),
    };
    let originals: Vec<Value> = list.into_iter().take(max_items).collect();
    let items: Vec<Value> = originals
        .iter()
        .enumerate()
        .filter_map(|(index, item)| completion_item(item, Some(format!("{generation}:{index}"))))
        .collect();

    (
        json!({ "isIncomplete": is_incomplete, "items": items }),
        originals,
    )
}

/// One completion item. `resolve_key` is put in as given.
pub fn completion_item(item: &Value, resolve_key: Option<String>) -> Option<Value> {
    let label = match item.get("label")? {
        Value::String(label) => label.clone(),
        other => other.get("label")?.as_str()?.to_string(),
    };
    let edit = item.get("textEdit");
    let edit_range = edit.and_then(|edit| edit.get("range").or_else(|| edit.get("insert")));
    let insert_text = edit
        .and_then(|edit| edit.get("newText"))
        .and_then(Value::as_str)
        .or_else(|| item.get("insertText").and_then(Value::as_str))
        .unwrap_or(&label)
        .to_string();
    let additional: Vec<Value> = item
        .get("additionalTextEdits")
        .and_then(Value::as_array)
        .map(|edits| edits.iter().filter_map(text_edit).collect())
        .unwrap_or_default();
    let commit_characters: Vec<String> = item
        .get("commitCharacters")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(text_of).collect())
        .unwrap_or_default();

    Some(json!({
        "label": label,
        "kind": item.get("kind").and_then(Value::as_u64),
        "detail": item.get("detail").and_then(Value::as_str),
        "documentation": markdown_or_null(item.get("documentation")),
        "insertText": insert_text,
        "isSnippet": item.get("insertTextFormat").and_then(Value::as_u64) == Some(2),
        "range": edit_range.map_or(Value::Null, range_value),
        "additionalTextEdits": additional,
        "sortText": item.get("sortText").and_then(Value::as_str),
        "filterText": item.get("filterText").and_then(Value::as_str),
        "commitCharacters": commit_characters,
        "preselect": item.get("preselect").and_then(Value::as_bool).unwrap_or(false),
        "resolveKey": resolve_key,
    }))
}

/// `{ contents, range } | null` for a hover answer.
pub fn hover(result: &Value) -> Value {
    let Some(contents) = result.get("contents").and_then(markdown) else {
        return Value::Null;
    };

    if contents.trim().is_empty() {
        return Value::Null;
    }

    json!({
        "contents": contents,
        "range": result.get("range").map_or(Value::Null, range_value),
    })
}

/// Signature help answer, or `null` when the server has none.
pub fn signature_help(result: &Value) -> Value {
    let Some(signatures) = result.get("signatures").and_then(Value::as_array) else {
        return Value::Null;
    };

    if signatures.is_empty() {
        return Value::Null;
    }

    let list: Vec<Value> = signatures
        .iter()
        .filter_map(|signature| {
            let label = signature.get("label")?.as_str()?;
            let parameters: Vec<Value> = signature
                .get("parameters")
                .and_then(Value::as_array)
                .map(|parameters| {
                    parameters
                        .iter()
                        .filter_map(|parameter| {
                            let label = match parameter.get("label")? {
                                Value::String(label) => json!(label),
                                pair @ Value::Array(_) => pair.clone(),
                                _ => return None,
                            };

                            Some(json!({
                                "label": label,
                                "documentation": markdown_or_null(parameter.get("documentation")),
                            }))
                        })
                        .collect()
                })
                .unwrap_or_default();

            Some(json!({
                "label": label,
                "documentation": markdown_or_null(signature.get("documentation")),
                "parameters": parameters,
            }))
        })
        .collect();
    let index = |name: &str| result.get(name).and_then(Value::as_u64).unwrap_or(0);

    json!({
        "signatures": list,
        "activeSignature": index("activeSignature"),
        "activeParameter": index("activeParameter"),
    })
}

/// A `TextEdit` (or an annotated one) in editor form.
pub fn text_edit(edit: &Value) -> Option<Value> {
    Some(json!({
        "range": range_value(edit.get("range")?),
        "text": edit.get("newText")?.as_str()?,
    }))
}

/// A formatting answer as a list of editor edits.
pub fn text_edits(result: &Value) -> Value {
    Value::Array(
        result
            .as_array()
            .map(|edits| edits.iter().filter_map(text_edit).collect())
            .unwrap_or_default(),
    )
}

/// The word under a position (letters, digits, `_`), as its range and text. `None` when the position is not on a word.
pub fn word_at(text: &str, position: Position) -> Option<(Range, String)> {
    let line_start = offset_of(
        text,
        Position {
            line: position.line,
            character: 0,
        },
    );
    let rest = &text[line_start..];
    let line = rest.split(['\n', '\r']).next().unwrap_or_default();
    let is_word = |character: char| character.is_alphanumeric() || character == '_';
    // (utf-16 column, char) for every character of the line.
    let mut columns: Vec<(u32, char)> = Vec::new();
    let mut column = 0u32;

    for character in line.chars() {
        columns.push((column, character));
        column += character.len_utf16() as u32;
    }

    let line_end = column;
    let cursor = position.character.min(line_end);
    let at = columns
        .iter()
        .position(|(start, _)| *start >= cursor)
        .unwrap_or(columns.len());
    // * The word may end right at the cursor (`name|`), as in an editor.
    let inside = at < columns.len() && is_word(columns[at].1);
    let before = at > 0 && is_word(columns[at - 1].1);

    if !inside && !before {
        return None;
    }

    let mut first = if inside { at } else { at - 1 };
    let mut last = first;

    while first > 0 && is_word(columns[first - 1].1) {
        first -= 1;
    }

    while last + 1 < columns.len() && is_word(columns[last + 1].1) {
        last += 1;
    }

    let start = columns[first].0;
    let end = columns[last].0 + columns[last].1.len_utf16() as u32;
    let word: String = columns[first..=last]
        .iter()
        .map(|(_, character)| character)
        .collect();

    Some((
        Range {
            start: Position {
                line: position.line,
                character: start,
            },
            end: Position {
                line: position.line,
                character: end,
            },
        },
        word,
    ))
}

/// `{ range, placeholder }` for a `prepareRename` answer, `null` when the server says nothing can be renamed here. A bare range takes its text as placeholder; `defaultBehavior` (or no usable range) falls back to the word at the position.
pub fn prepare_rename(result: &Value, text: &str, position: Position) -> Value {
    if result.is_null() {
        return Value::Null;
    }

    let from_word = || {
        word_at(text, position).map_or(
            Value::Null,
            |(range, word)| json!({ "range": EditorRange::from_lsp(range), "placeholder": word }),
        )
    };
    let range = result
        .get("range")
        .filter(|_| result.get("placeholder").is_some())
        .or_else(|| result.get("start").map(|_| result))
        .or_else(|| result.get("range"));
    let Some(range) = range.and_then(|range| Range::deserialize(range).ok()) else {
        return from_word();
    };
    let placeholder = result
        .get("placeholder")
        .and_then(Value::as_str)
        .map_or_else(
            || {
                let start = offset_of(text, range.start);
                let end = offset_of(text, range.end).max(start);

                text[start..end].to_string()
            },
            str::to_string,
        );

    json!({ "range": EditorRange::from_lsp(range), "placeholder": placeholder })
}

#[cfg(test)]
#[path = "../tests/unit/language_server_convert.rs"]
mod tests;
