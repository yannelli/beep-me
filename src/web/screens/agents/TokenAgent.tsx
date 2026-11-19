import { TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AgentDTO, MeResponse } from "../../../shared/api";
import type { Priority } from "../../../shared/priority";
import { CopyField, FieldGroup, TextField } from "../../components/form";
import { PriorityPicker } from "../../components/PriorityPicker";
import { Button } from "../../components/ui";
import { copy } from "../../copy";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { fetchQuery, invalidate, useQuery } from "../../lib/query";
import { useToast } from "../../lib/toast";
import { ChannelScope } from "./ChannelScope";

export function curlCommand(notifyUrl: string, token: string) {
  return `curl -X POST ${notifyUrl} -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"message":"Build finished","priority":"medium","topic":"ci"}'`;
}

export function mcpCommand(mcpUrl: string, token?: string) {
  const base = `claude mcp add --transport http --scope user beep-me ${mcpUrl}`;
  return token ? `${base} --header "Authorization: Bearer ${token}"` : base;
}

export function TokenReveal({ token }: { token: string }) {
  const me = useQuery<MeResponse>("/api/me");
  return (
    <div className="space-y-4">
      <p role="status" className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
        {copy.agents.tokenOnce}
      </p>
      <CopyField value={token} label="token" multiline />
      {me.data && (
        <>
          <p className="text-sm text-muted">{copy.agents.tokenCurl}</p>
          <CopyField value={curlCommand(me.data.notifyUrl, token)} label="curl command" multiline />
          <p className="text-sm text-muted">{copy.agents.tokenMcp}</p>
          <CopyField value={mcpCommand(me.data.mcpUrl, token)} label="Claude Code command" multiline />
        </>
      )}
    </div>
  );
}

export function TokenAgentForm({ token, onToken }: { token: string | null; onToken: (token: string) => void }) {
  const [name, setName] = useState("");
  const [maxPriority, setMaxPriority] = useState<Priority>("high");
  const [channelIds, setChannelIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setErrors({ name: "Give the agent a name." });
    setBusy(true);
    setErrors({});
    try {
      const result = await api.post<{ agent: AgentDTO; token: string }>("/api/agents", { name: name.trim(), maxPriority, channelIds });
      onToken(result.token);
      invalidate("/api/agents");
      void fetchQuery("/api/me");
    } catch (error) {
      setErrors(fieldErrors(error));
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  if (token) return <TokenReveal token={token} />;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-muted">{copy.agents.tokenIntro}</p>
      <TextField label="Name" placeholder="GitHub Actions" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} autoComplete="off" />
      <FieldGroup label="Highest priority it can send">
        <PriorityPicker label="Highest priority" value={maxPriority} onChange={setMaxPriority} />
      </FieldGroup>
      <FieldGroup label="Channels">
        <ChannelScope value={channelIds} onChange={setChannelIds} />
      </FieldGroup>
      <Button type="submit" variant="primary" className="w-full" busy={busy}>
        Create token
      </Button>
    </form>
  );
}
