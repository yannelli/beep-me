import { createApi, isFatal, sleep, watchReady } from "./api.mjs";

/** @typedef {import("./api.mjs").Api} Api */
/** @typedef {import("./types.mjs").Config} Config */
/** @typedef {import("./types.mjs").Reply} Reply */
/** @typedef {import("./types.mjs").TrackedQuestion} TrackedQuestion */
/** @typedef {import("./types.mjs").CheckResult} CheckResult */
/** @typedef {() => Promise<boolean>} DoneCheck */

const never = async () => false;

/**
 * Waits ms, checking done() every half second. Returns true when done() turned true first.
 * @param {number} ms @param {DoneCheck} done
 */
export async function waitOrDone(ms, done) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await done()) return true;
    await sleep(Math.min(500, end - Date.now()));
  }
  return done();
}

/**
 * Long-polls /v1/replies for one message. Null when the deadline passes or done() turns true first.
 * @param {Api} api @param {string} messageId @param {{ deadline: number, done?: DoneCheck }} options @returns {Promise<Reply[] | null>}
 */
export async function waitForReplies(api, messageId, { deadline, done = never }) {
  while (Date.now() < deadline) {
    if (await done()) return null;
    const controller = new AbortController();
    const check = setInterval(() => void done().then((yes) => yes && controller.abort()), 1000);
    try {
      const replies = await api.replies(messageId, pollSeconds(deadline, 20), controller.signal);
      if (replies.length) return replies;
    } catch (error) {
      if (controller.signal.aborted) return null;
      if (isFatal(error)) throw error;
      await sleep(5000);
    } finally {
      clearInterval(check);
    }
  }
  return null;
}

/**
 * Checks a question once: its watch URL, or the token when the result had no URL. "gone" means no answer will come.
 * @param {Config} config @param {TrackedQuestion} question @param {number} seconds @returns {Promise<CheckResult>}
 */
export async function checkQuestion(config, question, seconds) {
  try {
    if (question.watchUrl) return (await watchReady(question.watchUrl, seconds)) ? { state: "ready", replies: null } : { state: "pending" };
    if (!config.origin || !config.token) return { state: "gone" };
    const replies = await createApi(config).replies(question.messageId, seconds);
    return replies.length ? { state: "ready", replies } : { state: "pending" };
  } catch (error) {
    return { state: isFatal(error) ? "gone" : "error" };
  }
}

/** Seconds for the next long poll, 1 to max, within the deadline. @param {number} deadline @param {number} max */
export function pollSeconds(deadline, max) {
  return Math.max(1, Math.min(max, Math.floor((deadline - Date.now()) / 1000)));
}
