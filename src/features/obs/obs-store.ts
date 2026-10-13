import { EventSubscription, OBSWebSocket } from "obs-websocket-js";
import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Marker, useProjectStore } from "@/features/project/project-store";
import { errorMessage, formatTime } from "@/lib/utils";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

interface ObsState {
  url: string;
  status: ConnectionStatus;
  recording: boolean;
  /** 目前錄影已經過的秒數 */
  elapsed: number;
  /** 本次錄影中按下的標記，錄影結束後轉成片段 */
  markers: Marker[];

  setUrl: (url: string) => void;
  connect: (password?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** 標記精華：錄影中記下時間點；沒在錄影但重播緩衝開著時，直接存下重播 */
  mark: () => Promise<void>;
}

const obs = new OBSWebSocket();
let pollTimer: ReturnType<typeof setInterval> | undefined;

export const useObsStore = create<ObsState>()(
  persist(
    (set, get) => {
      const refreshStatus = async () => {
        try {
          const status = await obs.call("GetRecordStatus");
          set({ recording: status.outputActive, elapsed: status.outputDuration / 1000 });
        } catch {
          // 斷線時由 ConnectionClosed 處理
        }
      };

      obs.on("ConnectionClosed", () => {
        clearInterval(pollTimer);
        set({ status: "disconnected", recording: false });
      });

      obs.on("RecordStateChanged", ({ outputState, outputPath }) => {
        if (outputState === "OBS_WEBSOCKET_OUTPUT_STARTED") {
          set({ recording: true, elapsed: 0, markers: [] });
        }
        if (outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED") {
          const { markers } = get();
          set({ recording: false, markers: [] });
          if (outputPath) {
            useProjectStore.getState().addRecording(outputPath, "obs", markers);
            toast.success("錄影已結束", { description: `已匯入，並由 ${markers.length} 個標記產生片段` });
          }
        }
      });

      obs.on("ReplayBufferSaved", ({ savedReplayPath }) => {
        useProjectStore.getState().addRecording(savedReplayPath, "replay");
        toast.success("已存下重播片段");
      });

      return {
        url: "ws://127.0.0.1:4455",
        status: "disconnected",
        recording: false,
        elapsed: 0,
        markers: [],

        setUrl: (url) => set({ url }),

        connect: async (password) => {
          set({ status: "connecting" });
          try {
            await obs.connect(get().url, password || undefined, {
              eventSubscriptions: EventSubscription.Outputs,
            });
            set({ status: "connected" });
            await refreshStatus();
            clearInterval(pollTimer);
            pollTimer = setInterval(() => {
              if (get().recording) void refreshStatus();
            }, 1000);
          } catch (err) {
            set({ status: "disconnected" });
            toast.error("無法連線到 OBS", {
              description: `${errorMessage(err)}。請確認 OBS 已開啟「工具 → WebSocket 伺服器設定」。`,
            });
          }
        },

        disconnect: async () => {
          await obs.disconnect();
        },

        mark: async () => {
          if (get().status !== "connected") {
            toast.warning("尚未連線到 OBS");
            return;
          }
          try {
            const status = await obs.call("GetRecordStatus");
            if (status.outputActive) {
              const time = status.outputDuration / 1000;
              const label = `精華 ${get().markers.length + 1}`;
              set((s) => ({ markers: [...s.markers, { time, label }], elapsed: time }));
              // 錄成 Hybrid MP4 時，OBS 會在檔案裡寫入章節；其他格式不支援，忽略錯誤
              obs.call("CreateRecordChapter", { chapterName: label }).catch(() => {});
              toast(`已標記 ${formatTime(time)}`, { description: label });
              return;
            }
            const replay = await obs.call("GetReplayBufferStatus");
            if (replay.outputActive) {
              await obs.call("SaveReplayBuffer");
              return;
            }
            toast.warning("OBS 沒有在錄影，也沒有開啟重播緩衝");
          } catch (err) {
            toast.error("標記失敗", { description: errorMessage(err) });
          }
        },
      };
    },
    {
      name: "obs-clip-editor/obs",
      // 只記住連線位址；密碼不落地
      partialize: ({ url }) => ({ url }),
    },
  ),
);
