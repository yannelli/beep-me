import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {import("./types.mjs").Config} Config */
/** @typedef {import("./types.mjs").Host} Host */

export const PRIORITIES = ["low", "medium", "high", "urgent"];

export const HOST_NAMES = /** @type {const} */ ({ claude: "Claude Code", codex: "Codex", pi: "pi" });

/**
 * Claude Code and pi pass plugin options as CLAUDE_PLUGIN_OPTION_<KEY>. Codex has none, so it reads BEEPME_<KEY>.
 * @param {NodeJS.ProcessEnv} env @param {string} key
 */
function option(env, key) {
  const value = env[`CLAUDE_PLUGIN_OPTION_${key}`] ?? env[`BEEPME_${key}`];
  return value && value.trim() ? value.trim() : null;
}

/** @param {string | null} value @param {boolean} fallback */
function flag(value, fallback) {
  return value === null ? fallback : /^(1|true|on|yes)$/i.test(value);
}

/**
 * Codex passes "codex" in its hooks file. Claude Code and pi share hooks.json, and each sets AI_AGENT for its children.
 * @param {string | undefined} argHost @param {NodeJS.ProcessEnv} env @returns {Host}
 */
export function detectHost(argHost, env) {
  if (argHost === "codex") return "codex";
  if (env.AI_AGENT) return env.AI_AGENT === "pi" ? "pi" : "claude";
  return env.PI_CODING_AGENT === "true" ? "pi" : "claude";
}

/** Accepts the MCP URL or the plain address. @param {string | null} url */
export function originOf(url) {
  if (!url) return null;
  const trimmed = url.replace(/\/+$/, "").replace(/\/mcp$/, "");
  return /^https?:\/\/[^/]+/.test(trimmed) ? trimmed : null;
}

function pluginVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../../.claude-plugin/plugin.json", import.meta.url), "utf8"));
    return String(manifest.version ?? "dev");
  } catch {
    return "dev";
  }
}

/** @param {{ host?: string, wait?: number }} args @param {NodeJS.ProcessEnv} [env] @returns {Config} */
export function readConfig(args, env = process.env) {
  const host = detectHost(args.host, env);
  const priority = option(env, "PRIORITY")?.toLowerCase() ?? "high";
  const askAfter = Number(option(env, "ASK_AFTER") ?? 15);
  return {
    host,
    origin: originOf(option(env, "URL")),
    token: option(env, "TOKEN"),
    // Codex shows its approval prompt only after the hook returns, so prompts are opt-in there. pi has no prompts.
    prompts: host !== "pi" && flag(option(env, "PROMPTS"), host === "claude"),
    askAfter: Number.isFinite(askAfter) ? Math.min(Math.max(askAfter, 0), 3600) : 15,
    priority: PRIORITIES.includes(priority) ? priority : "high",
    wait: Math.max(args.wait ?? 60, 1),
    dataDir: env.CLAUDE_PLUGIN_DATA || env.PLUGIN_DATA || path.join(os.tmpdir(), `beep-me-plugin-${os.userInfo().username}`),
    version: pluginVersion(),
  };
}

/** @param {string | undefined} cwd */
export function projectName(cwd) {
  return path.basename(cwd || process.cwd()).slice(0, 64) || "project";
}
