mod commands;
mod error;
mod ffmpeg;

use commands::HotkeyInfo;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// 標記精華的全域熱鍵：遊戲全螢幕時也能觸發
const MARK_HOTKEY: &str = "F9";
/// 前端監聽的事件名稱，需與 `src/lib/ipc.ts` 一致
const MARK_EVENT: &str = "hotkey://mark";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit(MARK_EVENT, ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Ok(dir) = app.path().resource_dir() {
                ffmpeg::tool::set_resource_dir(dir);
            }

            // 熱鍵可能已被其他程式佔用，失敗時不中斷啟動，交由前端提示
            let registered = match app.global_shortcut().register(MARK_HOTKEY) {
                Ok(()) => true,
                Err(err) => {
                    eprintln!("無法註冊全域熱鍵 {MARK_HOTKEY}：{err}");
                    false
                }
            };
            app.manage(HotkeyInfo { key: MARK_HOTKEY.into(), registered });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_ffmpeg,
            commands::probe_media,
            commands::prepare_preview,
            commands::load_peaks,
            commands::export_clips,
            commands::hotkey_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
