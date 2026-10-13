use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy)]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    pub fn name(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "ffmpeg",
            Tool::Ffprobe => "ffprobe",
        }
    }
}

/// Tauri 的資源資料夾；打包進安裝檔的 FFmpeg 位於其下的 bin/
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// 依序尋找：資源資料夾的 bin/、程式目錄的 bin/、程式目錄、PATH
pub fn locate(tool: Tool) -> AppResult<PathBuf> {
    let file = format!("{}{}", tool.name(), std::env::consts::EXE_SUFFIX);
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let path_dirs = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();

    RESOURCE_DIR
        .get()
        .map(|dir| dir.join("bin"))
        .into_iter()
        .chain(exe_dir.iter().flat_map(|dir| [dir.join("bin"), dir.clone()]))
        .chain(path_dirs)
        .map(|dir| dir.join(&file))
        .find(|p| p.is_file())
        .ok_or(AppError::ToolNotFound(tool.name()))
}

pub fn command(tool: Tool) -> AppResult<Command> {
    let mut cmd = Command::new(locate(tool)?);
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW：避免每次呼叫都閃出黑色主控台
    Ok(cmd)
}

/// 執行到結束並回傳 stdout；失敗時把 stderr 最後幾行當錯誤訊息
pub async fn output(tool: Tool, mut cmd: Command) -> AppResult<Vec<u8>> {
    let out = cmd.output().await?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(failed(tool, &out.stderr))
    }
}

/// 執行 ffmpeg 並透過 `-progress pipe:1` 回報進度（0.0 ~ 1.0）
pub async fn run_with_progress(
    mut cmd: Command,
    total_secs: f64,
    mut on_progress: impl FnMut(f64),
) -> AppResult<()> {
    cmd.args(["-nostats", "-progress", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn()?;

    // stderr 必須同時讀，否則緩衝區塞滿會讓 ffmpeg 卡住
    let mut stderr = child.stderr.take().expect("stderr piped");
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        buf
    });

    let mut lines = BufReader::new(child.stdout.take().expect("stdout piped")).lines();
    while let Some(line) = lines.next_line().await? {
        if let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<f64>().ok()) {
            if total_secs > 0.0 {
                on_progress((us / 1_000_000.0 / total_secs).clamp(0.0, 1.0));
            }
        }
    }

    let status = child.wait().await?;
    let stderr = stderr_task.await.unwrap_or_default();
    if status.success() {
        on_progress(1.0);
        Ok(())
    } else {
        Err(failed(Tool::Ffmpeg, &stderr))
    }
}

fn failed(tool: Tool, stderr: &[u8]) -> AppError {
    let text = String::from_utf8_lossy(stderr);
    // 略過進度行，優先取真正的錯誤訊息
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("frame=") && !l.starts_with("size="))
        .collect();
    let errors: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|l| l.to_ascii_lowercase().contains("error") || l.contains("failed"))
        .collect();
    let picked = if errors.is_empty() { &lines } else { &errors };
    let message = picked[picked.len().saturating_sub(2)..].join(" / ");
    AppError::ToolFailed {
        tool: tool.name(),
        message: if message.is_empty() { "未知錯誤".into() } else { message },
    }
}

/// ffmpeg 的時間參數格式（秒，保留毫秒）
pub fn secs(value: f64) -> String {
    format!("{:.3}", value.max(0.0))
}
