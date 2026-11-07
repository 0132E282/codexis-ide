use super::*;

#[test]
fn codex_email_is_read_from_the_id_token() {
    // payload {"email":"a@b.c"}
    let auth =
        r#"{"tokens": {"id_token": "x.eyJlbWFpbCI6ImFAYi5jIn0.y", "access_token": "secret"}}"#;

    assert_eq!(id_token_email(auth), Some("a@b.c".to_string()));
    assert_eq!(id_token_email("{}"), None);
    assert_eq!(id_token_email("not json"), None);
}

#[test]
fn base64_url_decodes_unpadded_text() {
    assert_eq!(decode_base64_url("Zm9vYmFy"), Some(b"foobar".to_vec()));
    assert_eq!(decode_base64_url("Zg"), Some(b"f".to_vec()));
    assert_eq!(decode_base64_url("a+b"), None);
}
