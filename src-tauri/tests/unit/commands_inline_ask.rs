use super::inline_prompt;

#[test]
fn inline_prompt_names_file_lines_code_and_question() {
    let prompt = inline_prompt("src/a.rs", 3, 5, "let x = 1;", "Giải thích");

    assert!(prompt.contains("Tệp: src/a.rs (dòng 3-5)"));
    assert!(prompt.contains("```\nlet x = 1;\n```"));
    assert!(prompt.ends_with("Câu hỏi: Giải thích"));
    assert!(inline_prompt("a", 4, 4, "", "q").contains("(dòng 4)"));
    assert!(inline_prompt("a", 0, 0, "", "q").contains("(cả tệp)"));
}
