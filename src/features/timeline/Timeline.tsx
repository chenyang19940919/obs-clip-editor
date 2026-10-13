import { LoaderCircle, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import type { Clip } from "@/features/project/project-store";
import type { Peaks } from "@/lib/ipc";
import { formatTime } from "@/lib/utils";

interface Props {
  media: HTMLVideoElement | null;
  peaks: Peaks | null;
  loading: boolean;
  clips: Clip[];
  selectedClipId: string | null;
  onSelect: (clipId: string) => void;
  onChange: (clipId: string, range: { start: number; end: number }) => void;
  onCreate: (clip: { id: string; start: number; end: number }) => void;
}

const COLORS = {
  region: "rgba(80, 140, 255, 0.18)",
  selected: "rgba(80, 140, 255, 0.38)",
  wave: "#4b5563",
  progress: "#22a374",
  cursor: "#f5f5f5",
};

/**
 * 波形 + 片段時間軸（wavesurfer.js）。
 * 播放直接驅動共用的 `<video>`，波形資料由後端預先計算。
 */
export function Timeline({ media, peaks, loading, clips, selectedClipId, onSelect, onChange, onCreate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [zoom, setZoom] = useState(0);

  // 讓 wavesurfer 的事件永遠呼叫到最新的 callback 與片段資料
  const latest = useRef({ clips, onSelect, onChange, onCreate });
  latest.current = { clips, onSelect, onChange, onCreate };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !media || !peaks) return;

    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container,
      media,
      peaks: [peaks.data],
      duration: peaks.duration,
      height: 72,
      waveColor: COLORS.wave,
      progressColor: COLORS.progress,
      cursorColor: COLORS.cursor,
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      dragToSeek: true,
      autoScroll: true,
      autoCenter: false,
      plugins: [
        regions,
        TimelinePlugin.create({
          height: 18,
          formatTimeCallback: (s) => formatTime(s),
          style: { color: "#9ca3af", fontSize: "11px" },
        }),
      ],
    });

    // 在空白處拖曳 → 新增片段
    regions.enableDragSelection({ color: COLORS.region });
    regions.on("region-created", (region: Region) => {
      if (!latest.current.clips.some((c) => c.id === region.id)) {
        latest.current.onCreate({ id: region.id, start: region.start, end: region.end });
      }
    });
    regions.on("region-updated", (region: Region) =>
      latest.current.onChange(region.id, { start: region.start, end: region.end }),
    );
    regions.on("region-clicked", (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      latest.current.onSelect(region.id);
      ws.setTime(region.start);
    });

    regionsRef.current = regions;
    wsRef.current = ws;
    return () => {
      regionsRef.current = null;
      wsRef.current = null;
      ws.destroy();
    };
  }, [media, peaks]);

  // 把 store 中的片段同步成 wavesurfer regions（以 id 比對，只更新有變動的）
  // biome-ignore lint/correctness/useExhaustiveDependencies: media/peaks 改變時 regions 會重建，需要重新同步
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;

    const existing = new Map(regions.getRegions().map((r) => [r.id, r]));
    clips.forEach((clip, i) => {
      const color = clip.id === selectedClipId ? COLORS.selected : COLORS.region;
      const content = `${i + 1}`;
      const region = existing.get(clip.id);
      if (!region) {
        regions.addRegion({ id: clip.id, start: clip.start, end: clip.end, color, content });
      } else if (region.start !== clip.start || region.end !== clip.end || region.color !== color) {
        region.setOptions({ start: clip.start, end: clip.end, color, content });
      } else {
        region.setContent(content);
      }
      existing.delete(clip.id);
    });
    for (const orphan of existing.values()) orphan.remove();
  }, [clips, selectedClipId, media, peaks]);

  useEffect(() => {
    wsRef.current?.zoom(zoom);
  }, [zoom]);

  return (
    <div className="px-3 pt-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>時間軸</span>
        {loading && (
          <span className="flex items-center gap-1">
            <LoaderCircle className="size-3 animate-spin" /> 分析音訊波形…
          </span>
        )}
        <span className="ml-2">在波形上拖曳可新增片段，拖曳片段邊緣可調整範圍</span>
        <label className="ml-auto flex items-center gap-1.5">
          <ZoomIn className="size-3.5" />
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-28 accent-primary"
            aria-label="時間軸縮放"
          />
        </label>
      </div>
      <div
        ref={containerRef}
        className="min-h-[94px] rounded-md bg-muted/50 [&_[part~=region-content]]:px-1 [&_[part~=region-content]]:text-[11px] [&_[part~=region-content]]:text-white"
      />
    </div>
  );
}
