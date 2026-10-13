//! 端對端測試：實際呼叫 src-tauri/bin 裡的 FFmpeg。
//! 執行：`npm run test:rust`（需先 `npm install` 下載 FFmpeg）

use std::path::{Path, PathBuf};

use super::clip::{self, ClipSpec, ExportEvent, ExportMode, ExportRequest};
use super::tool::{self, Tool};
use super::{peaks, probe};

fn setup() -> PathBuf {
    tool::set_resource_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let dir = std::env::temp_dir().join(format!("obs-clip-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 產生類似 OBS 錄影的檔案：MKV、H.264、兩條 AAC 音軌（遊戲聲 / 麥克風）
async fn make_recording(dir: &Path, secs: u32) -> String {
    let path = dir.join("recording.mkv");
    let mut cmd = tool::command(Tool::Ffmpeg).unwrap();
    cmd.args(["-hide_banner", "-y"])
        .args(["-f", "lavfi", "-i", &format!("testsrc2=size=640x360:rate=30:duration={secs}")])
        .args(["-f", "lavfi", "-i", &format!("sine=frequency=440:duration={secs}")])
        .args(["-f", "lavfi", "-i", &format!("sine=frequency=880:duration={secs}")])
        .args(["-map", "0", "-map", "1", "-map", "2", "-c:v", "libopenh264", "-g", "60"])
        .args(["-c:a", "aac", "-metadata:s:a:0", "title=Game", "-metadata:s:a:1", "title=Mic"])
        .arg(&path);
    tool::output(Tool::Ffmpeg, cmd).await.unwrap();
    path.to_string_lossy().into_owned()
}

#[tokio::test]
#[ignore = "需要 FFmpeg；以 cargo test -- --ignored 執行"]
async fn full_pipeline() {
    let dir = setup();
    let input = make_recording(&dir, 30).await;

    // 1. 讀取影片資訊
    let info = probe::probe(&input).await.unwrap();
    assert!(info.needs_remux, "MKV 應該需要轉封裝");
    assert!((info.duration - 30.0).abs() < 0.5, "duration = {}", info.duration);
    assert_eq!(info.audio_tracks.len(), 2);
    assert_eq!(info.audio_tracks[1].title.as_deref(), Some("Mic"));

    // 2. 轉封裝成 MP4 供預覽
    let mut last_progress = 0.0;
    let preview = clip::remux_for_preview(&input, info.duration, |r| last_progress = r).await.unwrap();
    assert_eq!(last_progress, 1.0);
    let preview_info = probe::probe(preview.to_str().unwrap()).await.unwrap();
    assert!(!preview_info.needs_remux);
    assert_eq!(preview_info.audio_tracks.len(), 2, "轉封裝要保留所有音軌");

    // 3. 波形：每秒 20 點
    let peaks = peaks::compute(&input, 0).await.unwrap();
    assert!((peaks.duration - 30.0).abs() < 0.5);
    assert!((590..=610).contains(&peaks.data.len()), "peaks = {}", peaks.data.len());
    assert!(peaks.data.iter().any(|&p| p > 0.1), "正弦波應該有振幅");

    // 4. 快速剪：保留兩條獨立音軌
    let clips = vec![
        ClipSpec { label: "精華: 開場".into(), start: 2.0, end: 8.0 },
        ClipSpec { label: "結尾".into(), start: 20.0, end: 29.0 },
    ];
    let fast = export(&input, &dir.join("fast"), clips, ExportMode::Fast).await;
    assert_eq!(fast.len(), 2);
    let fast_info = probe::probe(&fast[0]).await.unwrap();
    assert_eq!(fast_info.audio_tracks.len(), 2);
    // 不重新編碼時切點對齊關鍵影格（每 2 秒一個），長度誤差在 2 秒內
    assert!((fast_info.duration - 6.0).abs() <= 2.0, "fast duration = {}", fast_info.duration);
    assert!(fast[0].ends_with("recording_01_精華_ 開場.mp4"), "{}", fast[0]);

    // 5. 精準剪（CPU / OpenH264）：兩條音軌混成一條，長度精準
    let clips = vec![ClipSpec { label: "精準".into(), start: 3.5, end: 9.25 }];
    let mode = ExportMode::Precise { encoder: "libopenh264".into() };
    let precise = export(&input, &dir.join("precise"), clips, mode).await;
    let precise_info = probe::probe(&precise[0]).await.unwrap();
    assert_eq!(precise_info.audio_tracks.len(), 1, "多音軌應混成一條");
    assert!((precise_info.duration - 5.75).abs() < 0.1, "precise duration = {}", precise_info.duration);

    let _ = std::fs::remove_dir_all(&dir);
}

async fn export(input: &str, out: &Path, clips: Vec<ClipSpec>, mode: ExportMode) -> Vec<String> {
    let request = ExportRequest {
        input: input.into(),
        output_dir: out.to_string_lossy().into_owned(),
        clips,
        audio_tracks: vec![0, 1],
        mode,
    };
    let mut failures = Vec::new();
    let outputs = clip::export(&request, |e| {
        if let ExportEvent::Failed { error, .. } = e {
            failures.push(error);
        }
    })
    .await
    .unwrap();
    assert!(failures.is_empty(), "匯出失敗：{failures:?}");
    outputs
}

/// 列出這台電腦實際可用的硬體編碼器（只回報，不判定失敗）
#[tokio::test]
#[ignore = "需要 FFmpeg；以 cargo test -- --ignored 執行"]
async fn hardware_encoders_report() {
    let dir = setup();
    let input = make_recording(&dir, 4).await;
    for encoder in ["h264_nvenc", "h264_qsv", "h264_amf"] {
        let request = ExportRequest {
            input: input.clone(),
            output_dir: dir.join(encoder).to_string_lossy().into_owned(),
            clips: vec![ClipSpec { label: "hw".into(), start: 0.5, end: 3.0 }],
            audio_tracks: vec![0],
            mode: ExportMode::Precise { encoder: encoder.into() },
        };
        let mut result = "OK".to_string();
        clip::export(&request, |e| {
            if let ExportEvent::Failed { error, .. } = e {
                result = format!("不可用（{}）", error.chars().take(80).collect::<String>());
            }
        })
        .await
        .unwrap();
        println!("{encoder}: {result}");
    }
    println!("可用的編碼器：{:?}", clip::available_encoders().await.unwrap());
    let _ = std::fs::remove_dir_all(&dir);
}
