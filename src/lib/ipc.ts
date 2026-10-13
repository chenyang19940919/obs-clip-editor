/**
 * 前端與 Rust 後端的型別化介面。
 * 型別需與 `src-tauri/src/commands.rs`、`src-tauri/src/ffmpeg/*.rs` 保持一致。
 */
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface FfmpegInfo {
  ffmpegPath: string;
  ffprobePath: string;
  version: string;
  encoders: Encoder[];
}

export type Encoder = "h264_nvenc" | "h264_qsv" | "h264_amf" | "libopenh264";

export interface MediaInfo {
  path: string;
  duration: number;
  size: number;
  container: string;
  needsRemux: boolean;
  video: { codec: string; width: number; height: number; fps: number } | null;
  audioTracks: AudioTrack[];
}

export interface AudioTrack {
  index: number;
  codec: string;
  channels: number;
  title: string | null;
}

export interface Peaks {
  data: number[];
  duration: number;
}

export type ExportMode = { kind: "fast" } | { kind: "precise"; encoder: Encoder };

export interface ExportRequest {
  input: string;
  outputDir: string;
  clips: { label: string; start: number; end: number }[];
  audioTracks: number[];
  mode: ExportMode;
}

export type ExportEvent =
  | { event: "started"; data: { index: number; output: string } }
  | { event: "progress"; data: { index: number; ratio: number } }
  | { event: "finished"; data: { index: number; output: string } }
  | { event: "failed"; data: { index: number; error: string } };

export interface HotkeyInfo {
  key: string;
  registered: boolean;
}

/** 後端錯誤一律序列化成字串，這裡統一轉成 Error */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new Error(typeof err === "string" ? err : String(err));
  }
}

function channel<T>(handler?: (message: T) => void): Channel<T> {
  const ch = new Channel<T>();
  if (handler) ch.onmessage = handler;
  return ch;
}

export const ipc = {
  checkFfmpeg: () => call<FfmpegInfo>("check_ffmpeg"),

  probeMedia: (path: string) => call<MediaInfo>("probe_media", { path }),

  /** 回傳可直接給 `<video src>` 使用的 URL */
  preparePreview: async (path: string, onProgress?: (ratio: number) => void) => {
    const playable = await call<string>("prepare_preview", { path, onProgress: channel(onProgress) });
    return convertFileSrc(playable);
  },

  loadPeaks: (path: string, track: number) => call<Peaks>("load_peaks", { path, track }),

  exportClips: (request: ExportRequest, onEvent: (event: ExportEvent) => void) =>
    call<string[]>("export_clips", { request, onEvent: channel(onEvent) }),

  hotkeyInfo: () => call<HotkeyInfo>("hotkey_info"),

  /** 全域熱鍵（預設 F9）被按下時觸發 */
  onMarkHotkey: (handler: () => void) => listen("hotkey://mark", handler),
};
