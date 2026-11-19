import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { approve, exitIfMissing, requireYes, type Ctx } from "./context.ts";
import { signIn, whoami } from "./cloudflare.ts";
import { deployStep, primaryUrl } from "./deploy.ts";
import { applyLegacy, describeLegacy, planLegacy } from "./legacy.ts";
import { bold, dim, prompt, say } from "./ui.ts";
import {
  cmd,
  compareVersions,
  editedFiles,
  git,
  installedVersion,
  isAncestor,
  lines,
  pickRemote,
  releaseNotes,
  remoteReleases,
  untrackedInTarget,
} from "./versions.ts";

/** Steps a release needs from you after the update, keyed by the version that added them. */
const AFTER_UPDATE: { version: string; steps: string[] }[] = [
  {
    version: "0.4.0",
    steps: [
      "Twilio: to get text replies, open the channel and select Save changes.",
      "Telnyx: to get text replies, open the channel. In Telnyx setup, select Send replies to Beep Me.",
    ],
  },
  { version: "0.5.0", steps: ["Resend: to get email replies, open the channel. In Domain and replies, select Create webhook."] },
];

const FORWARD = ["yes", "non-interactive", "no-deploy"] as const;

function preflight(ctx: Ctx): void {
  const top = git(ctx, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || realpathSync(top.stdout.trim()) !== realpathSync(ctx.root)) {
    throw new Error("This folder is not a git checkout of Beep Me. Clone it again with git clone https://github.com/yannelli/beep-me.git, then run setup.");
  }
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) throw new Error(`Beep Me needs Node 24 or later. This is Node ${process.versions.node}.`);
  if (!cmd(ctx, "bun", ["--version"]).ok) throw new Error("Bun is not installed. Install it with: curl -fsSL https://bun.sh/install | bash");
}

