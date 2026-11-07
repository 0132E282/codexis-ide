use super::*;
use serde_json::json;

fn at(line: u32, character: u32) -> Position {
    Position { line, character }
}

#[test]
fn positions_and_ranges_move_by_one_in_both_directions() {
    let position = EditorPosition {
        line_number: 3,
        column: 5,
    };

    assert_eq!(position.to_lsp(), Some(at(2, 4)));
    assert_eq!(
        EditorPosition {
            line_number: 0,
            column: 1
        }
        .to_lsp(),
        None
    );
    assert_eq!(
        EditorPosition {
            line_number: 1,
            column: 0
        }
        .to_lsp(),
        None
    );

    let range = EditorRange {
        start_line_number: 1,
        start_column: 1,
        end_line_number: 2,
        end_column: 4,
    };
    let lsp = range.to_lsp().unwrap();

    assert_eq!(lsp.start, at(0, 0));
    assert_eq!(lsp.end, at(1, 3));
    assert_eq!(EditorRange::from_lsp(lsp), range);
}

#[test]
fn editor_types_use_camel_case_names() {
    let value = json!(EditorRange::from_lsp(Range {
        start: at(0, 0),
        end: at(0, 2)
    }));

    assert_eq!(value["startLineNumber"], 1);
    assert_eq!(value["endColumn"], 3);

    let change: DocumentChange =
        serde_json::from_value(json!({ "range": null, "text": "x" })).unwrap();

    assert_eq!(change.range, None);
}

#[test]
fn markdown_covers_every_shape_a_server_uses() {
    assert_eq!(markdown(&json!("plain")).as_deref(), Some("plain"));
    assert_eq!(
        markdown(&json!({ "kind": "markdown", "value": "**b**" })).as_deref(),
        Some("**b**")
    );
    assert_eq!(
        markdown(&json!({ "kind": "plaintext", "value": "a*b" })).as_deref(),
        Some("a\\*b")
    );
    assert_eq!(
        markdown(&json!({ "language": "rust", "value": "fn a()" })).as_deref(),
        Some("```rust\nfn a()\n```")
    );
    assert_eq!(
        markdown(&json!(["one", { "language": "php", "value": "$a" }])).as_deref(),
        Some("one\n\n```php\n$a\n```")
    );
    assert_eq!(markdown(&json!(5)), None);
}

#[test]
fn a_completion_list_becomes_items_with_resolve_keys() {
    let (answer, originals) = completion(
        &json!({
            "isIncomplete": true,
            "items": [
                {
                    "label": "push",
                    "kind": 2,
                    "detail": "fn push()",
                    "documentation": { "kind": "markdown", "value": "adds" },
                    "insertTextFormat": 2,
                    "textEdit": {
                        "range": { "start": { "line": 0, "character": 2 }, "end": { "line": 0, "character": 4 } },
                        "newText": "push(${1:x})"
                    },
                    "additionalTextEdits": [
                        { "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 0 } }, "newText": "use a;\n" }
                    ],
                    "commitCharacters": ["("],
                    "preselect": true
                },
                { "label": { "label": "pop" } },
                { "kind": 1 }
            ]
        }),
        10,
        7,
    );

    assert_eq!(answer["isIncomplete"], true);
    assert_eq!(originals.len(), 3);

    let items = answer["items"].as_array().unwrap();

    // * The item without a label is dropped.
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["insertText"], "push(${1:x})");
    assert_eq!(items[0]["isSnippet"], true);
    assert_eq!(items[0]["range"]["startColumn"], 3);
    assert_eq!(items[0]["documentation"], "adds");
    assert_eq!(items[0]["additionalTextEdits"][0]["text"], "use a;\n");
    assert_eq!(items[0]["commitCharacters"], json!(["("]));
    assert_eq!(items[0]["preselect"], true);
    assert_eq!(items[0]["resolveKey"], "7:0");
    assert_eq!(items[1]["label"], "pop");
    assert_eq!(items[1]["insertText"], "pop");
    assert_eq!(items[1]["isSnippet"], false);
    assert_eq!(items[1]["range"], Value::Null);
    assert_eq!(items[1]["resolveKey"], "7:1");

    let (array, _) = completion(&json!([{ "label": "a" }]), 10, 1);

    assert_eq!(array["isIncomplete"], false);
    assert_eq!(completion(&Value::Null, 10, 1).0["items"], json!([]));
    assert_eq!(
        completion(&json!([{ "label": "a" }, { "label": "b" }]), 1, 1)
            .1
            .len(),
        1
    );
}

