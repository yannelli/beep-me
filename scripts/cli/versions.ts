import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./context.ts";
import { say } from "./ui.ts";

const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs git or bun in the checkout. Dry runs print writes and skip them. */
export function cmd(ctx: Ctx, bin: string, args: string[], options: { write?: boolean; inherit?: boolean; timeoutMs?: number } = {}): CmdResult {
  const shown = `${bin} ${args.join(" ")}`;
  if (options.write && ctx.dryRun) {
    say.dryRun(shown);
    return { ok: true, stdout: "", stderr: "" };
  }
  if (ctx.dryRun || options.inherit) say.command(shown);
  const result = spawnSync(bin, args, {
    cwd: ctx.root,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    timeout: options.timeoutMs,
    shell: process.platform === "win32",
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, stdout: "", stderr: `${bin} is not installed.` };
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function git(ctx: Ctx, args: string[], options: { write?: boolean; timeoutMs?: number } = {}): CmdResult {
  return cmd(ctx, "git", args, options);
}

export function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function parseVersion(tag: string): number[] | null {
  const match = RELEASE.exec(tag.startsWith("v") ? tag : `v${tag}`);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [0, 0, 0];
  const right = parseVersion(b) ?? [0, 0, 0];
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}

export function installedVersion(root: string): string {
  return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
}

export function pickRemote(ctx: Ctx, wanted?: string): string {
  const remotes = lines(git(ctx, ["remote"]).stdout);
  if (wanted) {
    if (!remotes.includes(wanted)) throw new Error(`No git remote named "${wanted}". Remotes: ${remotes.join(", ") || "none"}.`);
    return wanted;
  }
  if (remotes.includes("upstream")) return "upstream";
  if (remotes.includes("origin")) return "origin";
  throw new Error("This checkout has no origin or upstream remote. Add one: git remote add upstream https://github.com/yannelli/beep-me.git");
}

/** Release tags on the remote, newest first. Reads only. */
export function remoteReleases(ctx: Ctx, remote: string, timeoutMs = 20_000): string[] {
  const result = git(ctx, ["ls-remote", "--tags", "--refs", remote], { timeoutMs });
  if (!result.ok) throw new Error(`Could not read tags from ${remote}: ${result.stderr.trim() || "git ls-remote failed"}`);
  const tags = lines(result.stdout).map((line) => line.split("refs/tags/")[1] ?? "").filter((tag) => RELEASE.test(tag));
  return tags.sort((a, b) => compareVersions(b, a));
}

/** The newest release above the installed version, or null. Fails quietly for the menu. */
export function updateAvailable(ctx: Ctx): string | null {
  try {
    const remote = pickRemote(ctx);
    const [latest] = remoteReleases(ctx, remote, 5_000);
    return latest && compareVersions(latest, installedVersion(ctx.root)) > 0 ? latest : null;
  } catch {
    return null;
  }
}

/** CHANGELOG.md sections at `tag` for versions above `from`. */
export function releaseNotes(ctx: Ctx, tag: string, from: string): string {
  const changelog = git(ctx, ["show", `${tag}:CHANGELOG.md`]);
  if (!changelog.ok) return "";
  const sections = changelog.stdout.split(/^(?=## \[)/m).slice(1);
  return sections
    .filter((section) => {
      const version = /^## \[([^\]]+)\]/.exec(section)?.[1] ?? "";
      return compareVersions(version, from) > 0 && compareVersions(version, tag) <= 0;
    })
    .map((section) => section.trim())
    .join("\n\n");
}

export function isAncestor(ctx: Ctx, older: string, newer: string): boolean {
  return git(ctx, ["merge-base", "--is-ancestor", older, newer]).ok;
}

/** Tracked files with edits, from git status. */
export function editedFiles(ctx: Ctx): string[] {
  const status = git(ctx, ["status", "--porcelain=v1", "--untracked-files=no"]).stdout;
  return status.split("\n").filter(Boolean).map((line) => line.slice(3));
}

/** Untracked files that the target release tracks. Git refuses to overwrite them. */
export function untrackedInTarget(ctx: Ctx, tag: string): string[] {
  const untracked = new Set(lines(git(ctx, ["ls-files", "--others", "--exclude-standard"]).stdout));
  return lines(git(ctx, ["ls-tree", "-r", "--name-only", tag]).stdout).filter((file) => untracked.has(file));
}
