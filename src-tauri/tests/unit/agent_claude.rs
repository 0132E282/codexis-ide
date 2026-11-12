use super::*;
use crate::agent::ASK_MODE;

fn mode_args(mode: Option<&str>) -> Vec<String> {
    ClaudeAgent.turn_args(&TurnOptions {
        session: None,
        model: None,
        mode,
        add_dirs: &[],
        blocked_dirs: &[],
        fork: false,
    })
}

#[test]
fn claude_arguments_follow_the_documented_order() {
    let dirs = vec!["/a".to_string()];
    let args = ClaudeAgent.turn_args(&TurnOptions {
        session: Some("s"),
        model: Some("opus"),
        mode: Some(ASK_MODE),
        add_dirs: &dirs,
        blocked_dirs: &[],
        fork: false,
    });

    assert_eq!(
        args[..5],
        [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages"
        ]
    );
    assert_eq!(args[5], "--append-system-prompt");
    assert_eq!(args[7], "--strict-mcp-config");
    assert_eq!(
        args[8..],
        [
            "--resume",
            "s",
            "--permission-mode",
            "manual",
            "--input-format",
            "stream-json",
            "--permission-prompt-tool",
            "stdio",
            "--model",
            "opus",
            "--add-dir",
            "/a"
        ]
    );
}

#[test]
fn blocked_dirs_become_deny_rules_and_a_prompt_note() {
    let blocked = vec!["/Users/a/b".to_string()];
    let args = ClaudeAgent.turn_args(&TurnOptions {
        session: None,
        model: None,
        mode: None,
        add_dirs: &[],
        blocked_dirs: &blocked,
        fork: false,
    });
    let at = args.iter().position(|arg| arg == "--settings").unwrap();
    let settings: serde_json::Value = serde_json::from_str(&args[at + 1]).unwrap();

    assert_eq!(
        settings["permissions"]["deny"],
        serde_json::json!(["Read(//Users/a/b/**)", "Edit(//Users/a/b/**)"])
    );
    assert!(args[6].contains("Worktree mode"));
}

#[test]
fn no_blocked_dirs_means_no_settings() {
    let args = mode_args(None);

    assert!(!args.iter().any(|arg| arg == "--settings"));
    assert!(!args[6].contains("Worktree mode"));
}

#[test]
fn only_claude_supports_ask_mode_and_api_keys() {
    let keys = vec![("ANTHROPIC_API_KEY", "k".to_string())];

    assert!(ClaudeAgent.supports_ask_mode());
    assert_eq!(ClaudeAgent.turn_environment(keys.clone(), false), keys);
    assert!(ClaudeAgent
        .turn_environment(Vec::new(), true)
        .contains(&("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1".to_string())));
}

#[test]
fn rejected_rate_limit_becomes_a_limit_error() {
    let rejected = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"}}"#;
    let allowed = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#;

    let events = ClaudeAgent.parse_line(rejected);

    assert!(matches!(
        events.as_slice(),
        [Event::Error(message)] if crate::usage::is_limit_error(message)
    ));
    assert!(ClaudeAgent.parse_line(allowed).is_empty());
}

#[test]
fn ask_mode_has_the_cli_ask_this_app_and_a_tool_question_becomes_an_event() {
    let args = mode_args(Some(ASK_MODE));
    let line = r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Write","description":"a.txt","input":{"file_path":"/a.txt"}}}"#;

    assert!(args.contains(&"--permission-prompt-tool".to_string()));
    assert!(!mode_args(Some("auto")).contains(&"--permission-prompt-tool".to_string()));
    assert!(matches!(
        ClaudeAgent.parse_line(line).as_slice(),
        [Event::Permission(json)] if json.contains(r#""id":"r1""#) && json.contains(r#""tool":"Write""#)
    ));
    assert!(crate::agent::is_result_line(
        r#"{"type":"result","result":"x"}"#
    ));
    assert!(!crate::agent::is_result_line(
        r#"{"type":"assistant","text":"result"}"#
    ));
}

#[test]
fn claude_init_gives_session_and_assistant_gives_text() {
    let init = r#"{"type":"system","subtype":"init","session_id":"abc"}"#;
    let reply = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}"#;

    assert_eq!(
        ClaudeAgent.parse_line(init),
        vec![Event::Session("abc".into())]
    );
    assert_eq!(
        ClaudeAgent.parse_line(reply),
        vec![Event::Text("Hi".into())]
    );
}

/// The JSON carried by a tool, sub-agent or result event.
fn payload(event: &Event) -> serde_json::Value {
    match event {
        Event::Tool(json)
        | Event::ToolResult(json)
        | Event::Subagent(json)
        | Event::SubText(json) => serde_json::from_str(json).unwrap(),
        other => panic!("event without a payload: {other:?}"),
    }
}

