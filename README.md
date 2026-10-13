# OBS Clip Editor

錄影時按熱鍵標記精華，錄完自動產生片段，再用時間軸微調後一次匯出。

## 需求

- Node.js 22+、Rust（stable, MSVC）、Visual Studio C++ Build Tools
- FFmpeg：`npm install` 時會自動下載 LGPL 版到 `src-tauri/bin/`（`npm run fetch-ffmpeg` 可重新下載），打包時一起放進安裝檔
- OBS 28+：開啟「工具 → WebSocket 伺服器設定」

## 開發

```bash
npm install
npm run tauri dev
```

| 指令 | 說明 |
|---|---|
| `npm run tauri dev` | 啟動開發模式 |
| `npm run tauri build` | 打包安裝檔 |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run lint` / `npm run format` | Biome 檢查 / 自動修正 |
| `npm run test:rust` | Rust 單元測試 |

## 架構

```
src/                         前端（React 19 + TypeScript + Vite）
├─ app/                      進入點、全域樣式（Tailwind v4 設計 token）
├─ components/ui/            shadcn/ui 風格基礎元件（Radix + Tailwind）
├─ lib/
│  ├─ ipc.ts                 與 Rust 溝通的型別化介面（唯一呼叫 invoke 的地方）
│  └─ utils.ts
└─ features/                 依功能切分，每個功能自帶 store 與元件
   ├─ obs/                   obs-websocket 連線、錄影狀態、標記
   ├─ project/               錄影檔與片段資料（zustand + persist）
   ├─ player/                共用 <video> 與播放狀態
   ├─ timeline/              wavesurfer.js 波形與片段區間
   ├─ clips/                 片段清單
   ├─ export/                匯出設定與進度
   ├─ library/               錄影檔清單、音軌選擇
   ├─ ffmpeg/                FFmpeg 偵測
   └─ editor/                主畫面組合、快捷鍵、媒體載入

src-tauri/src/               後端（Rust + Tauri 2）
├─ lib.rs                    外掛註冊、全域熱鍵（F9）
├─ commands.rs               前端可呼叫的 commands
├─ error.rs                  統一錯誤型別（序列化為字串給前端）
└─ ffmpeg/
   ├─ tool.rs                尋找 / 執行 ffmpeg，解析進度
   ├─ probe.rs               ffprobe 讀取影片資訊
   ├─ peaks.rs               串流解碼音訊並計算波形峰值
   └─ clip.rs                轉封裝預覽、剪輯匯出
```

### 資料流程

1. 連上 OBS → 錄影中按 **F9** → 透過 `GetRecordStatus` 取得錄影時間點，存成標記
2. OBS 停止錄影（`RecordStateChanged`）→ 自動匯入檔案，每個標記依「往前 / 往後秒數」產生片段
3. MKV 會先轉封裝成 MP4（不重新編碼）供預覽；波形由後端以 FFmpeg 計算後傳給 wavesurfer.js
4. 匯出：快速剪（`-c copy`）或精準剪（NVENC / QSV / AMF / OpenH264），進度透過 Tauri Channel 回報

### 快捷鍵

| 按鍵 | 功能 |
|---|---|
| F9（全域） | 標記精華；沒在錄影但重播緩衝開著時，存下重播 |
| 空白鍵 | 播放 / 暫停 |
| ← / → | 前後 1 秒（按住 Shift 為 5 秒） |
| M | 在目前位置新增片段 |
| I / O | 把選取片段的起點 / 終點設在目前位置 |
| Delete | 刪除選取片段 |
