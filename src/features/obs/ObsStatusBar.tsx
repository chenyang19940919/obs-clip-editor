import { CircleDot, Flag, LoaderCircle, PlugZap, Scissors, Unplug } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type HotkeyInfo, ipc } from "@/lib/ipc";
import { formatTime } from "@/lib/utils";
import { useObsStore } from "./obs-store";

export function ObsStatusBar() {
  const { url, status, recording, elapsed, markers, setUrl, connect, disconnect, mark } = useObsStore();
  const [password, setPassword] = useState("");
  const [hotkey, setHotkey] = useState<HotkeyInfo | null>(null);

  useEffect(() => {
    ipc.hotkeyInfo().then(setHotkey, () => setHotkey(null));
  }, []);

  const onConnect = (e: FormEvent) => {
    e.preventDefault();
    void connect(password);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <div className="flex items-center gap-2 font-medium">
        <Scissors className="size-4 text-primary" />
        OBS Clip Editor
      </div>

      <div className="ml-auto flex items-center gap-2">
        {status === "connected" ? (
          <>
            <Badge variant="success">
              <PlugZap /> OBS 已連線
            </Badge>
            {recording ? (
              <Badge variant="destructive" className="font-mono tabular-nums">
                <CircleDot className="animate-pulse" /> 錄影中 {formatTime(elapsed)}
              </Badge>
            ) : (
              <Badge>未錄影</Badge>
            )}
            {markers.length > 0 && <Badge variant="primary">已標記 {markers.length}</Badge>}
            <Button size="sm" onClick={() => void mark()}>
              <Flag /> 標記精華{hotkey?.registered ? `（${hotkey.key}）` : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
              <Unplug /> 中斷
            </Button>
          </>
        ) : (
          <form onSubmit={onConnect} className="flex items-center gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-7 w-48 text-xs"
              aria-label="OBS WebSocket 位址"
            />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密碼（選填）"
              className="h-7 w-32 text-xs"
              aria-label="OBS WebSocket 密碼"
            />
            <Button size="sm" type="submit" disabled={status === "connecting"}>
              {status === "connecting" ? <LoaderCircle className="animate-spin" /> : <PlugZap />}
              連線 OBS
            </Button>
          </form>
        )}
        {hotkey && !hotkey.registered && (
          <Badge variant="destructive" title="可能已被其他程式佔用">
            熱鍵 {hotkey.key} 註冊失敗
          </Badge>
        )}
      </div>
    </header>
  );
}
