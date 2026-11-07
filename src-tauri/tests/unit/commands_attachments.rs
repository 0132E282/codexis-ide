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
