use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("找不到 {0}。請安裝 FFmpeg 並加入 PATH，或把執行檔放到程式目錄的 bin 資料夾")]
    ToolNotFound(&'static str),

    #[error("{tool} 執行失敗：{message}")]
    ToolFailed { tool: &'static str, message: String },

    #[error("{0}")]
    Invalid(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

/// 前端收到的錯誤一律是可直接顯示的字串
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
