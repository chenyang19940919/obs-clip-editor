//! 所有影片處理都交給外部的 ffmpeg / ffprobe 執行檔

pub mod clip;
pub mod peaks;
pub mod probe;
pub mod tool;

#[cfg(test)]
mod e2e_tests;