#[test]
fn claude_partial_text_gives_delta() {
    let delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}"#;
    let other = r#"{"type":"stream_event","event":{"type":"content_block_start"}}"#;

    assert_eq!(
        ClaudeAgent.parse_line(delta),
        vec![Event::Delta("Hel".into())]
    );
    assert!(ClaudeAgent.parse_line(other).is_empty());
}

#[test]
fn claude_tool_call_and_its_result_become_steps() {
    let call = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"b1","name":"Bash","input":{"command":"git status","description":"Show status"}}]}}"#;
    let done = r#"{"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"b1","content":"clean","is_error":false}]}}"#;
    let failed = r#"{"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"b2","content":[{"type":"text","text":"boom"}],"is_error":true}]}}"#;

    let started = ClaudeAgent.parse_line(call);

    assert_eq!(started.len(), 1);
    assert_eq!(
        payload(&started[0]),
        serde_json::json!({"id": "b1", "name": "Bash", "description": "Show status", "input": "git status"})
    );

    let finished = ClaudeAgent.parse_line(done);

    assert_eq!(
        payload(&finished[0]),
        serde_json::json!({"id": "b1", "output": "clean", "error": false})
    );
    assert_eq!(finished[1], Event::SubagentDone("b1".into()));
    assert_eq!(
        payload(&ClaudeAgent.parse_line(failed)[0]),
        serde_json::json!({"id": "b2", "output": "boom", "error": true})
    );
}

#[test]
fn claude_file_edit_carries_the_text_before_and_after() {
    let edit = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"e1","name":"Edit","input":{"file_path":"a.rs","old_string":"x","new_string":"y"}}]}}"#;
    let write = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"w1","name":"Write","input":{"file_path":"b.rs","content":"new"}}]}}"#;

    let edited = payload(&ClaudeAgent.parse_line(edit)[0]);
    let written = payload(&ClaudeAgent.parse_line(write)[0]);

    assert_eq!(
        (edited["before"].as_str(), edited["after"].as_str()),
        (Some("x"), Some("y"))
    );
    assert_eq!(
        (written["before"].as_str(), written["after"].as_str()),
        (Some(""), Some("new"))
    );
}

#[test]
fn claude_exit_plan_mode_request_gives_a_plan_then_the_question() {
    let request = r##"{"type":"control_request","request_id":"r9","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","display_name":"ExitPlanMode","input":{"plan":"# Kế hoạch\n- một","planFilePath":"/home/u/.claude/plans/x.md"},"tool_use_id":"toolu_1"}}"##;
    let events = ClaudeAgent.parse_line(request);

    let [Event::Plan(plan), Event::Permission(question)] = events.as_slice() else {
        panic!("expected a plan then a question, got {events:?}");
    };
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(plan).unwrap(),
        serde_json::json!({"kind": "text", "markdown": "# Kế hoạch\n- một"})
    );
    assert!(question.contains(r#""id":"r9""#) && question.contains(r#""tool":"ExitPlanMode""#));

    // * Other tools and a request without a plan only ask.
    let write = r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"/a"}}}"#;
    let empty = r#"{"type":"control_request","request_id":"r2","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":{}}}"#;

    for line in [write, empty] {
        assert!(matches!(
            ClaudeAgent.parse_line(line).as_slice(),
            [Event::Permission(_)]
        ));
    }

    // * The `assistant` line of the same call is only a step, so the plan is not sent twice; no TodoWrite either.
    let assistant = r##"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"p1","name":"ExitPlanMode","input":{"plan":"# x"}},{"type":"tool_use","id":"p2","name":"TodoWrite","input":{"todos":[{"content":"a","status":"pending"}]}}]}}"##;
    let events = ClaudeAgent.parse_line(assistant);

    assert_eq!(events.len(), 2);
    assert!(events.iter().all(|event| matches!(event, Event::Tool(_))));
}

#[test]
fn claude_task_call_starts_a_subagent_and_its_result_ends_it() {
    let start = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"t1","name":"Task","input":{"subagent_type":"reviewer","description":"Check the diff"}}]}}"#;
    let inner = r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"ls"}}]}}"#;
    let inner_result = r#"{"type":"user","parent_tool_use_id":"t1","message":{"content":[{"type":"tool_result","tool_use_id":"t2"}]}}"#;
    let started = ClaudeAgent.parse_line(start);

    assert_eq!(started.len(), 2);
    assert_eq!(payload(&started[0])["name"], "Task");
    assert_eq!(
        payload(&started[1]),
        serde_json::json!({"id": "t1", "label": "reviewer: Check the diff"})
    );
    // * What happens inside a sub-agent is a step of that sub-agent (it names its parent), not of the main agent, and does not end it.
    let inner_call = ClaudeAgent.parse_line(inner);
    let inner_done = ClaudeAgent.parse_line(inner_result);

    assert_eq!(payload(&inner_call[0])["parent"], "t1");
    assert_eq!(inner_done.len(), 1);
    assert_eq!(payload(&inner_done[0])["parent"], "t1");
}

