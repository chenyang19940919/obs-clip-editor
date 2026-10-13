import { useEffect } from "react";
import { Toaster } from "sonner";
import { EditorWorkspace } from "@/features/editor/EditorWorkspace";
import { FfmpegBanner } from "@/features/ffmpeg/FfmpegBanner";
import { useFfmpegStore } from "@/features/ffmpeg/ffmpeg-store";
import { ObsStatusBar } from "@/features/obs/ObsStatusBar";
import { useObsStore } from "@/features/obs/obs-store";
import { ipc } from "@/lib/ipc";

export function App() {
  useEffect(() => {
    void useFfmpegStore.getState().check();

    // 全域熱鍵（遊戲中也有效）→ 標記精華
    const unlisten = ipc.onMarkHotkey(() => void useObsStore.getState().mark());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <ObsStatusBar />
      <FfmpegBanner />
      <EditorWorkspace />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </div>
  );
}
