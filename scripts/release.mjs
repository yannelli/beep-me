#!/usr/bin/env node
// Semver release from Conventional Commits: bump package.json, prepend CHANGELOG.md, tag, push, publish the GitHub release.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const levels = { patch: 1, minor: 2, major: 3 };

const run = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const git = (...args) => run("git", args);

export function releaseType(message) {
  const header = /^([a-z]+)(?:\([^\r\n()]+\))?(!)?: \S[^\r\n]*/.exec(message);
  if (!header) return null;
  if (header[2] || /^BREAKING[ -]CHANGE: \S/m.test(message)) return "major";
  if (header[1] === "feat") return "minor";
  if (["fix", "perf", "revert"].includes(header[1])) return "patch";
  return null;
}

export function nextVersion(version, commits) {
  const type = commits.reduce((highest, { message }) => {
    const current = releaseType(message);
    return (levels[current] ?? 0) > (levels[highest] ?? 0) ? current : highest;
  }, null);
  if (!type) return null;
  const [major, minor, patch] = version.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const records = git("log", range, "--format=%H%x00%B%x00").split("\0");
  const commits = [];
  for (let i = 0; i + 1 < records.length; i += 2) commits.push({ hash: records[i].trim(), message: records[i + 1].trim() });
  return commits;
}

function changelogSection(version, commits, repoUrl) {
  const date = new Date().toISOString().slice(0, 10);
  const groups = [
    ["Breaking changes", "major"],
    ["Added", "minor"],
    ["Fixed", "patch"],
  ];
  const lines = [`## [${version}] - ${date}`, ""];
  for (const [title, type] of groups) {
    const matching = commits.filter(({ message }) => releaseType(message) === type);
    if (!matching.length) continue;
    lines.push(`### ${title}`, "");
    for (const { hash, message } of matching) {
      const subject = message.split("\n")[0].replace(/^[a-z]+(?:\(([^)]+)\))?!?: /, (_, scope) => (scope ? `**${scope}:** ` : ""));
      lines.push(`- ${subject} ([${hash.slice(0, 7)}](${repoUrl}/commit/${hash}))`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const repoUrl = String(pkg.repository?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, "");
  if (!dryRun) {
    if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("Release from the main branch.");
    if (git("status", "--porcelain")) throw new Error("Commit or stash your changes first.");
    git("fetch", "--tags", "origin");
  }
  const tags = git("tag", "--list", "v*", "--sort=-v:refname").split("\n").filter((tag) => stableTag.test(tag));
  const latest = tags[0] ?? null;
  const commits = commitsSince(latest);
  const version = latest ? nextVersion(latest.slice(1), commits) : pkg.version;
  if (!version) {
    console.log(`No release: no feat, fix, perf, revert, or breaking commit since ${latest}.`);
    return;
  }
  const section = changelogSection(version, commits, repoUrl);
  console.log(`${latest ?? "first release"} -> v${version}\n\n${section}`);
  if (dryRun) return;

  pkg.version = version;
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const marker = changelog.indexOf("\n## ");
  writeFileSync("CHANGELOG.md", marker < 0 ? `${changelog.trimEnd()}\n\n${section}` : `${changelog.slice(0, marker + 1)}${section}\n${changelog.slice(marker + 1)}`);
  git("add", "package.json", "CHANGELOG.md");
  git("commit", "-m", `chore(release): v${version}`);
  git("tag", "-a", `v${version}`, "-m", `v${version}`);
  git("push", "origin", "main", `v${version}`);
  run("gh", ["release", "create", `v${version}`, "--title", `v${version}`, "--notes", section.split("\n").slice(2).join("\n")]);
  console.log(`Released v${version}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
