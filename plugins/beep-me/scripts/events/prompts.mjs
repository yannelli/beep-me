import { randomUUID } from "node:crypto";
import { createApi } from "../lib/api.mjs";
import { ALLOW, ALLOW_SESSION, APPROVE, DENY, KEEP_PLANNING, permissionAnswer, planAnswer, questionAnswer } from "../lib/answers.mjs";
import { projectName } from "../lib/config.mjs";
import { describePlan, describeQuestion, describeTool } from "../lib/describe.mjs";
import { answeredElsewhere, clearPending, markPending, promptKey, sessionPaths } from "../lib/state.mjs";
import { waitForReplies, waitOrDone } from "../lib/wait.mjs";

/** @typedef {import("../lib/types.mjs").Config} Config */
/** @typedef {import("../lib/types.mjs").HookInput} HookInput */
/** @typedef {import("../lib/types.mjs").HookResult} HookResult */
/** @typedef {import("../lib/types.mjs").Decision} Decision */
/** @typedef {import("../lib/types.mjs").Question} Question */
/** @typedef {import("../lib/api.mjs").Api} Api */
/** @typedef {{ api: Api, input: HookInput, config: Config, deadline: number, done: () => Promise<boolean> }} PromptContext */

/** Tools of the Beep Me MCP server, bundled by this plugin or added by hand. */
const BEEP_ME_TOOL = /^mcp__(?:plugin_beep-me_)?beep[-_]?me__/i;

/** @param {Decision} decision @returns {HookResult} */
function decide(decision) {
  return { output: { hookSpecificOutput: { hookEventName: "PermissionRequest", decision } } };
}

/**
 * Sends one prompt and returns its message id, or null when Beep Me held it (paused, muted, throttled, or failed).
 * @param {PromptContext} ctx @param {{ title: string, message: string, options?: string[], attachments?: unknown[] }} prompt
 */
async function send(ctx, prompt) {
  const result = await ctx.api.notify({
    ...prompt,
    priority: ctx.config.priority,
    topic: projectName(ctx.input.cwd),
    expect_reply: true,
    // A unique key, so Beep Me does not merge a repeated prompt into an earlier one.
    dedupe_key: `plugin-prompt:${randomUUID()}`,
  });
  return result.status === "delivered" || result.status === "partial" ? result.id : null;
}

/** Waits for the first answer. On no answer, stops the message's fallback steps. @param {PromptContext} ctx @param {string} messageId */
async function firstReply(ctx, messageId) {
  const replies = await waitForReplies(ctx.api, messageId, { deadline: ctx.deadline, done: ctx.done });
  if (replies) return replies[0];
  await ctx.api.cancelFallbacks(messageId);
  return null;
}

/** @param {PromptContext} ctx @returns {Promise<HookResult | null>} */
async function approveTool(ctx) {
  const suggestions = ctx.config.host === "claude" && Array.isArray(ctx.input.permission_suggestions) ? ctx.input.permission_suggestions : [];
  const options = suggestions.length ? [ALLOW, ALLOW_SESSION, DENY] : [ALLOW, DENY];
  const messageId = await send(ctx, { ...describeTool(ctx.input, ctx.config), options });
  const reply = messageId ? await firstReply(ctx, messageId) : null;
  if (!reply) return null;
  const answer = permissionAnswer(reply);
  if (!answer.allow) return decide({ behavior: "deny", message: answer.message });
  if (!answer.session) return decide({ behavior: "allow" });
  // Claude Code's suggestions save rules to a settings file. "This session" keeps them in memory only.
  const updatedPermissions = suggestions.map((entry) => (entry && typeof entry === "object" ? { ...entry, destination: "session" } : entry));
  return decide({ behavior: "allow", updatedPermissions });
}

/** @param {PromptContext} ctx @returns {Promise<HookResult | null>} */
async function reviewPlan(ctx) {
  const messageId = await send(ctx, { ...describePlan(ctx.input, ctx.config), options: [APPROVE, KEEP_PLANNING] });
  const reply = messageId ? await firstReply(ctx, messageId) : null;
  if (!reply) return null;
  const answer = planAnswer(reply);
  return answer.approve ? decide({ behavior: "allow", updatedInput: ctx.input.tool_input }) : decide({ behavior: "deny", message: answer.message });
}

/** Sends the questions one at a time, so a written answer always matches the newest question. @param {PromptContext} ctx */
async function askQuestions(ctx) {
  /** @type {Question[]} */
  const questions = Array.isArray(ctx.input.tool_input?.questions) ? ctx.input.tool_input.questions : [];
  if (!questions.length) return null;
  /** @type {Record<string, string>} */
  const answers = {};
  for (const [index, question] of questions.entries()) {
    const messageId = await send(ctx, describeQuestion(question, index, questions.length, ctx.input, ctx.config));
    if (!messageId) return null;
    const replies = await waitForReplies(ctx.api, messageId, { deadline: ctx.deadline, done: ctx.done });
    if (!replies) {
      await ctx.api.cancelFallbacks(messageId);
      return null;
    }
    answers[question.question] = questionAnswer(replies, question);
  }
  return decide({ behavior: "allow", updatedInput: { ...ctx.input.tool_input, answers } });
}

/**
 * PermissionRequest: sends the prompt to the phone and returns the answer as the decision.
 * Claude Code shows its own dialog at the same time, and the first answer wins.
 * @param {HookInput} input @param {Config} config @returns {Promise<HookResult | null>}
 */
export async function permissionRequest(input, config) {
  // Asking on the phone whether the agent may message the phone helps nobody. Beep Me still applies the agent's limits.
  if (config.host !== "pi" && BEEP_ME_TOOL.test(input.tool_name ?? "")) return decide({ behavior: "allow" });
  if (!config.prompts || !config.origin || !config.token) return null;
  const startedAt = Date.now();
  const race = config.host === "claude";
  const paths = sessionPaths(config, input.session_id);
  const key = promptKey(input.tool_name, input.tool_input);
  const done = race ? () => answeredElsewhere(paths, key, startedAt) : async () => false;
  if (race) await markPending(paths, key);
  try {
    if (race && config.askAfter > 0 && (await waitOrDone(config.askAfter * 1000, done))) return null;
    /** @type {PromptContext} */
    const ctx = { api: createApi(config), input, config, deadline: startedAt + config.wait * 1000, done };
    if (input.tool_name === "AskUserQuestion") return await askQuestions(ctx);
    if (input.tool_name === "ExitPlanMode") return await reviewPlan(ctx);
    return await approveTool(ctx);
  } finally {
    if (race) await clearPending(paths, key);
  }
}
