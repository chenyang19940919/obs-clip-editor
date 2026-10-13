//! 前端可呼叫的 Tauri commands。型別定義需與 `src/lib/ipc.ts` 保持一致。

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::error::AppResult;
use crate::ffmpeg::clip::{self, ExportEvent, ExportRequest};
use crate::ffmpeg::peaks::{self, Peaks};
use crate::ffmpeg::probe::{self, MediaInfo};
use crate::ffmpeg::tool::{self, Tool};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub version: String,
    pub encoders: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyInfo {
    pub key: String,
    pub registered: bool,
}

#[tauri::command]
pub async fn check_ffmpeg() -> AppResult<FfmpegInfo> {
    Ok(FfmpegInfo {
        ffmpeg_path: tool::locate(Tool::Ffmpeg)?.to_string_lossy().into_owned(),
        ffprobe_path: tool::locate(Tool::Ffprobe)?.to_string_lossy().into_owned(),
        version: clip::version().await?,
        encoders: clip::available_encoders().await?,
    })
}

#[tauri::command]
pub async fn probe_media(path: String) -> AppResult<MediaInfo> {
    probe::probe(&path).await
}

/// 回傳可在 `<video>` 播放的檔案路徑（必要時先轉封裝），並開放 asset protocol 讀取該檔
#[tauri::command]
pub async fn prepare_preview(app: AppHandle, path: String, on_progress: Channel<f64>) -> AppResult<String> {
    let info = probe::probe(&path).await?;
    let playable = if info.needs_remux {
        clip::remux_for_preview(&path, info.duration, |ratio| {
            let _ = on_progress.send(ratio);
        })
        .await?
    } else {
        path.into()
    };
    app.asset_protocol_scope().allow_file(&playable)?;
    Ok(playable.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn load_peaks(path: String, track: usize) -> AppResult<Peaks> {
    peaks::compute(&path, track).await
}

#[tauri::command]
pub async fn export_clips(request: ExportRequest, on_event: Channel<ExportEvent>) -> AppResult<Vec<String>> {
    clip::export(&request, |event| {
        let _ = on_event.send(event);
    })
    .await
}

#[tauri::command]
pub fn hotkey_info(state: State<'_, HotkeyInfo>) -> HotkeyInfo {
    state.inner().clone()
}
