import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFfmpegStore } from "./ffmpeg-store";

/** 找不到 FFmpeg 時顯示安裝說明 */
export function FfmpegBanner() {
  const { error, checking, check } = useFfmpegStore();
  if (!error) return null;

  return (
    <div className="flex items-center gap-3 border-b bg-destructive/10 px-3 py-2 text-xs">
      <TriangleAlert className="size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="text-destructive">{error}</div>
        <div className="text-muted-foreground">
          安裝方式：在終端機執行 <code className="rounded bg-muted px-1 font-mono">winget install Gyan.FFmpeg</code>
          ，然後重新啟動本程式。
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => void check()} disabled={checking}>
        {checking && <LoaderCircle className="animate-spin" />}重新檢查
      </Button>
    </div>
  );
}
