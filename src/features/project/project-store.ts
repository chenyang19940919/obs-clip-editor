import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { ipc, type MediaInfo } from "@/lib/ipc";
import { errorMessage, fileName } from "@/lib/utils";

export interface Clip {
  id: string;
  label: string;
  start: number;
  end: number;
}

export type RecordingSource = "obs" | "replay" | "file";

export interface Recording {
  id: string;
  path: string;
  name: string;
  source: RecordingSource;
  clips: Clip[];
  /** 匯出時要保留的音軌（對應 `0:a:N`） */
  audioTracks: number[];
  info: MediaInfo | null;
  infoError: string | null;
}

export interface Marker {
  /** 錄影開始後經過的秒數 */
  time: number;
  label: string;
}

interface ProjectState {
  recordings: Recording[];
  activeId: string | null;
  selectedClipId: string | null;
  /** 標記點轉成片段時，往前 / 往後各取幾秒 */
  padding: { before: number; after: number };

  addRecording: (path: string, source: RecordingSource, markers?: Marker[]) => string;
  removeRecording: (id: string) => void;
  setActive: (id: string) => void;
  loadInfo: (id: string) => Promise<void>;
  setPadding: (padding: Partial<ProjectState["padding"]>) => void;
  toggleTrack: (id: string, track: number) => void;

  addClipAt: (id: string, time: number, label?: string) => string;
  addClip: (id: string, clip: Omit<Clip, "label"> & { label?: string }) => void;
  updateClip: (id: string, clipId: string, patch: Partial<Omit<Clip, "id">>) => void;
  removeClip: (id: string, clipId: string) => void;
  selectClip: (clipId: string | null) => void;
}

const sortClips = (clips: Clip[]) => [...clips].sort((a, b) => a.start - b.start);

const mapRecording = (state: ProjectState, id: string, fn: (r: Recording) => Recording) => ({
  recordings: state.recordings.map((r) => (r.id === id ? fn(r) : r)),
});

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => {
      const clipAround = (recording: Recording | undefined, time: number, label: string): Clip => {
        const { before, after } = get().padding;
        const duration = recording?.info?.duration ?? Number.POSITIVE_INFINITY;
        return {
          id: crypto.randomUUID(),
          label,
          start: Math.max(0, time - before),
          end: Math.min(duration, time + after),
        };
      };

      return {
        recordings: [],
        activeId: null,
        selectedClipId: null,
        padding: { before: 20, after: 10 },

        addRecording: (path, source, markers = []) => {
          const existing = get().recordings.find((r) => r.path === path);
          const id = existing?.id ?? crypto.randomUUID();
          const clips = markers.map((m) => clipAround(existing, m.time, m.label));

          set((state) => ({
            activeId: id,
            selectedClipId: null,
            recordings: existing
              ? state.recordings.map((r) => (r.id === id ? { ...r, clips: sortClips([...r.clips, ...clips]) } : r))
              : [
                  {
                    id,
                    path,
                    name: fileName(path),
                    source,
                    clips: sortClips(clips),
                    audioTracks: [],
                    info: null,
                    infoError: null,
                  },
                  ...state.recordings,
                ],
          }));
          if (!existing?.info) void get().loadInfo(id);
          return id;
        },

        removeRecording: (id) =>
          set((state) => ({
            recordings: state.recordings.filter((r) => r.id !== id),
            activeId: state.activeId === id ? null : state.activeId,
          })),

        setActive: (id) => {
          set({ activeId: id, selectedClipId: null });
          if (!get().recordings.find((r) => r.id === id)?.info) void get().loadInfo(id);
        },

        loadInfo: async (id) => {
          const recording = get().recordings.find((r) => r.id === id);
          if (!recording) return;
          try {
            const info = await ipc.probeMedia(recording.path);
            set((state) =>
              mapRecording(state, id, (r) => ({
                ...r,
                info,
                infoError: null,
                // 預設勾選全部音軌；並把超出影片長度的片段截掉
                audioTracks: r.audioTracks.length ? r.audioTracks : info.audioTracks.map((t) => t.index),
                clips: r.clips.map((c) => ({ ...c, end: Math.min(c.end, info.duration) })),
              })),
            );
          } catch (err) {
            set((state) => mapRecording(state, id, (r) => ({ ...r, info: null, infoError: errorMessage(err) })));
          }
        },

        setPadding: (padding) => set((state) => ({ padding: { ...state.padding, ...padding } })),

        toggleTrack: (id, track) =>
          set((state) =>
            mapRecording(state, id, (r) => ({
              ...r,
              audioTracks: r.audioTracks.includes(track)
                ? r.audioTracks.filter((t) => t !== track)
                : [...r.audioTracks, track].sort((a, b) => a - b),
            })),
          ),

        addClipAt: (id, time, label) => {
          const recording = get().recordings.find((r) => r.id === id);
          const clip = clipAround(recording, time, label ?? `片段 ${(recording?.clips.length ?? 0) + 1}`);
          set((state) => ({
            ...mapRecording(state, id, (r) => ({ ...r, clips: sortClips([...r.clips, clip]) })),
            selectedClipId: clip.id,
          }));
          return clip.id;
        },

        addClip: (id, { label, ...clip }) =>
          set((state) => ({
            ...mapRecording(state, id, (r) => ({
              ...r,
              clips: sortClips([...r.clips, { ...clip, label: label ?? `片段 ${r.clips.length + 1}` }]),
            })),
            selectedClipId: clip.id,
          })),

        updateClip: (id, clipId, patch) =>
          set((state) =>
            mapRecording(state, id, (r) => ({
              ...r,
              clips: sortClips(r.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c))),
            })),
          ),

        removeClip: (id, clipId) =>
          set((state) => ({
            ...mapRecording(state, id, (r) => ({ ...r, clips: r.clips.filter((c) => c.id !== clipId) })),
            selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
          })),

        selectClip: (clipId) => set({ selectedClipId: clipId }),
      };
    },
    {
      name: "obs-clip-editor/project",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 影片資訊每次啟動重新讀取，避免檔案被移動或刪除後資料過期
      partialize: ({ recordings, activeId, padding }) => ({
        recordings: recordings.map((r) => ({ ...r, info: null, infoError: null })),
        activeId,
        padding,
      }),
    },
  ),
);

export const useActiveRecording = () => useProjectStore((s) => s.recordings.find((r) => r.id === s.activeId) ?? null);
