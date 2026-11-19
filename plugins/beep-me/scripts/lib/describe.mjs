import path from "node:path";
import { HOST_NAMES, projectName } from "./config.mjs";

/** @typedef {import("./types.mjs").Config} Config */
/** @typedef {import("./types.mjs").HookInput} HookInput */
/** @typedef {import("./types.mjs").Question} Question */

const BODY_LIMIT = 3500;

/** @param {unknown} value @param {number} limit */
export function clip(value, limit) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  return text.length > limit ? `${text.slice(0, limit)}\n[${text.length - limit} more characters]` : text;
}

/** @param {string | undefined} file @param {string | undefined} cwd */
function shortPath(file, cwd) {
  if (!file) return "a file";
  const relative = cwd ? path.relative(cwd, file) : file;
  return relative && !relative.startsWith("..") ? relative : file;
}

/** @param {string} name */
function mcpParts(name) {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1].replace(/^plugin_[^_]+_/, ""), tool: match[2] } : null;
}

/**
 * Title and body for a tool that asks for permission.
 * @param {HookInput} input @param {Config} config @returns {{ title: string, message: string }}
 */
export function describeTool(input, config) {
  const host = HOST_NAMES[config.host];
  const where = `in ${projectName(input.cwd)}`;
  const tool = input.tool_name ?? "a tool";
  const args = input.tool_input ?? {};
  const note = typeof args.description === "string" && args.description ? `\n\n${clip(args.description, 300)}` : "";
  if (tool === "Bash" || tool === "PowerShell" || tool === "Monitor") {
    return { title: "Allow this command?", message: `${host} wants to run this ${where}:\n\n${clip(args.command ?? "", BODY_LIMIT)}${note}` };
  }
  if (tool === "apply_patch") {
    return { title: "Allow this patch?", message: `${host} wants to change files ${where}:\n\n${clip(args.command ?? args, BODY_LIMIT)}` };
  }
  if (tool === "Write") {
    return { title: "Allow this file?", message: `${host} wants to write ${shortPath(args.file_path, input.cwd)} ${where}:\n\n${clip(args.content ?? "", 1500)}` };
  }
  if (tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const file = shortPath(args.file_path ?? args.notebook_path, input.cwd);
    const change =
      typeof args.old_string === "string"
        ? `Old:\n${clip(args.old_string, 700)}\n\nNew:\n${clip(args.new_string ?? "", 1500)}`
        : clip(args.new_source ?? args.edits ?? args, 2000);
    return { title: "Allow this edit?", message: `${host} wants to edit ${file} ${where}:\n\n${change}` };
  }
  if (tool === "WebFetch") {
    return { title: "Allow this web page?", message: `${host} wants to open ${clip(args.url ?? "", 500)} ${where}.${args.prompt ? `\n\n${clip(args.prompt, 500)}` : ""}` };
  }
  const mcp = mcpParts(tool);
  if (mcp) {
    return { title: `Allow ${mcp.tool}?`, message: `${host} wants to use ${mcp.tool} from ${mcp.server} ${where}:\n\n${clip(args, BODY_LIMIT)}` };
  }
  return { title: `Allow ${tool}?`, message: `${host} wants to use ${tool} ${where}:\n\n${clip(args, BODY_LIMIT)}${note}` };
}

/**
 * Title, body, and file for a plan that waits for approval. Long plans go out as plan.md too.
 * @param {HookInput} input @param {Config} config
 */
export function describePlan(input, config) {
  const plan = String(input.tool_input?.plan ?? "");
  const host = HOST_NAMES[config.host];
  const message = `${host} has a plan for ${projectName(input.cwd)}. Approve it, or write what to change.\n\n${clip(plan || "(The plan is empty.)", 3000)}`;
  const attachments = plan.length > 3000 ? [{ data: Buffer.from(plan).toString("base64"), filename: "plan.md", mime_type: "text/markdown" }] : undefined;
  return { title: "Review the plan", message, attachments };
}

/**
 * Title, body, and choices for one AskUserQuestion question.
 * @param {Question} question @param {number} index @param {number} count @param {HookInput} input @param {Config} config
 */
export function describeQuestion(question, index, count, input, config) {
  const header = question.header?.trim() || "Question";
  const title = count > 1 ? `${header} (${index + 1} of ${count})` : header;
  const options = [...new Set((question.options ?? []).map((option) => option.label.trim().slice(0, 64)).filter(Boolean))].slice(0, 10);
  const described = (question.options ?? []).filter((option) => option.description).map((option) => `${option.label}: ${option.description}`);
  const lines = [`${HOST_NAMES[config.host]} asks in ${projectName(input.cwd)}:`, "", question.question.trim()];
  if (described.length) lines.push("", ...described);
  lines.push("", question.multiSelect ? "Pick one, or write several separated by commas. You can also write your own answer." : "Pick one, or write your own answer.");
  return { title, message: clip(lines.join("\n"), BODY_LIMIT), options: options.length >= 2 ? options : undefined };
}
