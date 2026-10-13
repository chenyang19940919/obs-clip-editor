import { ChevronLeft, ChevronRight, LoaderCircle, Pause, Play, Plus } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatTime } from "@/lib/utils";
import { usePlayerStore } from "./player-store";

interface Props {
  url: string | null;
  fps: number;
  remuxProgress: number | null;
  error: string | null;
  onAddClip: () => void;
}

export function VideoPlayer({ url, fps, remuxProgress, error, onAddClip }: Props) {
  const { currentTime, duration, playing, setMedia, sync, toggle, seekBy } = usePlayerStore();
  const frame = 1 / (fps || 30);

  // callback ref：元素掛上 / 卸下時同步到共用 store
  const attach = useCallback((el: HTMLVideoElement | null) => setMedia(el), [setMedia]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-2 p-3">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
        {url && (
          // biome-ignore lint/a11y/useMediaCaption: 錄影檔沒有字幕軌
          <video
            ref={attach}
            src={url}
            className="h-full w-full object-contain"
            preload="auto"
            onLoadedMetadata={(e) => sync({ duration: e.currentTarget.duration, currentTime: 0 })}
            onTimeUpdate={(e) => sync({ currentTime: e.currentTarget.currentTime })}
            onPlay={() => sync({ playing: true })}
            onPause={() => sync({ playing: false })}
            onClick={toggle}
          />
        )}

        {!url && (
          <div className="flex w-64 flex-col items-center gap-3 text-xs text-muted-foreground">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : remuxProgress !== null ? (
              <>
                <span>轉封裝成 MP4 供預覽…（不重新編碼）</span>
                <Progress value={remuxProgress} />
              </>
            ) : (
              <LoaderCircle className="size-5 animate-spin" />
            )}
          </div>
        )}

        {url && (
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white tabular-nums">
            {formatTime(currentTime, true)} / {formatTime(duration)}
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="上一格" onClick={() => seekBy(-frame)}>
          <ChevronLeft />
        </Button>
        <Button size="icon" variant="secondary" aria-label={playing ? "暫停" : "播放"} onClick={toggle} disabled={!url}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="下一格" onClick={() => seekBy(frame)}>
          <ChevronRight />
        </Button>
        <Button size="sm" variant="outline" className="ml-3" onClick={onAddClip} disabled={!url}>
          <Plus /> 在此新增片段（M）
        </Button>
        <span className="ml-3 text-xs text-muted-foreground">空白鍵 播放 · I／O 設入出點 · Del 刪除</span>
      </div>
    </section>
  );
}
