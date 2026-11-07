use super::*;

#[test]
fn github_details_give_account_and_protocol() {
    let text = "  ✓ Logged in to github.com account octocat (keyring)\n  - Git operations protocol: https\n  - Token: gho_************\n";
    let rows = github_details(text, true);

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].value, "octocat");
    assert_eq!(rows[1].value, "https");
    assert!(rows.iter().all(|row| !row.value.contains("gho_")));
    assert!(github_details(text, false).len() <= 1);
}

#[test]
fn github_account_is_read_from_the_status_line() {
    let text = "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n";

    assert_eq!(github_account(text), Some("octocat".to_string()));
    assert_eq!(github_account("You are not logged in"), None);
}

#[test]
fn device_code_is_found_in_the_prompt_line() {
    assert_eq!(
        device_code("! First copy your one-time code: AB12-CD34"),
        Some("AB12-CD34".to_string())
    );
    assert_eq!(device_code("Press Enter to open github.com"), None);
    assert_eq!(device_code("ab12-cd34"), None);
}

#[test]
fn base64_matches_the_standard_examples() {
    assert_eq!(base64_encode(b""), "");
    assert_eq!(base64_encode(b"f"), "Zg==");
    assert_eq!(base64_encode(b"fo"), "Zm8=");
    assert_eq!(base64_encode(b"foo"), "Zm9v");
    assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
}

#[test]
fn image_type_is_read_from_the_first_bytes() {
    assert_eq!(
        image_mime(&[0x89, b'P', b'N', b'G', 0, 0]),
        Some("image/png")
    );
    assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
    assert_eq!(image_mime(b"GIF89a"), Some("image/gif"));
    assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
    assert_eq!(image_mime(b"<html>"), None);
}

#[test]
fn only_githubs_image_host_is_downloaded() {
    assert_eq!(avatar_data_url("https://example.com/a.png"), None);
    assert_eq!(avatar_data_url(""), None);
}