#[test]
fn hover_and_signature_help_are_flattened() {
    assert_eq!(hover(&Value::Null), Value::Null);
    assert_eq!(hover(&json!({ "contents": "  " })), Value::Null);

    let answer = hover(&json!({
        "contents": { "kind": "markdown", "value": "docs" },
        "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 3 } }
    }));

    assert_eq!(answer["contents"], "docs");
    assert_eq!(answer["range"]["startLineNumber"], 2);

    assert_eq!(signature_help(&Value::Null), Value::Null);
    assert_eq!(signature_help(&json!({ "signatures": [] })), Value::Null);

    let help = signature_help(&json!({
        "signatures": [{
            "label": "f(a, b)",
            "documentation": "doc",
            "parameters": [{ "label": "a" }, { "label": [3, 4], "documentation": { "kind": "markdown", "value": "b!" } }]
        }],
        "activeSignature": 0,
        "activeParameter": 1
    }));

    assert_eq!(help["signatures"][0]["documentation"], "doc");
    assert_eq!(help["signatures"][0]["parameters"][0]["label"], "a");
    assert_eq!(
        help["signatures"][0]["parameters"][1]["label"],
        json!([3, 4])
    );
    assert_eq!(
        help["signatures"][0]["parameters"][1]["documentation"],
        "b!"
    );
    assert_eq!(help["activeParameter"], 1);
}

#[test]
fn text_edits_become_editor_edits() {
    let edits = text_edits(&json!([
        { "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 1 } }, "newText": "x" },
        { "nothing": true }
    ]));

    assert_eq!(edits.as_array().unwrap().len(), 1);
    assert_eq!(edits[0]["text"], "x");
    assert_eq!(edits[0]["range"]["endColumn"], 2);
    assert_eq!(text_edits(&Value::Null), json!([]));
}

#[test]
fn the_word_at_a_position_counts_utf16_columns() {
    let text = "let héllo = 1;\nsecond $line";
    let (range, word) = word_at(text, at(0, 6)).unwrap();

    assert_eq!(word, "héllo");
    assert_eq!((range.start.character, range.end.character), (4, 9));

    // * At the end of a word still counts as on it.
    assert_eq!(word_at(text, at(0, 9)).unwrap().1, "héllo");
    assert_eq!(word_at(text, at(1, 8)).unwrap().1, "line");
    // * Between two non-word characters there is no word.
    assert_eq!(word_at("a  b", at(0, 2)), None);
    assert_eq!(word_at("a = ;", at(0, 3)), None);
    assert_eq!(word_at("", at(0, 0)), None);

    let (range, word) = word_at("😀ab", at(0, 3)).unwrap();

    assert_eq!(word, "ab");
    assert_eq!((range.start.character, range.end.character), (2, 4));
}

#[test]
fn prepare_rename_takes_the_server_answer_or_the_word() {
    let text = "let name = 1;";

    assert_eq!(prepare_rename(&Value::Null, text, at(0, 5)), Value::Null);

    let with_placeholder = prepare_rename(
        &json!({
            "range": { "start": { "line": 0, "character": 4 }, "end": { "line": 0, "character": 8 } },
            "placeholder": "name!"
        }),
        text,
        at(0, 5),
    );

    assert_eq!(with_placeholder["placeholder"], "name!");
    assert_eq!(with_placeholder["range"]["startColumn"], 5);

    let bare = prepare_rename(
        &json!({ "start": { "line": 0, "character": 4 }, "end": { "line": 0, "character": 8 } }),
        text,
        at(0, 5),
    );

    assert_eq!(bare["placeholder"], "name");

    let default = prepare_rename(&json!({ "defaultBehavior": true }), text, at(0, 5));

    assert_eq!(default["placeholder"], "name");
    assert_eq!(default["range"]["endColumn"], 9);
}
