import { create } from "zustand";
import { type FfmpegInfo, ipc } from "@/lib/ipc";
import { errorMessage } from "@/lib/utils";

interface FfmpegState {
  info: FfmpegInfo | null;
  error: string | null;
  checking: boolean;
  check: () => Promise<void>;
}

export const useFfmpegStore = create<FfmpegState>()((set) => ({
  info: null,
  error: null,
  checking: false,

  check: async () => {
    set({ checking: true });
    try {
      set({ info: await ipc.checkFfmpeg(), error: null });
    } catch (err) {
      set({ info: null, error: errorMessage(err) });
    } finally {
      set({ checking: false });
    }
  },
}));
