import { Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlayerStore } from "@/features/player/player-store";
import { type Recording, useProjectStore } from "@/features/project/project-store";
import { cn, formatTime } from "@/lib/utils";

export function ClipPanel({ recording }: { recording: Recording | null }) {
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const padding = useProjectStore((s) => s.padding);
  const { selectClip, updateClip, removeClip, setPadding } = useProjectStore.getState();
  const seek = usePlayerStore((s) => s.seek);
  const clips = recording?.clips ?? [];

  const playClip = (clipId: string, start: number) => {
    selectClip(clipId);
    seek(start);
    void usePlayerStore.getState().media?.play();
  };

  return (
    <aside className="flex min-h-0 flex-col border-l">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-xs text-muted-foreground">片段 {clips.length > 0 && `（${clips.length}）`}</span>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
        {clips.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-muted-foreground">
            錄影時按 F9 標記，
            <br />
            或在時間軸上拖曳新增片段
          </li>
        )}
        {clips.map((clip, i) => (
          <li key={clip.id}>
            <div
              className={cn(
                "group rounded-md border border-transparent px-2 py-1.5 hover:bg-accent",
                clip.id === selectedClipId && "border-primary/60 bg-primary/10 hover:bg-primary/15",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-marker text-[11px] font-medium text-black">
                  {i + 1}
                </span>
                <Input
                  value={clip.label}
                  onChange={(e) => recording && updateClip(recording.id, clip.id, { label: e.target.value })}
                  onFocus={() => selectClip(clip.id)}
                  className="h-6 border-transparent bg-transparent px-1 text-xs hover:border-input"
                  aria-label="片段名稱"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="播放片段"
                  onClick={() => playClip(clip.id, clip.start)}
                >
                  <Play />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="刪除片段"
                  className="hover:text-destructive"
                  onClick={() => recording && removeClip(recording.id, clip.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              <button
                type="button"
                onClick={() => {
                  selectClip(clip.id);
                  seek(clip.start);
                }}
                className="mt-0.5 block w-full pl-6.5 text-left font-mono text-[11px] text-muted-foreground tabular-nums"
              >
                {formatTime(clip.start, true)} → {formatTime(clip.end, true)}（{formatTime(clip.end - clip.start)}）
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t px-3 py-3 text-xs">
        <div className="mb-2 text-muted-foreground">標記轉片段時的範圍</div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            往前
            <Input
              type="number"
              min={0}
              value={padding.before}
              onChange={(e) => setPadding({ before: Math.max(0, Number(e.target.value)) })}
              className="h-7 w-14 text-xs"
            />
            秒
          </label>
          <label className="flex items-center gap-1">
            往後
            <Input
              type="number"
              min={0}
              value={padding.after}
              onChange={(e) => setPadding({ after: Math.max(0, Number(e.target.value)) })}
              className="h-7 w-14 text-xs"
            />
            秒
          </label>
        </div>
      </div>
    </aside>
  );
}
