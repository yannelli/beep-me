import { markToolDone, markTurnEnd, promptKey, pruneSessions, sessionPaths } from "../lib/state.mjs";

/** @typedef {import("../lib/types.mjs").Config} Config */
/** @typedef {import("../lib/types.mjs").HookInput} HookInput */
/** @typedef {import("../lib/types.mjs").HookResult} HookResult */

/** @param {Config} config */
function context(config) {
  const lines = ["Beep Me plugin:"];
  if (config.host === "codex") {
    lines.push(
      "- After you ask the user something with the Beep Me notify tool (options or expect_reply true), end your turn. Do not call get_replies to wait and do not run a watch loop. The plugin waits for the answer and continues this session with it.",
    );
    if (config.prompts) lines.push("- Approval requests in this session also go to the user's phone.");
    return lines.join("\n");
  }
  lines.push(
    "- After you ask the user something with the Beep Me notify tool (options or expect_reply true), do not call get_replies to wait and do not run a watch loop. Keep working or end your turn. The plugin sends you the answer as a new message when it arrives.",
  );
  if (config.prompts) {
    const when = config.askAfter > 0 ? `when nobody answers in the terminal within ${config.askAfter} seconds` : "at once";
    lines.push(`- Permission prompts, AskUserQuestion questions, and plan approvals go to the user's phone ${when}. Use AskUserQuestion when you need a decision.`);
  }
  return lines.join("\n");
}

/** @param {Config} config */
function setupWarning(config) {
  if (!config.prompts || (config.origin && config.token)) return null;
  return config.host === "codex"
    ? "Beep Me: set BEEPME_URL and BEEPME_TOKEN to send approval requests to your phone."
    : "Beep Me: add your Beep Me MCP URL and agent token in the plugin settings to send prompts to your phone.";
}

/** SessionStart: tells the agent how the plugin waits, and removes old session state. @param {HookInput} _input @param {Config} config */
export async function sessionStart(_input, config) {
  await pruneSessions(config).catch(() => undefined);
  const warning = setupWarning(config);
  /** @type {HookResult} */
  const result = { output: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context(config) } } };
  if (warning && result.output) result.output.systemMessage = warning;
  return result;
}

/** PostToolUse and PostToolUseFailure in Claude Code: the call ran, so its prompt has an answer. @param {HookInput} input @param {Config} config */
export async function toolDone(input, config) {
  if (config.host === "claude") await markToolDone(sessionPaths(config, input.session_id), promptKey(input.tool_name, input.tool_input));
  return null;
}

/** Stop and UserPromptSubmit in Claude Code: the turn ended, so no prompt waits anymore. @param {HookInput} input @param {Config} config */
export async function turnEnd(input, config) {
  if (config.host === "claude") await markTurnEnd(sessionPaths(config, input.session_id));
  return null;
}
