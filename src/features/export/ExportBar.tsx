import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Download, FolderOpen, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFfmpegStore } from "@/features/ffmpeg/ffmpeg-store";
import type { Recording } from "@/features/project/project-store";
import { type Encoder, type ExportMode, ipc } from "@/lib/ipc";
import { dirName, errorMessage, fileName } from "@/lib/utils";

const ENCODER_LABELS: Record<Encoder, string> = {
  h264_nvenc: "精準剪 · NVIDIA NVENC",
  h264_qsv: "精準剪 · Intel QSV",
  h264_amf: "精準剪 · AMD AMF",
  libopenh264: "精準剪 · CPU (OpenH264)",
};

// selector 不能每次回傳新陣列，否則 zustand 會無限重新渲染
const NO_ENCODERS: Encoder[] = [];

interface Job {
  total: number;
  /** 每段的進度 0 ~ 1 */
  progress: number[];
  failed: string[];
}

export function ExportBar({ recording }: { recording: Recording | null }) {
  const encoders = useFfmpegStore((s) => s.info?.encoders) ?? NO_ENCODERS;
  const [mode, setMode] = useState("fast");
  const [customDir, setCustomDir] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);

  const clips = recording?.clips ?? [];
  const outputDir = customDir ?? (recording ? `${dirName(recording.path)}\\clips` : "");
  const overall = job ? job.progress.reduce((a, b) => a + b, 0) / job.total : 0;

  const chooseDir = async () => {
    const dir = await open({ directory: true, defaultPath: outputDir || undefined });
    if (dir) setCustomDir(dir);
  };

  const runExport = async () => {
    if (!recording || clips.length === 0) return;
    const exportMode: ExportMode = mode === "fast" ? { kind: "fast" } : { kind: "precise", encoder: mode as Encoder };
    setRunning(true);
    setJob({ total: clips.length, progress: clips.map(() => 0), failed: [] });

    try {
      const outputs = await ipc.exportClips(
        {
          input: recording.path,
          outputDir,
          clips: clips.map(({ label, start, end }) => ({ label, start, end })),
          audioTracks: recording.audioTracks,
          mode: exportMode,
        },
        (e) =>
          setJob((job) => {
            if (!job) return job;
            const progress = [...job.progress];
            if (e.event === "progress") progress[e.data.index] = e.data.ratio;
            if (e.event === "finished") progress[e.data.index] = 1;
            if (e.event === "failed") {
              progress[e.data.index] = 1;
              return { ...job, progress, failed: [...job.failed, `#${e.data.index + 1} ${e.data.error}`] };
            }
            return { ...job, progress };
          }),
      );

      const first = outputs[0];
      if (first) {
        toast.success(`已匯出 ${outputs.length} 段`, {
          description: outputDir,
          action: { label: "開啟資料夾", onClick: () => void revealItemInDir(first) },
        });
      }
      if (outputs.length < clips.length) {
        toast.error(`${clips.length - outputs.length} 段匯出失敗`, { description: "詳細原因請看匯出列" });
      }
    } catch (err) {
      toast.error("匯出失敗", { description: errorMessage(err) });
    } finally {
      setRunning(false);
      // 有失敗時保留錯誤訊息，下次匯出前清除
      setJob((job) => (job && job.failed.length > 0 ? job : null));
    }
  };

  return (
    <div className="flex items-center gap-3 border-t px-3 py-2">
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        {job ? (
          <div className="flex items-center gap-3">
            <Progress value={overall} className="max-w-60" />
            <span className="truncate">
              {job.failed.length > 0 ? (
                <span className="text-destructive">{job.failed.join("；")}</span>
              ) : (
                `匯出中 ${Math.round(overall * 100)}%`
              )}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void chooseDir()}
            disabled={!recording}
            className="flex max-w-full items-center gap-1.5 truncate hover:text-foreground"
            title={outputDir}
          >
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate">
              輸出到：{outputDir ? `…\\${fileName(dirName(outputDir))}\\${fileName(outputDir)}` : "—"}
            </span>
          </button>
        )}
      </div>

      <Select value={mode} onValueChange={setMode}>
        <SelectTrigger className="w-52 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fast">快速剪（不重新編碼）</SelectItem>
          {encoders.map((enc) => (
            <SelectItem key={enc} value={enc}>
              {ENCODER_LABELS[enc]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button onClick={() => void runExport()} disabled={!recording || clips.length === 0 || running}>
        {running ? <LoaderCircle className="animate-spin" /> : <Download />}
        匯出 {clips.length} 段
      </Button>
    </div>
  );
}
