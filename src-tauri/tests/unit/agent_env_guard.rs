use super::*;
use serde_json::json;

fn tool(id: &str, name: &str, input: Value) -> Event {
    Event::Tool(json!({ "id": id, "name": name, "input": input }).to_string())
}

fn tool_result(id: &str, output: &str) -> Event {
    Event::ToolResult(
        json!({
            "id": id,
            "output": output,
            "error": false,
            "parent": "p1",
            "images": ["data"],
        })
        .to_string(),
    )
}

fn result_json(event: Event) -> Value {
    match event {
        Event::ToolResult(json) => serde_json::from_str(&json).unwrap(),
        other => panic!("expected a tool result, got {other:?}"),
    }
}

#[test]
fn env_paths_are_recognised() {
    for path in [
        ".env",
        "/app/.env",
        "C:\\app\\.env",
        ".env.local",
        "a/b/.env.production",
    ] {
        assert!(is_env_path(path), "{path}");
    }
}

#[test]
fn other_names_are_not_env_paths() {
    for path in [
        "environment.ts",
        ".environment",
        "my.env.ts",
        ".envrc",
        "src/.env/readme.md",
        "",
    ] {
        assert!(!is_env_path(path), "{path}");
    }
}

#[test]
fn read_tools_are_checked_by_path_fields() {
    assert!(tool_reads_env("Read", &json!({ "file_path": "/p/.env" })));
    assert!(tool_reads_env("Grep", &json!({ "pattern": "KEY", "path": ".env.local" })));
    assert!(tool_reads_env("NotebookRead", &json!({ "notebook_path": "x/.env" })));
    assert!(!tool_reads_env("Read", &json!({ "file_path": "src/environment.ts" })));
    assert!(!tool_reads_env("Grep", &json!({ "pattern": ".env", "path": "src" })));
}

#[test]
fn shell_commands_are_checked_by_token() {
    for command in [
        "cat .env",
        "cat \"/p/.env.local\"",
        "echo hi;cat '.env'",
        "grep KEY < .env",
        "(cat .env)|head",
        "true&&cat .env.production",
    ] {
        assert!(
            tool_reads_env("Bash", &json!({ "command": command })),
            "{command}"
        );
    }

    for command in ["cat environment.ts", "ls -a .envrc", "cat my.env.ts"] {
        assert!(
            !tool_reads_env("Bash", &json!({ "command": command })),
            "{command}"
        );
    }
}

#[test]
fn result_of_an_env_read_is_hidden() {
    let guard = EnvGuard::default();
    let call = tool("t1", "Read", json!({ "file_path": ".env" }));

    assert_eq!(guard.filter(call.clone()), call);

    let value = result_json(guard.filter(tool_result("t1", "SECRET=1")));

    assert_eq!(value["output"], HIDDEN_OUTPUT);
    assert_eq!(value["id"], "t1");
    assert_eq!(value["error"], false);
    assert_eq!(value["parent"], "p1");
    assert!(value.get("images").is_none());

    // * The id is forgotten once its result was seen.
    let again = tool_result("t1", "SECRET=1");

    assert_eq!(guard.filter(again.clone()), again);
}

#[test]
fn result_of_another_call_is_unchanged() {
    let guard = EnvGuard::default();

    guard.filter(tool("t1", "Read", json!({ "file_path": ".env" })));

    let other = tool_result("t2", "hello");

    assert_eq!(guard.filter(other.clone()), other);
}

#[test]
fn calls_that_do_not_read_env_are_untouched() {
    let guard = EnvGuard::default();
    let call = tool("t1", "Read", json!({ "file_path": "src/main.rs" }));
    let result = tool_result("t1", "fn main() {}");

    assert_eq!(guard.filter(call.clone()), call);
    assert_eq!(guard.filter(result.clone()), result);

    let text = Event::Text("hi".to_string());

    assert_eq!(guard.filter(text.clone()), text);
}
