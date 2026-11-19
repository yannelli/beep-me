#!/usr/bin/env node
// Hook entry for the Beep Me plugin: beep-me.mjs <event> [codex] [--wait=<seconds>], with the hook JSON on stdin.
// A failure never blocks the agent: it logs to stderr and exits 0, so the normal flow goes on.
import { readConfig } from "./lib/config.mjs";
import { permissionRequest } from "./events/prompts.mjs";
import { stopAndWait, trackReply, watchReply } from "./events/replies.mjs";
import { sessionStart, toolDone, turnEnd } from "./events/session.mjs";

/** @typedef {import("./lib/types.mjs").HookInput} HookInput */
/** @typedef {import("./lib/types.mjs").HookResult} HookResult */
/** @typedef {import("./lib/types.mjs").Config} Config */

/** @type {Record<string, (input: HookInput, config: Config) => Promise<HookResult | null>>} */
const HANDLERS = {
  "session-start": sessionStart,
  permission: permissionRequest,
  watch: watchReply,
  track: trackReply,
  stop: stopAndWait,
  "tool-done": toolDone,
  "turn-end": turnEnd,
};

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Writes, then exits once the stream flushed. Pipes are asynchronous on macOS. @param {NodeJS.WriteStream} stream @param {string} text @param {number} code */
function finish(stream, text, code) {
  if (!text) process.exit(code);
  stream.write(text, () => process.exit(code));
}

async function main() {
  const [event = "", ...rest] = process.argv.slice(2);
  const handler = HANDLERS[event];
  if (!handler) throw new Error(`Unknown event "${event}". Use one of: ${Object.keys(HANDLERS).join(", ")}.`);
  const wait = Number(rest.find((arg) => arg.startsWith("--wait="))?.slice(7));
  const config = readConfig({ host: rest.includes("codex") ? "codex" : undefined, wait: Number.isFinite(wait) ? wait : undefined });
  const raw = await readStdin();
  /** @type {HookInput} */
  const input = raw.trim() ? JSON.parse(raw) : {};
  return handler(input, config);
}

main().then(
  (result) => {
    if (result?.wake) return finish(process.stderr, result.wake, 2);
    finish(process.stdout, result?.output ? JSON.stringify(result.output) : "", 0);
  },
  (error) => finish(process.stderr, `Beep Me plugin: ${error instanceof Error ? error.message : String(error)}\n`, 0),
);
