import { useState, type ReactNode } from "react";
import type { MeResponse } from "../../../shared/api";
import { CopyField } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { Skeleton } from "../../components/ui";
import { copy } from "../../copy";
import { Link } from "../../lib/router";
import { useQuery } from "../../lib/query";
import { mcpCommand, TokenAgentForm } from "./TokenAgent";

type Tab = "claude" | "code" | "other" | "token";

const GUIDES: Record<Tab, string> = {
  claude: "/docs/agents/claude",
  code: "/docs/agents/claude-code",
  other: "/docs/agents/other-clients",
  token: "/docs/agents/scripts",
};

const tabs: { value: Tab; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "code", label: "Claude Code" },
  { value: "other", label: "Other" },
  { value: "token", label: "Scripts" },
];

function Steps({ steps, extras }: { steps: readonly string[]; extras: Record<number, ReactNode> }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, index) => (
        <li key={step} className="flex gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{index + 1}</span>
          <div className="min-w-0 flex-1 space-y-2 pt-0.5 text-[15px]">
            <p>{step}</p>
            {extras[index]}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ConnectAgentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("claude");
  const [token, setToken] = useState<string | null>(null);
  const me = useQuery<MeResponse>("/api/me");
  const mcpUrl = me.data?.mcpUrl ?? "";
  const urlField = me.data ? <CopyField value={mcpUrl} label="MCP URL" /> : <Skeleton className="h-12" />;

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
        setToken(null);
      }}
      title="Connect an agent"
    >
      <div role="tablist" aria-label="Agent type" className="-mx-5 mb-5 flex gap-1 overflow-x-auto border-b border-line px-5 [scrollbar-width:none]">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`tab-${item.value}`}
            aria-selected={tab === item.value}
            aria-controls="agent-tabpanel"
            onClick={() => setTab(item.value)}
            className={`-mb-px min-h-11 flex-1 shrink-0 border-b-2 px-2 text-sm font-medium whitespace-nowrap ${tab === item.value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="agent-tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "claude" && <Steps steps={copy.agents.claudeSteps} extras={{ 1: urlField }} />}
        {tab === "code" && (
          <Steps steps={copy.agents.claudeCodeSteps} extras={{ 0: me.data ? <CopyField value={mcpCommand(mcpUrl)} label="command" multiline /> : <Skeleton className="h-12" /> }} />
        )}
        {tab === "other" && <Steps steps={copy.agents.otherSteps} extras={{ 0: urlField }} />}
        {tab === "token" && <TokenAgentForm token={token} onToken={setToken} />}
        <Link href={GUIDES[tab]} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-accent">
          {copy.docs.fullGuide}
        </Link>
      </div>
    </Sheet>
  );
}
