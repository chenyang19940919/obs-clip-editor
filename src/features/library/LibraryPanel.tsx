import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, History, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { type Recording, useActiveRecording, useProjectStore } from "@/features/project/project-store";
import { cn, formatBytes, formatTime } from "@/lib/utils";

const VIDEO_EXTENSIONS = ["mkv", "mp4", "mov", "flv", "ts", "m4v", "webm", "avi", "wmv", "mpg", "mpeg", "m2ts"];

export function LibraryPanel() {
  const recordings = useProjectStore((s) => s.recordings);
  const activeId = useProjectStore((s) => s.activeId);
  const { addRecording, setActive, removeRecording } = useProjectStore.getState();
  const active = useActiveRecording();

  const openFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "影片", extensions: VIDEO_EXTENSIONS }],
    });
    for (const path of selected ?? []) addRecording(path, "file");
  };

  return (
    <aside className="flex min-h-0 flex-col border-r">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-xs text-muted-foreground">錄影檔</span>
        <Button size="sm" variant="ghost" onClick={() => void openFiles()}>
          <FolderOpen /> 開啟
        </Button>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
        {recordings.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-muted-foreground">
            連上 OBS 後錄影結束會自動匯入，
            <br />
            也可以手動開啟影片檔
          </li>
        )}
        {recordings.map((r) => (
          <RecordingItem
            key={r.id}
            recording={r}
            active={r.id === activeId}
            onSelect={() => setActive(r.id)}
            onRemove={() => removeRecording(r.id)}
          />
        ))}
      </ul>

      {active?.info && active.info.audioTracks.length > 0 && (
        <div className="border-t px-3 py-3">
          <div className="mb-2 text-xs text-muted-foreground">匯出音軌</div>
          <div className="space-y-1.5">
            {active.info.audioTracks.map((t) => (
              <label key={t.index} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={active.audioTracks.includes(t.index)}
                  onCheckedChange={() => useProjectStore.getState().toggleTrack(active.id, t.index)}
                />
                <span className="truncate">{t.title ?? `音軌 ${t.index + 1}`}</span>
                <span className="ml-auto text-muted-foreground">
                  {t.codec} · {t.channels}ch
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function RecordingItem({
  recording: r,
  active,
  onSelect,
  onRemove,
}: {
  recording: Recording;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const Icon = r.source === "replay" ? History : Video;
  return (
    <li
      className={cn(
        "group relative rounded-md hover:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring",
        active && "bg-primary/15 hover:bg-primary/20",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-2 px-2 py-1.5 pr-7 text-left outline-none"
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", active && "text-primary")} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs" title={r.path}>
            {r.name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {r.infoError
              ? "無法讀取"
              : r.info
                ? `${formatTime(r.info.duration)} · ${formatBytes(r.info.size)} · ${r.clips.length} 段`
                : "讀取中…"}
          </div>
        </div>
      </button>
      <button
        type="button"
        aria-label="從清單移除"
        onClick={onRemove}
        className="invisible absolute top-1.5 right-1.5 rounded p-0.5 text-muted-foreground group-hover:visible hover:text-destructive focus-visible:visible"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
