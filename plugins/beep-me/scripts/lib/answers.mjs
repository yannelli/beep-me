/** @typedef {import("./types.mjs").Reply} Reply */
/** @typedef {import("./types.mjs").Question} Question */

const YES = /^(y|ya|yes|yep|yeah|ok|okay|allow|approve|approved|go|go ahead|sure|do it|ship it|lgtm|👍|✅|👌|🆗)[.!]*$/iu;
const NO = /^(n|no|nope|deny|denied|reject|stop|cancel|don'?t|do not|👎|❌|🛑|🚫)[.!]*$/iu;

export const ALLOW = "Allow";
export const ALLOW_SESSION = "Allow for this session";
export const DENY = "Deny";
export const APPROVE = "Approve";
export const KEEP_PLANNING = "Keep planning";

/** @param {Reply} reply */
function replyText(reply) {
  return (reply.option?.label ?? reply.text ?? "").trim();
}

/**
 * Reads a permission answer: a choice, a yes or no, or written instructions, which deny the request.
 * @param {Reply} reply @returns {{ allow: true, session: boolean } | { allow: false, message: string }}
 */
export function permissionAnswer(reply) {
  const text = replyText(reply);
  if (reply.option?.label === ALLOW_SESSION) return { allow: true, session: true };
  if (reply.option?.label === ALLOW || reply.option?.label === APPROVE || YES.test(text)) return { allow: true, session: false };
  if (reply.option?.label === DENY || NO.test(text) || !text) return { allow: false, message: "The user denied this from their phone through Beep Me." };
  if (reply.kind === "reaction") return { allow: false, message: `The user reacted ${text} on their phone, which is not a clear yes. Ask again if you still need this.` };
  return { allow: false, message: `The user did not allow this. They wrote from their phone: ${text}` };
}

/** @param {Reply} reply @returns {{ approve: true } | { approve: false, message: string }} */
export function planAnswer(reply) {
  const text = replyText(reply);
  if (reply.option?.label === APPROVE || YES.test(text)) return { approve: true };
  if (reply.option?.label === KEEP_PLANNING || NO.test(text) || !text) return { approve: false, message: "The user wants to keep planning. Ask them what to change." };
  return { approve: false, message: `The user wants changes to the plan. They wrote from their phone: ${text}` };
}

/**
 * The AskUserQuestion answer: the full option label (Beep Me cuts labels to 64 characters), or the text the user wrote.
 * @param {Reply[]} replies @param {Question} question
 */
export function questionAnswer(replies, question) {
  const full = new Map((question.options ?? []).map((option) => [option.label.trim().slice(0, 64), option.label]));
  const parts = replies.map((reply) => (reply.option ? (full.get(reply.option.label) ?? reply.option.label) : replyText(reply))).filter(Boolean);
  return parts.length ? parts.join(", ") : "(The user answered with a file or a reaction. Ask again if you need words.)";
}

/** @param {Reply} reply */
function describeReply(reply) {
  const via = reply.channelName ? ` (${reply.channelName})` : "";
  const files = reply.media.map((file) => `${file.name} (${file.mime})`).join(", ");
  const body =
    reply.kind === "choice" && reply.option
      ? `Chose "${reply.option.label}"`
      : reply.kind === "reaction"
        ? `Reacted ${reply.text ?? ""}`.trim()
        : reply.text
          ? `Wrote: ${reply.text}`
          : "Sent";
  return `- ${body}${files ? `${body === "Sent" ? "" : ","} files: ${files}` : ""}${via}`;
}

/**
 * Text the agent reads when an answer arrives. Files need get_replies, which returns their links.
 * @param {string} messageId @param {string | null} title @param {Reply[]} replies
 */
export function answerForAgent(messageId, title, replies) {
  const label = title ? `"${title}" (${messageId})` : messageId;
  if (!replies.length) {
    return `The user answered your Beep Me message ${label}. Call get_replies with message_id "${messageId}" to read the answer, then continue.`;
  }
  const lines = [`The user answered your Beep Me message ${label}:`, ...replies.map(describeReply)];
  if (replies.some((reply) => reply.media.length)) lines.push(`Call get_replies with message_id "${messageId}" and include_read true to open the files.`);
  lines.push("Continue the task with this answer.");
  return lines.join("\n");
}
