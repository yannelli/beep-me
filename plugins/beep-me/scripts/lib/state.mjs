import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** @typedef {import("./types.mjs").Config} Config */
/** @typedef {import("./types.mjs").TrackedQuestion} TrackedQuestion */
/** @typedef {ReturnType<typeof sessionPaths>} SessionPaths */

const WEEK = 7 * 24 * 3600_000;

/** @param {Config} config @param {string | undefined} sessionId */
export function sessionPaths(config, sessionId) {
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  const root = path.join(config.dataDir, "sessions", safe);
  return {
    root,
    pending: path.join(root, "pending"),
    resolved: path.join(root, "resolved"),
    questions: path.join(root, "questions"),
    turnEnd: path.join(root, "turn-end"),
  };
}

/** @param {unknown} value @returns {unknown} */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([key]) => key !== "answers").sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, inner]) => [key, canonical(inner)]));
  }
  return value;
}

/**
 * Same key for a PermissionRequest and the PostToolUse of the same call. Leaves out the answers that a question tool adds.
 * @param {string | undefined} toolName @param {unknown} toolInput
 */
export function promptKey(toolName, toolInput) {
  return createHash("sha256").update(`${toolName ?? ""}\n${JSON.stringify(canonical(toolInput ?? null))}`).digest("hex").slice(0, 32);
}

/** @param {string} file */
async function readNumber(file) {
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const value = Number(text.trim());
  return Number.isFinite(value) && text ? value : null;
}

/** @param {string} file @param {string} text */
async function writeFile(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

/** A prompt waits for an answer. @param {SessionPaths} paths @param {string} key */
export async function markPending(paths, key) {
  await writeFile(path.join(paths.pending, key), String(Date.now()));
}

/** @param {SessionPaths} paths @param {string} key */
export async function clearPending(paths, key) {
  await fs.rm(path.join(paths.pending, key), { force: true });
  await fs.rm(path.join(paths.resolved, key), { force: true });
}

/** The tool ran or failed, so someone answered its prompt. @param {SessionPaths} paths @param {string} key */
export async function markToolDone(paths, key) {
  if ((await readNumber(path.join(paths.pending, key))) === null) return;
  await writeFile(path.join(paths.resolved, key), String(Date.now()));
}

/** The turn ended or the user typed, so every prompt of this session has an answer. @param {SessionPaths} paths */
export async function markTurnEnd(paths) {
  const pending = await fs.readdir(paths.pending).catch(() => []);
  if (pending.length) await writeFile(paths.turnEnd, String(Date.now()));
}

/** @param {SessionPaths} paths @param {string} key @param {number} startedAt */
export async function answeredElsewhere(paths, key, startedAt) {
  const resolved = await readNumber(path.join(paths.resolved, key));
  if (resolved !== null && resolved >= startedAt) return true;
  const turnEnd = await readNumber(paths.turnEnd);
  return turnEnd !== null && turnEnd >= startedAt;
}

/** @param {SessionPaths} paths @param {TrackedQuestion} question */
export async function saveQuestion(paths, question) {
  await writeFile(path.join(paths.questions, `${question.messageId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`), JSON.stringify(question));
}

/** @param {SessionPaths} paths @param {string} messageId */
export async function dropQuestion(paths, messageId) {
  await fs.rm(path.join(paths.questions, `${messageId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`), { force: true });
}

/** Questions of this session from the last day, oldest first. @param {SessionPaths} paths @returns {Promise<TrackedQuestion[]>} */
export async function listQuestions(paths) {
  const names = await fs.readdir(paths.questions).catch(() => []);
  /** @type {TrackedQuestion[]} */
  const questions = [];
  for (const name of names) {
    const file = path.join(paths.questions, name);
    const question = /** @type {TrackedQuestion | null} */ (JSON.parse(await fs.readFile(file, "utf8").catch(() => "null")));
    if (question && Date.now() - question.at < 24 * 3600_000) questions.push(question);
    else await fs.rm(file, { force: true });
  }
  return questions.sort((a, b) => a.at - b.at);
}

/** Removes session folders untouched for a week. @param {Config} config */
export async function pruneSessions(config) {
  const root = path.join(config.dataDir, "sessions");
  for (const name of await fs.readdir(root).catch(() => [])) {
    const dir = path.join(root, name);
    const stat = await fs.stat(dir).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > WEEK) await fs.rm(dir, { recursive: true, force: true });
  }
}
