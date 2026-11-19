import { PauseCircle } from "lucide-react";
import { useState } from "react";
import type { MeResponse } from "../../shared/api";
import { copy } from "../copy";
import { api, errorMessage } from "../lib/api";
import { untilTime } from "../lib/format";
import { setQueryData } from "../lib/query";
import { useToast } from "../lib/toast";
import { Button } from "./ui";

export function usePause() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function pause(minutes: number | null) {
    setBusy(true);
    try {
      const me = await api.post<MeResponse>("/api/pause", { minutes });
      setQueryData("/api/me", me);
      toast(minutes ? `Paused until ${untilTime(me.settings.pausedUntil ?? Date.now())}.` : "Delivery is back on.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }
  return { busy, pause };
}

export function isPaused(me: MeResponse | undefined): me is MeResponse & { settings: { pausedUntil: number } } {
  return Boolean(me?.settings.pausedUntil && me.settings.pausedUntil > Date.now());
}

export function PausedBanner({ me }: { me: MeResponse | undefined }) {
  const { busy, pause } = usePause();
  if (!isPaused(me)) return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 pl-4">
      <PauseCircle className="size-5 shrink-0 text-amber-500" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">
          {copy.activity.paused} {untilTime(me.settings.pausedUntil)}
        </p>
        <p className="text-muted">{copy.activity.pausedBody}</p>
      </div>
      <Button small variant="primary" busy={busy} onClick={() => void pause(null)}>
        Resume
      </Button>
    </div>
  );
}
