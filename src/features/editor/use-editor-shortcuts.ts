import { useEffect } from "react";
import { usePlayerStore } from "@/features/player/player-store";
import { useProjectStore } from "@/features/project/project-store";

/** 編輯器快捷鍵；焦點在輸入框時不觸發 */
export function useEditorShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true], [role=combobox]")) return;

      const player = usePlayerStore.getState();
      const project = useProjectStore.getState();
      const recordingId = project.activeId;
      const clipId = project.selectedClipId;
      const now = player.media?.currentTime ?? 0;

      switch (e.key) {
        case " ":
          player.toggle();
          break;
        case "ArrowLeft":
          player.seekBy(e.shiftKey ? -5 : -1);
          break;
        case "ArrowRight":
          player.seekBy(e.shiftKey ? 5 : 1);
          break;
        case "m":
        case "M":
          if (recordingId) project.addClipAt(recordingId, now);
          break;
        case "i":
        case "I":
          if (recordingId && clipId) project.updateClip(recordingId, clipId, { start: now });
          break;
        case "o":
        case "O":
          if (recordingId && clipId) project.updateClip(recordingId, clipId, { end: now });
          break;
        case "Delete":
        case "Backspace":
          if (recordingId && clipId) project.removeClip(recordingId, clipId);
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
