import { TriangleAlert } from "lucide-react";
import type { MeResponse } from "../../../shared/api";
import { CopyField } from "../../components/form";
import { copy } from "../../copy";
import { useQuery } from "../../lib/query";
import { TokenAgentForm } from "./TokenAgent";

/** The GitHub repository that holds the plugin marketplace for Claude Code, Codex, and pi. */
export const PLUGIN_MARKETPLACE = "yannelli/beep-me";

export function pluginCommands(mcpUrl: string, token: string) {
  const origin = mcpUrl.replace(/\/mcp$/, "");
  const values = JSON.stringify({ url: mcpUrl, token });
  return {
    claude: [
      `claude plugin marketplace add ${PLUGIN_MARKETPLACE}`,
      "claude plugin install beep-me@beep-me",
      `echo '${values}' | claude plugin configure beep-me@beep-me --values-stdin`,
    ].join("\n"),
    codex: [
      `export BEEPME_URL=${origin}`,
      `export BEEPME_TOKEN=${token}`,
      `codex plugin marketplace add ${PLUGIN_MARKETPLACE}`,
      "codex plugin add beep-me@beep-me",
      `codex mcp add beep-me --url ${mcpUrl} --bearer-token-env-var BEEPME_TOKEN`,
    ].join("\n"),
    piInstall: `/claude:plugin install ${PLUGIN_MARKETPLACE}`,
    piConfig: `/claude:plugin config beep-me@beep-me url=${mcpUrl} token=${token}`,
  };
}

function PluginReveal({ token }: { token: string }) {
  const me = useQuery<MeResponse>("/api/me");
  const commands = me.data ? pluginCommands(me.data.mcpUrl, token) : null;
  return (
    <div className="space-y-4">
      <p role="status" className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
        {copy.agents.tokenOnce}
      </p>
      <CopyField value={token} label="token" multiline />
      {commands && (
        <>
          <p className="text-sm text-muted">{copy.agents.pluginClaude}</p>
          <CopyField value={commands.claude} label="Claude Code commands" multiline />
          <p className="text-sm text-muted">{copy.agents.pluginCodex}</p>
          <CopyField value={commands.codex} label="Codex commands" multiline />
          <p className="text-sm text-muted">{copy.agents.pluginPi}</p>
          <CopyField value={commands.piInstall} label="pi install command" multiline />
          <CopyField value={commands.piConfig} label="pi settings command" multiline />
        </>
      )}
    </div>
  );
}

export function PluginSetup({ token, onToken }: { token: string | null; onToken: (token: string) => void }) {
  return (
    <TokenAgentForm
      token={token}
      onToken={onToken}
      intro={copy.agents.pluginIntro}
      namePlaceholder="Claude Code"
      reveal={(created) => <PluginReveal token={created} />}
    />
  );
}
