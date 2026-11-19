import { Send } from "lucide-react";
import { useState } from "react";
import type { ChannelDTO, TestResult } from "../../../shared/api";
import type { ChannelTarget } from "../../../shared/channels";
import { Button } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fetchQuery, invalidate } from "../../lib/query";

export function ChannelTests({ channel, primary }: { channel: ChannelDTO; primary?: boolean }) {
  const [busy, setBusy] = useState<ChannelTarget | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const topicTest = channel.kind === "telegram" && channel.targets.includes("topic");

  async function run(target: ChannelTarget) {
    setBusy(target);
    setResult(null);
    try {
      const response = await api.post<TestResult>(`/api/channels/${channel.id}/test`, { target });
      setResult({ ok: response.ok, text: response.detail || (response.ok ? "Sent." : "The test failed.") });
    } catch (error) {
      setResult({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(null);
      invalidate("/api/channels", "/api/messages?");
      void fetchQuery("/api/me");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button small variant={primary ? "primary" : "secondary"} busy={busy === "main"} disabled={busy !== null} onClick={() => void run("main")}>
          {busy !== "main" && <Send className="size-4" aria-hidden />}
          Test
        </Button>
        {topicTest && (
          <Button small busy={busy === "topic"} disabled={busy !== null} onClick={() => void run("topic")}>
            Test topic thread
          </Button>
        )}
      </div>
      {result && (
        <p role="status" className={`text-sm break-words ${result.ok ? "text-ok" : "text-danger"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
