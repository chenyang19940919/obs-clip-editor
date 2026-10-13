use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::tool::{self, Tool};
use crate::error::AppResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub duration: f64,
    pub size: u64,
    pub container: String,
    /// WebView 無法直接播放 MKV/FLV 等容器，需先轉封裝成 MP4
    pub needs_remux: bool,
    pub video: Option<VideoStream>,
    pub audio_tracks: Vec<AudioTrack>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    /// 第幾條音軌（對應 ffmpeg 的 `0:a:N`）
    pub index: usize,
    pub codec: String,
    pub channels: u32,
    pub title: Option<String>,
}

#[derive(Deserialize)]
struct ProbeOutput {
    format: ProbeFormat,
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    format_name: String,
    duration: Option<String>,
    size: Option<String>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    channels: Option<u32>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

pub async fn probe(path: &str) -> AppResult<MediaInfo> {
    let mut cmd = tool::command(Tool::Ffprobe)?;
    cmd.args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(path);
    let raw: ProbeOutput = serde_json::from_slice(&tool::output(Tool::Ffprobe, cmd).await?)?;

    let video = raw
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        .map(|s| VideoStream {
            codec: s.codec_name.clone().unwrap_or_default(),
            width: s.width.unwrap_or(0),
            height: s.height.unwrap_or(0),
            fps: s.avg_frame_rate.as_deref().map(parse_rate).unwrap_or(0.0),
        });

    let audio_tracks = raw
        .streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("audio"))
        .enumerate()
        .map(|(index, s)| AudioTrack {
            index,
            codec: s.codec_name.clone().unwrap_or_default(),
            channels: s.channels.unwrap_or(0),
            title: s
                .tags
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("title"))
                .map(|(_, v)| v.clone()),
        })
        .collect();

    let needs_remux = !raw
        .format
        .format_name
        .split(',')
        .any(|f| f == "mp4" || f == "mov");

    Ok(MediaInfo {
        path: path.to_owned(),
        duration: raw.format.duration.and_then(|d| d.parse().ok()).unwrap_or(0.0),
        size: raw.format.size.and_then(|s| s.parse().ok()).unwrap_or(0),
        container: raw.format.format_name,
        needs_remux,
        video,
        audio_tracks,
    })
}

/// "60000/1001" → 59.94
fn parse_rate(rate: &str) -> f64 {
    match rate.split_once('/') {
        Some((n, d)) => match (n.parse::<f64>(), d.parse::<f64>()) {
            (Ok(n), Ok(d)) if d != 0.0 => n / d,
            _ => 0.0,
        },
        None => rate.parse().unwrap_or(0.0),
    }
}
