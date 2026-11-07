use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::JoinHandle;

/// Serves one canned answer on a random loopback port and returns what the client sent.
fn serve(answer: Vec<u8>) -> (String, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut received = Vec::new();
        let mut buffer = [0u8; 1024];

        loop {
            let count = stream.read(&mut buffer).unwrap_or(0);
            received.extend_from_slice(&buffer[..count]);
            let text = String::from_utf8_lossy(&received).to_string();

            if let Some(split) = text.find("\r\n\r\n") {
                let length = text[..split]
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);

                if received.len() >= split + 4 + length {
                    break;
                }
            }

            if count == 0 {
                break;
            }
        }

        let _ = stream.write_all(&answer);

        String::from_utf8_lossy(&received).to_string()
    });

    (url, handle)
}

fn wav() -> Vec<u8> {
    let mut bytes = b"RIFF\x24\x00\x00\x00WAVEfmt ".to_vec();
    bytes.extend_from_slice(&[0u8; 32]);
    bytes
}

fn http(headers: &str, body: &[u8]) -> Vec<u8> {
    let mut answer = format!("HTTP/1.1 {headers}\r\n\r\n").into_bytes();
    answer.extend_from_slice(body);
    answer
}

#[test]
fn reads_a_content_length_body_and_sends_the_request() {
    let audio = wav();
    let (url, server) = serve(http(
        &format!(
            "200 OK\r\nContent-Type: audio/wav\r\nContent-Length: {}",
            audio.len()
        ),
        &audio,
    ));

    assert_eq!(synthesize(&url, "minh", "Xin chào", None).unwrap(), audio);

    let request = server.join().unwrap();
    assert!(request.starts_with("POST /v1/audio/speech HTTP/1.1\r\n"));
    assert!(request.contains("Host: 127.0.0.1:"));
    assert!(request.contains(r#""input":"Xin chào""#));
    assert!(request.contains(r#""voice":"minh""#));
    assert!(request.contains(r#""response_format":"wav""#));
}

#[test]
fn leaves_the_voice_out_when_empty() {
    let audio = wav();
    let (url, server) = serve(http(
        &format!("200 OK\r\nContent-Length: {}", audio.len()),
        &audio,
    ));

    synthesize(&url, "", "Chào", None).unwrap();
    assert!(!server.join().unwrap().contains("\"voice\""));
}

#[test]
fn sends_the_speed_only_when_it_is_not_normal() {
    let audio = wav();
    let answer = http(
        &format!("200 OK\r\nContent-Length: {}", audio.len()),
        &audio,
    );
    let (url, server) = serve(answer.clone());

    synthesize(&url, "", "Chào", Some(90)).unwrap();
    assert!(server.join().unwrap().contains(r#""speed":0.9"#));

    let (url, server) = serve(answer);

    synthesize(&url, "", "Chào", Some(100)).unwrap();
    assert!(!server.join().unwrap().contains("speed"));
    assert_eq!(
        synthesize(&url, "", "Chào", Some(300)),
        Err(SpeechError::BadResponse)
    );
}

#[test]
fn reads_a_chunked_body() {
    let audio = wav();
    let (first, second) = audio.split_at(20);
    let mut body = Vec::new();

    for part in [first, second] {
        body.extend_from_slice(format!("{:x}\r\n", part.len()).as_bytes());
        body.extend_from_slice(part);
        body.extend_from_slice(b"\r\n");
    }

    body.extend_from_slice(b"0\r\n\r\n");

    let (url, _server) = serve(http("200 OK\r\nTransfer-Encoding: chunked", &body));

    assert_eq!(synthesize(&url, "", "Chào", None).unwrap(), audio);
}

#[test]
fn reads_a_body_that_ends_with_the_connection() {
    let audio = wav();
    let (url, _server) = serve(http("200 OK", &audio));

    assert_eq!(synthesize(&url, "", "Chào", None).unwrap(), audio);
}

#[test]
fn refuses_hosts_that_are_not_loopback() {
    for url in [
        "http://example.com",
        "http://192.168.1.5:8000",
        "http://0.0.0.0:8000",
        "https://127.0.0.1:8000",
        "http://127.0.0.1.evil.com:8000",
        "http://user@127.0.0.1:8000",
        "http://127.0.0.1:8000/path",
        "http://127.0.0.1:0",
        "http://127.0.0.1:99999",
        "http://[::2]:8000",
        "127.0.0.1:8000",
        "",
    ] {
        assert_eq!(
            synthesize(url, "", "Chào", None),
            Err(SpeechError::BadUrl),
            "{url}"
        );
        assert_eq!(status(url), Err(SpeechError::BadUrl), "{url}");
    }

    for url in [
        "http://127.0.0.1:8000",
        "http://localhost:8000/",
        "HTTP://LOCALHOST",
        "http://[::1]:8000",
    ] {
        assert!(is_loopback_url(url), "{url}");
    }
}

#[test]
fn refuses_redirects() {
    let (url, _server) = serve(http(
        "302 Found\r\nLocation: http://example.com/\r\nContent-Length: 0",
        b"",
    ));

    assert_eq!(
        synthesize(&url, "", "Chào", None),
        Err(SpeechError::BadResponse)
    );
}

#[test]
fn refuses_answers_over_the_limit() {
    let audio = wav();
    let (url, _server) = serve(http(
        &format!("200 OK\r\nContent-Length: {}", audio.len()),
        &audio,
    ));

    assert_eq!(
        synthesize_limited(&url, "", "Chào", None, 16),
        Err(SpeechError::TooLarge)
    );

    let mut body = format!("{:x}\r\n", audio.len()).into_bytes();
    body.extend_from_slice(&audio);
    body.extend_from_slice(b"\r\n0\r\n\r\n");
    let (url, _server) = serve(http("200 OK\r\nTransfer-Encoding: chunked", &body));

    assert_eq!(
        synthesize_limited(&url, "", "Chào", None, 16),
        Err(SpeechError::TooLarge)
    );

    let (url, _server) = serve(http("200 OK", &audio));

    assert_eq!(
        synthesize_limited(&url, "", "Chào", None, 16),
        Err(SpeechError::TooLarge)
    );
}

#[test]
fn refuses_answers_that_are_not_wav() {
    let (url, _server) = serve(http(
        "200 OK\r\nContent-Type: text/html\r\nContent-Length: 6",
        b"<html>",
    ));

    assert_eq!(
        synthesize(&url, "", "Chào", None),
        Err(SpeechError::BadResponse)
    );
}

#[test]
fn refuses_error_status_and_garbage() {
    let (url, _server) = serve(http("500 Oops\r\nContent-Length: 0", b""));
    assert_eq!(
        synthesize(&url, "", "Chào", None),
        Err(SpeechError::BadResponse)
    );

    let (url, _server) = serve(b"not http at all\r\n\r\n".to_vec());
    assert_eq!(
        synthesize(&url, "", "Chào", None),
        Err(SpeechError::BadResponse)
    );
}

#[test]
fn refuses_text_that_is_too_long_or_empty() {
    let url = "http://127.0.0.1:9";
    let long = "a".repeat(MAX_TEXT_CHARS + 1);

    assert_eq!(
        synthesize(url, "", &long, None),
        Err(SpeechError::TextTooLong)
    );
    assert_eq!(
        synthesize(url, "", "  ", None),
        Err(SpeechError::BadResponse)
    );
}

#[test]
fn an_unreachable_server_is_unreachable_or_not_reachable() {
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    let url = format!("http://127.0.0.1:{port}");

    assert_eq!(
        synthesize(&url, "", "Chào", None),
        Err(SpeechError::Unreachable)
    );
    assert_eq!(
        status(&url),
        Ok(Status {
            reachable: false,
            voices: Vec::new()
        })
    );
}

#[test]
fn status_lists_voices_in_common_shapes() {
    let health = |body: &str| {
        http(
            &format!("200 OK\r\nContent-Length: {}", body.len()),
            body.as_bytes(),
        )
    };
    let voice = |id: &str, name: &str| Voice {
        id: id.into(),
        name: name.into(),
        region: String::new(),
    };

    // One connection per request, so the fake serves health, then voices, on a loop.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let answers = vec![
        health("{}"),
        health(r#"{"voices":[{"id":"minh","name":"Minh Quân"},"lan",{"voice_id":"x"}]}"#),
    ];

    std::thread::spawn(move || {
        for answer in answers {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            let _ = stream.write_all(&answer);
        }
    });

    let result = status(&url).unwrap();

    assert!(result.reachable);
    assert_eq!(
        result.voices,
        vec![
            voice("minh", "Minh Quân"),
            voice("lan", "lan"),
            voice("x", "x")
        ]
    );
}

#[test]
fn voices_parse_from_arrays_and_maps() {
    assert_eq!(parse_voices(b"not json"), Vec::new());
    assert_eq!(parse_voices(br#"["a","b"]"#).len(), 2);
    assert_eq!(
        parse_voices(br#"{"data":[{"id":"a"}]}"#),
        vec![Voice {
            id: "a".into(),
            name: "a".into(),
            region: String::new()
        }]
    );
    assert_eq!(
        parse_voices(br#"{"voices":{"a":"Alpha"}}"#),
        vec![Voice {
            id: "a".into(),
            name: "Alpha".into(),
            region: String::new()
        }]
    );
}

#[test]
fn base64_matches_the_standard_vectors() {
    for (input, expected) in [
        ("", ""),
        ("f", "Zg=="),
        ("fo", "Zm8="),
        ("foo", "Zm9v"),
        ("foob", "Zm9vYg=="),
        ("fooba", "Zm9vYmE="),
        ("foobar", "Zm9vYmFy"),
    ] {
        assert_eq!(base64_encode(input.as_bytes()), expected);
    }
}

#[test]
fn regions_come_from_what_the_server_says_never_from_names_alone() {
    let regions = |json: &str| -> Vec<String> {
        parse_voices(json.as_bytes())
            .into_iter()
            .map(|voice| voice.region)
            .collect()
    };

    assert_eq!(
        regions(
            r#"[{"id":"a","region":"Bắc"},{"id":"b","accent":"south"},
            {"id":"c","description":"Giọng nữ miền Trung"},{"id":"d","name":"Hà Nội nhẹ"},
            {"id":"e","name":"Nam"},{"id":"f","name":"Minh Quân"}]"#
        ),
        ["north", "south", "central", "north", "", ""]
    );
}
