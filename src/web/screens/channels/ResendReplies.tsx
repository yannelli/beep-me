import { CircleCheck } from "lucide-react";
import type { ResendSetupState } from "../../../shared/resend";
import { CopyField } from "../../components/form";
import { Badge, Button } from "../../components/ui";
import type { RunAction } from "./ResendSetup";

export function ResendReplies({ base, state, busyPath, run }: { base: string; state: ResendSetupState; busyPath: string | null; run: RunAction }) {
  const path = `${base}/webhook`;

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Replies</h3>
      {state.webhookUrl === null ? (
        <p className="text-sm text-muted">Replies need a public https URL. Deploy Beep Me, then set up replies from the deployed dashboard.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Webhook URL</p>
            <CopyField value={state.webhookUrl} label="webhook URL" />
          </div>
          {state.webhook && state.secretSet ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <CircleCheck className="size-5 text-ok" aria-hidden />
              <span>Replies are on.</span>
              <Badge tone={state.webhook.status === "enabled" ? "ok" : "warn"}>Webhook {state.webhook.status || "unknown"}</Badge>
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">Resend sends each reply to this URL. Beep Me then gives it to the agent.</p>
              <Button
                small
                variant="primary"
                busy={busyPath === path}
                disabled={busyPath !== null}
                onClick={() => run({ title: "Create webhook?", confirmLabel: "Create webhook", path, success: "Replies are on." })}
              >
                Create webhook
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