#[test]
fn a_background_subagent_is_done_at_its_notification_and_the_main_end_of_turn_is_idle() {
    let launched = r#"{"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"Async agent launched successfully."}]}]}}"#;
    let notified = r#"{"type":"system","subtype":"task_notification","task_id":"a1","tool_use_id":"t1","status":"completed"}"#;
    let main_end = r#"{"type":"stream_event","parent_tool_use_id":null,"event":{"type":"message_delta","delta":{"stop_reason":"end_turn"}}}"#;
    let main_tool = r#"{"type":"stream_event","parent_tool_use_id":null,"event":{"type":"message_delta","delta":{"stop_reason":"tool_use"}}}"#;
    let sub_end = r#"{"type":"stream_event","parent_tool_use_id":"t1","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"}}}"#;

    // * Only the step finishes at "launched"; the sub-agent keeps working.
    let launch_events = ClaudeAgent.parse_line(launched);

    assert_eq!(launch_events.len(), 1);
    assert!(matches!(launch_events[0], Event::ToolResult(_)));
    assert_eq!(
        ClaudeAgent.parse_line(notified),
        vec![Event::SubagentDone("t1".to_string())]
    );
    assert_eq!(
        ClaudeAgent.parse_line(main_end),
        vec![Event::Idle(String::new())]
    );
    assert!(ClaudeAgent.parse_line(main_tool).is_empty());
    assert!(ClaudeAgent.parse_line(sub_end).is_empty());
}

#[test]
fn claude_sub_agent_words_stay_out_of_the_answer() {
    let words = r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"content":[{"type":"text","text":"working"}]}}"#;
    let delta = r#"{"type":"stream_event","parent_tool_use_id":"t1","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"wor"}}}"#;
    let spoken = ClaudeAgent.parse_line(words);

    assert_eq!(
        payload(&spoken[0]),
        serde_json::json!({"parent": "t1", "text": "working"})
    );
    assert!(ClaudeAgent.parse_line(delta).is_empty());
}

#[test]
fn claude_error_result_gives_error() {
    let line = r#"{"type":"result","is_error":true,"result":"boom"}"#;

    assert_eq!(
        ClaudeAgent.parse_line(line),
        vec![Event::Error("boom".into())]
    );
}

#[test]
fn a_result_gives_the_last_call_as_context_not_the_turn_total() {
    let multi = include_str!("../../src/agent/fixtures/claude-result-multi-call.jsonl");
    let events = ClaudeAgent.parse_line(multi);
    let [Event::Context(json)] = events.as_slice() else {
        panic!("expected one context event: {events:?}");
    };
    let context: serde_json::Value = serde_json::from_str(json).unwrap();

    // 2 + 26588 + 390 of the last call, not the 60244 cache read summed over 3 calls.
    assert_eq!(context["used"], 26980);
    assert_eq!(context["window"], 1_000_000);
    assert_eq!(context["cacheRead"], 26588);
    assert_eq!(context["output"], 213);
    assert_eq!(context["model"], "claude-opus-5-5");
    assert!((context["percent"].as_f64().unwrap() - 2.698).abs() < 1e-9);

    let single = include_str!("../../src/agent/fixtures/claude-result-single-call.jsonl");
    let events = ClaudeAgent.parse_line(single);
    let [Event::Context(json)] = events.as_slice() else {
        panic!("expected one context event: {events:?}");
    };
    let context: serde_json::Value = serde_json::from_str(json).unwrap();

    assert_eq!(context["used"], 2 + 12098 + 15789);
    assert_eq!(context["model"], "claude-sonnet-5-5");
}

#[test]
fn a_result_without_usage_gives_no_context_and_an_error_result_stays_an_error() {
    assert!(ClaudeAgent
        .parse_line(r#"{"type":"result","is_error":false,"result":"ok"}"#)
        .is_empty());
    let zero = r#"{"type":"result","is_error":false,"usage":{"iterations":[{"input_tokens":0,"output_tokens":0}]},"modelUsage":{}}"#;
    assert!(ClaudeAgent.parse_line(zero).is_empty());
    let failed = r#"{"type":"result","is_error":true,"result":"limit","usage":{"iterations":[{"input_tokens":5}]},"modelUsage":{"m":{}}}"#;
    assert_eq!(
        ClaudeAgent.parse_line(failed),
        vec![Event::Error("limit".into())]
    );
}

#[test]
fn lines_that_are_not_json_are_ignored() {
    assert!(ClaudeAgent.parse_line("not json").is_empty());
}

#[test]
fn claude_tool_result_keeps_base64_pictures() {
    let done = r#"{"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"p1","content":[{"type":"text","text":"shot"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}},{"type":"image","source":{"type":"base64","media_type":"image/svg+xml","data":"BBBB"}}]}]}}"#;
    let events = ClaudeAgent.parse_line(done);

    assert_eq!(
        payload(&events[0])["images"],
        serde_json::json!(["data:image/png;base64,AAAA"])
    );
}
