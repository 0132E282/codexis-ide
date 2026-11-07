use crate::speech::{self, Status, Synthesized};

/// Whether the local VieNeu-TTS server answers, and the voices it offers.
#[tauri::command]
pub async fn speech_status(base_url: String) -> Result<Status, String> {
    super::blocking("speech.unreachable", move || {
        speech::status(&base_url).map_err(|error| error.to_string())
    })
    .await
}

/// Speaks `text` with the local VieNeu-TTS server; the WAV comes back as base64.
#[tauri::command]
pub async fn speech_synthesize(
    base_url: String,
    voice: String,
    text: String,
    speed_percent: Option<u32>,
) -> Result<Synthesized, String> {
    super::blocking("speech.unreachable", move || {
        speech::synthesize(&base_url, &voice, &text, speed_percent)
            .map(|wav| Synthesized {
                wav_base64: speech::base64_encode(&wav),
            })
            .map_err(|error| error.to_string())
    })
    .await
}
