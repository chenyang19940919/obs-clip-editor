import { useEffect, useState } from "react";
import type { Recording } from "@/features/project/project-store";
import { ipc, type Peaks } from "@/lib/ipc";
import { errorMessage } from "@/lib/utils";

export interface MediaSource {
  /** `<video src>` 用的 URL */
  url: string | null;
  peaks: Peaks | null;
  /** 轉封裝進度（0 ~ 1），沒有在轉封裝時為 null */
  remuxProgress: number | null;
  loadingPeaks: boolean;
  error: string | null;
}

const EMPTY: MediaSource = { url: null, peaks: null, remuxProgress: null, loadingPeaks: false, error: null };

/** 準備預覽用的影片 URL 與波形資料 */
export function useMediaSource(recording: Recording | null): MediaSource {
  const [source, setSource] = useState<MediaSource>(EMPTY);
  const path = recording?.path;
  const info = recording?.info;
  // 波形顯示第一條勾選的音軌
  const waveformTrack = recording?.audioTracks[0] ?? info?.audioTracks[0]?.index;

  useEffect(() => {
    setSource(EMPTY);
    if (!path || !info) return;

    let cancelled = false;
    const update = (patch: Partial<MediaSource>) => {
      if (!cancelled) setSource((s) => ({ ...s, ...patch }));
    };

    if (info.needsRemux) update({ remuxProgress: 0 });
    ipc
      .preparePreview(path, (ratio) => update({ remuxProgress: ratio }))
      .then((url) => update({ url, remuxProgress: null }))
      .catch((err) => update({ error: errorMessage(err), remuxProgress: null }));

    return () => {
      cancelled = true;
    };
  }, [path, info]);

  useEffect(() => {
    if (!path || !info) return;
    if (waveformTrack === undefined) {
      // 沒有音軌時給一條平線，時間軸仍可操作
      setSource((s) => ({ ...s, peaks: { data: [0], duration: info.duration } }));
      return;
    }

    let cancelled = false;
    setSource((s) => ({ ...s, loadingPeaks: true }));
    ipc
      .loadPeaks(path, waveformTrack)
      .then((peaks) => !cancelled && setSource((s) => ({ ...s, peaks, loadingPeaks: false })))
      .catch((err) => !cancelled && setSource((s) => ({ ...s, error: errorMessage(err), loadingPeaks: false })));

    return () => {
      cancelled = true;
    };
  }, [path, info, waveformTrack]);

  return source;
}