function normalizeTag(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function checkResult(ctx: Ctx, remote: string, current: string, latest: string | undefined): void {
  const available = Boolean(latest && compareVersions(latest, current) > 0);
  if (ctx.json) return void console.log(JSON.stringify({ current, latest: latest?.slice(1) ?? null, updateAvailable: available, remote }, null, 2));
  if (available) say.info(`Update available: ${bold(latest!)}. Installed: v${current}. Run bun run upgrade.`);
  else say.ok(`Beep Me v${current} is the latest release.`);
}

function stopForCommits(ctx: Ctx, tag: string): void {
  if (isAncestor(ctx, "HEAD", tag)) return;
  const commits = lines(git(ctx, ["log", "--oneline", `${tag}..HEAD`]).stdout);
  throw new Error(
    [
      `This checkout has ${commits.length} commit(s) that are not in ${tag}:`,
      ...commits.map((line) => `  ${line}`),
      `Move them onto the release with git rebase ${tag}, or save them on a branch first. Then run bun run upgrade again.`,
    ].join("\n"),
  );
}

async function handleEdits(ctx: Ctx, edited: string[], collisions: string[]): Promise<boolean> {
  if (collisions.length) {
    throw new Error(`These untracked files are in the release, and git does not overwrite them:\n  ${collisions.join("\n  ")}\nMove or delete them, then run bun run upgrade again.`);
  }
  if (!edited.length) return false;
  const list = `  ${edited.join("\n  ")}`;
  if (ctx.interactive) {
    say.warn(`These files have local edits:\n${list}`);
    if (await prompt.confirm("Put them in git stash and continue? You get them back with git stash pop.", false)) return true;
  }
  throw new Error(`These files have local edits:\n${list}\nCommit them, or put them away with git stash. Then run bun run upgrade again.`);
}

function fastForward(ctx: Ctx, tag: string): void {
  const branch = git(ctx, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const result = branch.ok ? git(ctx, ["merge", "--ff-only", "--quiet", tag], { write: true }) : git(ctx, ["checkout", "--quiet", tag], { write: true });
  if (!result.ok) throw new Error(`git could not move to ${tag}: ${result.stderr.trim()}`);
  if (!ctx.dryRun) say.ok(`Code updated to ${tag}${branch.ok ? ` on branch ${branch.stdout.trim()}` : ""}.`);
}

function install(ctx: Ctx): void {
  const result = cmd(ctx, "bun", ["install"], { write: true, inherit: ctx.interactive });
  if (!result.ok) throw new Error(`bun install failed. ${result.stderr.trim().split("\n").slice(-5).join("\n")}\nFix it, then run bun install and bun run upgrade --continue.`);
}

async function checkSession(ctx: Ctx): Promise<void> {
  const url = `${await primaryUrl(ctx)}/api/session`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await fetch(url).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { setup?: unknown } | null;
    if (response?.ok && body?.setup) return say.ok(`${url} answers. The database schema is up to date.`);
    await new Promise((done) => setTimeout(done, 5_000));
  }
  say.warn(`${url} did not answer after 30 seconds. Run bun run cli logs and open the dashboard to check the Worker.`);
}

/** Runs from the new code after git moved: deploy, check the Worker, and list steps for you. */
async function finish(ctx: Ctx, from: string, to = installedVersion(ctx.root)): Promise<void> {
  say.step(`Deploy v${to}`);
  if (ctx.flags["no-deploy"]) say.skip("Skipped the deploy. Run bun run cli deploy to finish the update.");
  else {
    requireYes(ctx);
    exitIfMissing(ctx);
    if (!ctx.dryRun || whoami(ctx)) await signIn(ctx);
    else say.dryRun("wrangler login (Cloudflare is not signed in)");
    if ((await deployStep(ctx, {})) && !ctx.dryRun) await checkSession(ctx);
  }
  const steps = AFTER_UPDATE.filter((entry) => compareVersions(entry.version, from) > 0 && compareVersions(entry.version, to) <= 0).flatMap((entry) => entry.steps);
  if (steps.length) say.note(steps.map((step) => `- ${step}`).join("\n"), "Steps for you in the dashboard");
  say.outro(ctx.dryRun ? "Dry run finished. Nothing changed." : `Beep Me is on v${to}.`);
}

export async function upgradeCommand(ctx: Ctx): Promise<void> {
  if (ctx.flags.continue) {
    say.intro("Beep Me update");
    return finish(ctx, ctx.flags.from ?? installedVersion(ctx.root));
  }
  if (!ctx.flags.check) say.intro("Beep Me update");
  preflight(ctx);
  const remote = pickRemote(ctx, ctx.flags.remote);
  const current = installedVersion(ctx.root);
  const releases = remoteReleases(ctx, remote);
  if (ctx.flags.check) return checkResult(ctx, remote, current, releases[0]);
  const target = ctx.flags.to ? normalizeTag(ctx.flags.to) : releases[0];
  if (!target || !releases.includes(target)) throw new Error(`${ctx.flags.to ?? "A release"} is not a release tag on ${remote}. Releases: ${releases.slice(0, 5).join(", ") || "none"}.`);
  if (compareVersions(target, current) < 0) {
    throw new Error(`${target} is older than the installed v${current}. Beep Me does not go back to an older release. The database schema only moves forward, and older code cannot read the newer schema.`);
  }
  if (compareVersions(target, current) === 0) return say.outro(`Beep Me v${current} is up to date. To deploy it again, run bun run cli deploy.`);
  requireYes(ctx);
  exitIfMissing(ctx);

  const fetched = git(ctx, ["fetch", "--quiet", "--no-tags", remote, `refs/tags/${target}:refs/tags/${target}`]);
  if (!fetched.ok && !git(ctx, ["rev-parse", "--verify", "--quiet", `${target}^{commit}`]).ok) throw new Error(`Could not fetch ${target} from ${remote}: ${fetched.stderr.trim()}`);
  const notes = releaseNotes(ctx, target, current);
  say.block(`Changes from v${current} to ${target}`, notes || dim("No release notes found in CHANGELOG.md."));

  const legacy = planLegacy(ctx.root);
  if (legacy.blockers.length) {
    throw new Error(`wrangler.jsonc has edits that .beep-me/deploy.json cannot hold:\n  ${legacy.blockers.join("\n  ")}\nUndo these edits in wrangler.jsonc and keep the IDs and emails there. The update moves those. Then run bun run upgrade again.`);
  }
  stopForCommits(ctx, target);
  const edited = editedFiles(ctx).filter((file) => !legacy.restore.includes(file));
  const collisions = untrackedInTarget(ctx, target).filter((file) => !legacy.moveAway.includes(file));
  const stash = await handleEdits(ctx, edited, collisions);

  const plan = [
    ...describeLegacy(legacy),
    ...(stash ? ["Put your local edits in git stash"] : []),
    `Move the code from v${current} to ${target} (git fast-forward)`,
    "Install packages with bun install",
    ctx.flags["no-deploy"] ? "Skip the deploy (--no-deploy)" : "Build and deploy to Cloudflare. Your secrets and data stay there. The database schema updates on the first request.",
  ];
  say.block("The update does this", plan.map((step, index) => `${index + 1}. ${step}`).join("\n"));
  if (!(await approve(ctx, `Update Beep Me to ${target}?`))) return say.outro("Stopped. Nothing changed.");

  if (ctx.dryRun) for (const line of describeLegacy(legacy)) say.dryRun(line);
  else applyLegacy(ctx.root, legacy);
  if (stash && !git(ctx, ["stash", "push", "--message", `beep-me update from v${current}`], { write: true }).ok) throw new Error("git stash failed. Nothing else changed.");
  fastForward(ctx, target);
  install(ctx);
  if (ctx.dryRun) return finish(ctx, current, target.slice(1));

  const forward = FORWARD.filter((flag) => ctx.flags[flag]).map((flag) => `--${flag}`);
  const account = ctx.flags["account-id"] ? ["--account-id", ctx.flags["account-id"]] : [];
  const next = spawnSync(process.execPath, ["scripts/cli/main.ts", "upgrade", "--continue", "--from", current, ...forward, ...account], { cwd: ctx.root, stdio: "inherit" });
  process.exit(next.status ?? 1);
}
