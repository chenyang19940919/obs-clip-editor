import { create } from "zustand";

/**
 * 共用的 `<video>` 元素與播放狀態，
 * 讓時間軸、片段清單、快捷鍵都能控制同一個播放器。
 */
interface PlayerState {
  media: HTMLVideoElement | null;
  currentTime: number;
  duration: number;
  playing: boolean;

  setMedia: (media: HTMLVideoElement | null) => void;
  sync: (patch: Partial<Pick<PlayerState, "currentTime" | "duration" | "playing">>) => void;
  seek: (time: number) => void;
  seekBy: (delta: number) => void;
  toggle: () => void;
}

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  media: null,
  currentTime: 0,
  duration: 0,
  playing: false,

  setMedia: (media) => set({ media }),
  sync: (patch) => set(patch),

  seek: (time) => {
    const { media } = get();
    if (!media) return;
    const duration = Number.isFinite(media.duration) ? media.duration : time;
    media.currentTime = Math.min(Math.max(0, time), duration);
  },

  seekBy: (delta) => get().seek((get().media?.currentTime ?? 0) + delta),

  toggle: () => {
    const { media } = get();
    if (!media) return;
    if (media.paused) void media.play();
    else media.pause();
  },
}));
