import { useState } from "react";
import type { ApiError, ChannelDTO } from "../../../shared/api";
import type { ResendPreview, ResendSetupState } from "../../../shared/resend";
import { ConfirmSheet } from "../../components/Sheet";
import { ErrorBox, Skeleton } from "../../components/ui";
import { api, ApiRequestError, errorMessage, UNAUTHORIZED_EVENT } from "../../lib/api";
import { invalidate, useQuery } from "../../lib/query";
import { useToast } from "../../lib/toast";
import { ResendDomain } from "./ResendDomain";
import { ResendReplies } from "./ResendReplies";

export interface ResendAction {
  title: string;
  confirmLabel: string;
  path: string;
  body?: Record<string, unknown>;
  success: string;
  onError?: (error: unknown) => void;
}

export type RunAction = (action: ResendAction) => void;

/** Sends the change without confirm and returns the summary from the 409 preview. */
async function fetchPreview(path: string, body: Record<string, unknown>): Promise<string> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, { error: "Beep Me is offline. Check your connection. Then try again." });
  }
  const json = (await response.json().catch(() => ({}))) as Partial<ResendPreview> & Partial<ApiError>;
  if (response.status === 409 && json.preview) return json.preview.summary;
  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  throw new ApiRequestError(response.status, { error: json.error ?? `Request failed (${response.status}).`, fields: json.fields });
}

export function ResendSetup({ channel }: { channel: ChannelDTO }) {
  const base = `/api/integrations/resend/${channel.id}`;
  const state = useQuery<ResendSetupState>(base);
  const toast = useToast();
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: ResendAction; summary: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run: RunAction = (action) => {
    setBusyPath(action.path);
    fetchPreview(action.path, action.body ?? {})
      .then((summary) => setPending({ action, summary }))
      .catch((error: unknown) => {
        if (action.onError) action.onError(error);
        else toast(errorMessage(error), "error");
      })
      .finally(() => setBusyPath(null));
  };

  async function confirm() {
    if (!pending) return;
    setConfirming(true);
    try {
      await api.post(pending.action.path, { ...pending.action.body, confirm: true });
      toast(pending.action.success);
      setPending(null);
      invalidate(base, `/api/channels/${channel.id}`);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setConfirming(false);
    }
  }

  if (!state.data) {
    if (state.error) return <ErrorBox error={errorMessage(state.error)} onRetry={() => void state.refetch()} />;
    return (
      <div className="space-y-3" role="status" aria-label="Loading">
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const setup = state.data;
  if (setup.keyError) {
    return (
      <div className="space-y-3">
        <ErrorBox error={setup.keyError} onRetry={() => void state.refetch()} />
        <p className="text-sm text-muted">Domain setup and replies need a full access key. Paste one in Settings below.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ResendDomain base={base} domain={setup.domain} busyPath={busyPath} run={run} />
      <div className="border-t border-line pt-4">
        <ResendReplies base={base} state={setup} busyPath={busyPath} run={run} />
      </div>
      <ConfirmSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.action.title ?? ""}
        body={pending?.summary ?? ""}
        confirmLabel={pending?.action.confirmLabel ?? "Confirm"}
        busy={confirming}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
