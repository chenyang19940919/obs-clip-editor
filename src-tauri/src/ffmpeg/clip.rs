use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::tool::{self, Tool, secs};
use crate::error::{AppError, AppResult};

/// 支援的 H.264 編碼器，依偏好排序（硬體優先）
/// LGPL 版 FFmpeg 不含 x264，CPU 編碼改用 OpenH264
pub const ENCODERS: [&str; 4] = ["h264_nvenc", "h264_qsv", "h264_amf", "libopenh264"];

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExportMode {
    /// 不重新編碼：幾乎瞬間完成，但切點會對齊關鍵影格
    Fast,
    /// 重新編碼：切點精準到影格
    Precise { encoder: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSpec {
    pub label: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub input: String,
    pub output_dir: String,
    pub clips: Vec<ClipSpec>,
    pub audio_tracks: Vec<usize>,
    pub mode: ExportMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum ExportEvent {
    Started { index: usize, output: String },
    Progress { index: usize, ratio: f64 },
    Finished { index: usize, output: String },
    Failed { index: usize, error: String },
}

/// 列出這台電腦實際能用的編碼器：
/// ffmpeg 有編進去不代表有對應的顯示卡，所以每個都試編幾格確認
pub async fn available_encoders() -> AppResult<Vec<String>> {
    let mut cmd = tool::command(Tool::Ffmpeg)?;
    cmd.args(["-hide_banner", "-encoders"]);
    let out = String::from_utf8_lossy(&tool::output(Tool::Ffmpeg, cmd).await?).into_owned();
    let compiled = ENCODERS.iter().filter(|name| out.split_whitespace().any(|w| w == **name));

    let mut probes = tokio::task::JoinSet::new();
    for (order, name) in compiled.enumerate() {
        let name = name.to_string();
        probes.spawn(async move {
            let usable = test_encode(&name).await;
            (order, name, usable)
        });
    }
    let mut usable: Vec<(usize, String)> = probes
        .join_all()
        .await
        .into_iter()
        .filter_map(|(order, name, ok)| ok.then_some((order, name)))
        .collect();
    usable.sort();
    Ok(usable.into_iter().map(|(_, name)| name).collect())
}

async fn test_encode(encoder: &str) -> bool {
    let Ok(mut cmd) = tool::command(Tool::Ffmpeg) else { return false };
    cmd.args(["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=size=256x256:rate=30:duration=0.2"])
        .args(video_encoder_args(encoder))
        .args(["-f", "null", "-"]);
    tool::output(Tool::Ffmpeg, cmd).await.is_ok()
}

pub async fn version() -> AppResult<String> {
    let mut cmd = tool::command(Tool::Ffmpeg)?;
    cmd.arg("-version");
    let out = tool::output(Tool::Ffmpeg, cmd).await?;
    Ok(String::from_utf8_lossy(&out).lines().next().unwrap_or_default().to_owned())
}

/// 把 MKV 等容器轉封裝成 MP4 供預覽（只換容器不重新編碼）。
/// 輸出檔名與 OBS「自動轉封裝」相同，若已存在且比原檔新就直接沿用。
pub async fn remux_for_preview(input: &str, duration: f64, on_progress: impl FnMut(f64)) -> AppResult<PathBuf> {
    let src = Path::new(input);
    let output = src.with_extension("mp4");
    if is_newer(&output, src).await {
        return Ok(output);
    }

    let mut cmd = tool::command(Tool::Ffmpeg)?;
    cmd.args(["-hide_banner", "-y", "-i"])
        .arg(src)
        .args(["-map", "0:v:0?", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart"])
        .arg(&output);
    tool::run_with_progress(cmd, duration, on_progress).await?;
    Ok(output)
}

pub async fn export(request: &ExportRequest, mut emit: impl FnMut(ExportEvent)) -> AppResult<Vec<String>> {
    let input = Path::new(&request.input);
    let out_dir = Path::new(&request.output_dir);
    tokio::fs::create_dir_all(out_dir).await?;
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");

    let mut outputs = Vec::new();
    for (index, clip) in request.clips.iter().enumerate() {
        let duration = clip.end - clip.start;
        if duration <= 0.0 {
            emit(ExportEvent::Failed { index, error: "片段長度必須大於 0".into() });
            continue;
        }

        let output = unique_path(out_dir, &format!("{stem}_{:02}_{}", index + 1, sanitize(&clip.label)));
        let output_str = output.to_string_lossy().into_owned();
        emit(ExportEvent::Started { index, output: output_str.clone() });

        let mut cmd = tool::command(Tool::Ffmpeg)?;
        cmd.args(["-hide_banner", "-y", "-ss", &secs(clip.start), "-i"])
            .arg(input)
            .args(["-t", &secs(duration)])
            .args(clip_args(&request.mode, &request.audio_tracks)?)
            .args(["-movflags", "+faststart"])
            .arg(&output);

        match tool::run_with_progress(cmd, duration, |ratio| emit(ExportEvent::Progress { index, ratio })).await {
            Ok(()) => {
                emit(ExportEvent::Finished { index, output: output_str.clone() });
                outputs.push(output_str);
            }
            Err(err) => emit(ExportEvent::Failed { index, error: err.to_string() }),
        }
    }
    Ok(outputs)
}

fn clip_args(mode: &ExportMode, tracks: &[usize]) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = vec!["-map".into(), "0:v:0?".into()];
    let push = |args: &mut Vec<String>, items: &[&str]| args.extend(items.iter().map(|s| s.to_string()));

    match mode {
        ExportMode::Fast => {
            // 不重新編碼時無法混音，選取的音軌會各自保留成獨立音軌
            for t in tracks {
                push(&mut args, &["-map", &format!("0:a:{t}")]);
            }
            push(&mut args, &["-c", "copy", "-avoid_negative_ts", "make_zero"]);
        }
        ExportMode::Precise { encoder } => {
            if !ENCODERS.contains(&encoder.as_str()) {
                return Err(AppError::Invalid(format!("不支援的編碼器：{encoder}")));
            }
            push(&mut args, video_encoder_args(encoder));
            match tracks {
                [] => {}
                [t] => push(&mut args, &["-map", &format!("0:a:{t}")]),
                many => {
                    // 多條音軌混成一條，方便上傳到社群平台
                    let inputs: String = many.iter().map(|t| format!("[0:a:{t}]")).collect();
                    let filter = format!("{inputs}amix=inputs={}:normalize=0[aout]", many.len());
                    push(&mut args, &["-filter_complex", &filter, "-map", "[aout]"]);
                }
            }
            if !tracks.is_empty() {
                push(&mut args, &["-c:a", "aac", "-b:a", "192k"]);
            }
        }
    }
    if tracks.is_empty() {
        args.push("-an".into());
    }
    Ok(args)
}

fn video_encoder_args(encoder: &str) -> &'static [&'static str] {
    match encoder {
        "h264_nvenc" => &["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "23", "-b:v", "0"],
        "h264_qsv" => &["-c:v", "h264_qsv", "-global_quality", "23"],
        "h264_amf" => &["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "22", "-qp_p", "22"],
        // OpenH264 沒有 CRF 模式，以位元率控制畫質
        _ => &["-c:v", "libopenh264", "-b:v", "12M", "-maxrate", "16M"],
    }
}

/// 移除 Windows 檔名不允許的字元
fn sanitize(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.');
    if trimmed.is_empty() { "clip".into() } else { trimmed.chars().take(60).collect() }
}

fn unique_path(dir: &Path, base: &str) -> PathBuf {
    let first = dir.join(format!("{base}.mp4"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{base} ({n}).mp4")))
        .find(|p| !p.exists())
        .expect("infinite iterator")
}

async fn is_newer(candidate: &Path, than: &Path) -> bool {
    let modified = |p: &Path| {
        let p = p.to_owned();
        async move { tokio::fs::metadata(p).await.and_then(|m| m.modified()).ok() }
    };
    match (modified(candidate).await, modified(than).await) {
        (Some(a), Some(b)) => a >= b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_invalid_chars() {
        assert_eq!(sanitize("五殺: 太神了?"), "五殺_ 太神了_");
        assert_eq!(sanitize("  ..."), "clip");
    }

    #[test]
    fn precise_mixes_multiple_tracks() {
        let args = clip_args(&ExportMode::Precise { encoder: "libopenh264".into() }, &[0, 2]).unwrap();
        assert!(args.contains(&"[0:a:0][0:a:2]amix=inputs=2:normalize=0[aout]".to_string()));
    }

    #[test]
    fn fast_mode_copies_streams() {
        let args = clip_args(&ExportMode::Fast, &[]).unwrap();
        assert!(args.contains(&"copy".to_string()));
        assert!(args.contains(&"-an".to_string()));
    }
}
