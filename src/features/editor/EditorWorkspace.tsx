import { ClipPanel } from "@/features/clips/ClipPanel";
import { ExportBar } from "@/features/export/ExportBar";
import { LibraryPanel } from "@/features/library/LibraryPanel";
import { usePlayerStore } from "@/features/player/player-store";
import { VideoPlayer } from "@/features/player/VideoPlayer";
import { useActiveRecording, useProjectStore } from "@/features/project/project-store";
import { Timeline } from "@/features/timeline/Timeline";
import { useEditorShortcuts } from "./use-editor-shortcuts";
import { useMediaSource } from "./use-media-source";

/** 主編輯畫面：左側錄影檔、中間預覽、右側片段、下方時間軸與匯出 */
export function EditorWorkspace() {
  const recording = useActiveRecording();
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const media = usePlayerStore((s) => s.media);
  const source = useMediaSource(recording);
  useEditorShortcuts();

  const { addClipAt, addClip, updateClip, selectClip } = useProjectStore.getState();

  return (
    <main className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_300px] grid-rows-[minmax(0,1fr)_auto]">
      <LibraryPanel />

      {recording ? (
        <VideoPlayer
          key={recording.id}
          url={source.url}
          fps={recording.info?.video?.fps ?? 30}
          remuxProgress={source.remuxProgress}
          error={recording.infoError ?? source.error}
          onAddClip={() => addClipAt(recording.id, usePlayerStore.getState().media?.currentTime ?? 0)}
        />
      ) : (
        <section className="flex items-center justify-center text-sm text-muted-foreground">
          從左側選擇或開啟一個錄影檔
        </section>
      )}

      <ClipPanel recording={recording} />

      <div className="col-span-3 border-t">
        {recording && (
          <Timeline
            media={source.url ? media : null}
            peaks={source.peaks}
            loading={source.loadingPeaks}
            clips={recording.clips}
            selectedClipId={selectedClipId}
            onSelect={selectClip}
            onChange={(clipId, range) => updateClip(recording.id, clipId, range)}
            onCreate={(clip) => addClip(recording.id, clip)}
          />
        )}
        <ExportBar recording={recording} />
      </div>
    </main>
  );
}
