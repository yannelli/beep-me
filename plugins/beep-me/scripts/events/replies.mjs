import { createApi, sleep } from "../lib/api.mjs";
import { answerForAgent } from "../lib/answers.mjs";
import { dropQuestion, listQuestions, markTurnEnd, saveQuestion, sessionPaths } from "../lib/state.mjs";
import { checkQuestion, pollSeconds } from "../lib/wait.mjs";

/** @typedef {import("../lib/types.mjs").Config} Config */
/** @typedef {import("../lib/types.mjs").HookInput} HookInput */
/** @typedef {import("../lib/types.mjs").HookResult} HookResult */
/** @typedef {import("../lib/types.mjs").Reply} Reply */
/** @typedef {import("../lib/types.mjs").TrackedQuestion} TrackedQuestion */

const WATCH_URL = /https?:\/\/[^\s"'\\]+\/v1\/watch\/(msg_[A-Za-z0-9_-]+)\/[A-Za-z0-9_-]+/;
const MESSAGE = /Message (msg_[A-Za-z0-9_-]+)\. Status: (?:delivered|partial)\./;

/**
 * The question a notify call asked, or null for a message that asks nothing or that Beep Me held.
 * With the plugin header, the result text has no watch URL, so the hooks wait with the token instead.
 * @param {HookInput} input @returns {TrackedQuestion | null}
 */
export function askedQuestion(input) {
  const response = JSON.stringify(input.tool_response ?? "");
  const args = input.tool_input ?? {};
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : null;
  const watch = WATCH_URL.exec(response);
  if (watch) return { messageId: watch[1], watchUrl: watch[0], title, at: Date.now(), waited: false };
  const asks = args.expect_reply === true || (Array.isArray(args.options) && args.options.length > 0);
  const message = asks ? MESSAGE.exec(response) : null;
  return message ? { messageId: message[1], watchUrl: null, title, at: Date.now(), waited: false } : null;
}

/** Reads the answers with the token, unless they came with the check. @param {Config} config @param {TrackedQuestion} question @param {Reply[] | null} replies */
async function answerText(config, question, replies) {
  // Without a token, or when the token belongs to another agent, Beep Me finds no answers, and the text asks for get_replies.
  const read = replies ?? (config.origin && config.token ? await createApi(config).replies(question.messageId, 0).catch(() => []) : []);
  return answerForAgent(question.messageId, question.title, read);
}

/**
 * Claude Code and pi, PostToolUse of notify, run with asyncRewake. Exit code 2 wakes the agent with the answer,
 * even when the session is idle. @param {HookInput} input @param {Config} config
 */
export async function watchReply(input, config) {
  const question = askedQuestion(input);
  if (!question) return null;
  const deadline = Date.now() + config.wait * 1000;
  while (Date.now() < deadline) {
    const result = await checkQuestion(config, question, pollSeconds(deadline, 50));
    if (result.state === "ready") return { wake: await answerText(config, question, result.replies) };
    if (result.state === "gone") return null;
    if (result.state === "error") await sleep(Math.min(15_000, Math.max(0, deadline - Date.now())));
  }
  return null;
}

/** Codex, PostToolUse of notify: remembers the question for the Stop hook. @param {HookInput} input @param {Config} config */
export async function trackReply(input, config) {
  const question = askedQuestion(input);
  if (question) await saveQuestion(sessionPaths(config, input.session_id), question);
  return null;
}

/**
 * Codex, Stop: waits for an answer to this session's open questions, then continues the session with it.
 * A question waits the full time once. Later stops only check it. @param {HookInput} input @param {Config} config
 */
export async function stopAndWait(input, config) {
  const paths = sessionPaths(config, input.session_id);
  await markTurnEnd(paths);
  let questions = await listQuestions(paths);
  const deadline = Date.now() + (questions.some((question) => !question.waited) ? config.wait * 1000 : 0);
  while (questions.length) {
    const seconds = pollSeconds(deadline, questions.length === 1 ? 50 : 5);
    let failed = false;
    for (const question of [...questions]) {
      const result = await checkQuestion(config, question, seconds);
      if (result.state === "ready") {
        await dropQuestion(paths, question.messageId);
        return { output: { decision: "block", reason: await answerText(config, question, result.replies) } };
      }
      if (result.state === "gone") {
        await dropQuestion(paths, question.messageId);
        questions = questions.filter((other) => other !== question);
      }
      failed ||= result.state === "error";
    }
    if (Date.now() >= deadline) break;
    if (failed) await sleep(Math.min(15_000, Math.max(0, deadline - Date.now())));
  }
  for (const question of questions) await saveQuestion(paths, { ...question, waited: true });
  return null;
}
