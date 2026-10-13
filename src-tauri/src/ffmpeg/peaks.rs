use std::process::Stdio;

use serde::Serialize;
use tokio::io::AsyncReadExt;

use super::tool::{self, Tool};
use crate::error::{AppError, AppResult};

/// 解碼用的取樣率；波形不需要高音質，越低越快
const SAMPLE_RATE: usize = 8_000;
/// 每秒產生幾個波形點
const PEAKS_PER_SEC: usize = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peaks {
    /// 0.0 ~ 1.0 的振幅
    pub data: Vec<f32>,
    pub duration: f64,
}

/// 用 ffmpeg 把指定音軌解成單聲道 PCM，邊讀邊算峰值，
/// 不把整段音訊載入前端（1 小時的音訊在瀏覽器解碼會吃掉 1GB 以上記憶體）
pub async fn compute(path: &str, track: usize) -> AppResult<Peaks> {
    let mut cmd = tool::command(Tool::Ffmpeg)?;
    cmd.args(["-hide_banner", "-v", "error", "-i"])
        .arg(path)
        .args(["-vn", "-sn", "-dn", "-map", &format!("0:a:{track}")])
        .args(["-ac", "1", "-ar", &SAMPLE_RATE.to_string(), "-f", "s16le", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn()?;

    let mut stderr = child.stderr.take().expect("stderr piped");
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        buf
    });

    let bucket = SAMPLE_RATE / PEAKS_PER_SEC;
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut buf = vec![0u8; 64 * 1024];
    let mut carry: Option<u8> = None;
    let mut data = Vec::new();
    let (mut peak, mut count, mut total) = (0u16, 0usize, 0usize);

    loop {
        let n = stdout.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        let mut bytes = &buf[..n];
        // 上一輪剩下半個 sample 時先補齊
        if let Some(lo) = carry.take() {
            push_sample(i16::from_le_bytes([lo, bytes[0]]), &mut peak, &mut count, bucket, &mut data);
            total += 1;
            bytes = &bytes[1..];
        }
        let mut chunks = bytes.chunks_exact(2);
        for pair in &mut chunks {
            push_sample(i16::from_le_bytes([pair[0], pair[1]]), &mut peak, &mut count, bucket, &mut data);
            total += 1;
        }
        carry = chunks.remainder().first().copied();
    }
    if count > 0 {
        data.push(peak as f32 / 32768.0);
    }

    let status = child.wait().await?;
    if !status.success() {
        let stderr = stderr_task.await.unwrap_or_default();
        return Err(AppError::ToolFailed {
            tool: "ffmpeg",
            message: String::from_utf8_lossy(&stderr).trim().to_owned(),
        });
    }

    Ok(Peaks {
        data,
        duration: total as f64 / SAMPLE_RATE as f64,
    })
}

fn push_sample(sample: i16, peak: &mut u16, count: &mut usize, bucket: usize, data: &mut Vec<f32>) {
    *peak = (*peak).max(sample.unsigned_abs());
    *count += 1;
    if *count == bucket {
        data.push(*peak as f32 / 32768.0);
        *peak = 0;
        *count = 0;
    }
}
