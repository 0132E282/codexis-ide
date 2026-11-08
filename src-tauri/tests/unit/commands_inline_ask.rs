use super::inline_prompt;

#[test]
fn inline_prompt_names_file_lines_code_and_question() {
    let prompt = inline_prompt("src/a.rs", 3, 5, "let x = 1;", "Giải thích");

    assert!(prompt.contains("File: src/a.rs (lines 3-5)"));
    assert!(prompt.contains("```\nlet x = 1;\n```"));
    assert!(prompt.ends_with("Question: Giải thích"));
    assert!(inline_prompt("a", 4, 4, "", "q").contains("(line 4)"));
    assert!(inline_prompt("a", 0, 0, "", "q").contains("(whole file)"));
}
