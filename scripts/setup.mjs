#!/usr/bin/env node
// Guided first deploy: creates D1 + KV, sets secrets, deploys, and walks through the Google sign-in client.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const CONFIG = "wrangler.jsonc";
const bold = (text) => `\x1b[1m${text}\x1b[0m`;
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const step = (n, text) => console.log(`\n${bold(`${n}.`)} ${bold(text)}`);
const rl = createInterface({ input: stdin, output: stdout });

function wrangler(args, { input, inherit = false } = {}) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    input,
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0 && !inherit) {
    const error = new Error(`wrangler ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
    error.output = `${result.stdout}\n${result.stderr}`;
    throw error;
  }
  return result.stdout ?? "";
}

async function ask(question, fallback = "") {
  const answer = (await rl.question(`${question}${fallback ? dim(` (${fallback})`) : ""}: `)).trim();
  return answer || fallback;
}

function readConfig() {
  return readFileSync(CONFIG, "utf8");
}

function ensureLoggedIn() {
  try {
    const who = wrangler(["whoami"]);
    if (/not authenticated|You are not logged in/i.test(who)) throw new Error("logged out");
    console.log(green("✓ Signed in to Cloudflare"));
  } catch {
    console.log("Opening the Cloudflare sign-in page in your browser.");
    wrangler(["login"], { inherit: true });
  }
}

function ensureD1() {
  const config = readConfig();
  if (/"database_id"\s*:/.test(config)) return console.log(green("✓ D1 database already in wrangler.jsonc"));
  const existing = JSON.parse(wrangler(["d1", "list", "--json"])).find((db) => db.name === "beep-me");
  const id = existing?.uuid ?? wrangler(["d1", "create", "beep-me"]).match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/)?.[1];
  if (!id) throw new Error("Could not read the D1 database id from Wrangler.");
  writeFileSync(CONFIG, config.replace(/("database_name"\s*:\s*"beep-me")/, `$1, "database_id": "${id}"`));
  console.log(green(`✓ D1 database ${existing ? "found" : "created"}: beep-me (${id})`));
}

function ensureKv() {
  const config = readConfig();
  if (/"binding"\s*:\s*"OAUTH_KV"\s*,\s*"id"/.test(config)) return console.log(green("✓ KV namespace already in wrangler.jsonc"));
  const title = "beep-me-oauth";
  const list = JSON.parse(wrangler(["kv", "namespace", "list"]));
  const existing = list.find((ns) => ns.title === title);
  const id = existing?.id ?? wrangler(["kv", "namespace", "create", title]).match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/)?.[1];
  if (!id) throw new Error("Could not read the KV namespace id from Wrangler.");
  writeFileSync(CONFIG, config.replace(/\{\s*"binding"\s*:\s*"OAUTH_KV"\s*\}/, `{ "binding": "OAUTH_KV", "id": "${id}" }`));
  console.log(green(`✓ KV namespace ${existing ? "found" : "created"}: ${title} (${id})`));
}

function setAllowedEmails(emails) {
  const config = readConfig();
  writeFileSync(CONFIG, config.replace(/"ALLOWED_EMAILS"\s*:\s*"[^"]*"/, `"ALLOWED_EMAILS": "${emails.replace(/"/g, "")}"`));
}

function existingSecrets() {
  try {
    return new Set(JSON.parse(wrangler(["secret", "list", "--format", "json"])).map((secret) => secret.name));
  } catch {
    return new Set();
  }
}

function deploy(secrets) {
  const file = join(tmpdir(), `beep-me-secrets-${randomBytes(6).toString("hex")}.json`);
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  try {
    execFileSync("npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
    const args = ["deploy", ...(Object.keys(secrets).length ? ["--secrets-file", file] : [])];
    const out = wrangler(args);
    console.log(dim(out.trim().split("\n").slice(-6).join("\n")));
    return out.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0] ?? null;
  } finally {
    rmSync(file, { force: true });
  }
}

async function main() {
  console.log(bold("\nBeep Me setup\n") + "This deploys Beep Me to your Cloudflare account. It takes about 3 minutes.");

  step(1, "Cloudflare account");
  ensureLoggedIn();

  step(2, "Storage");
  ensureD1();
  ensureKv();

  step(3, "Who can sign in");
  let gitEmail = "";
  try {
    gitEmail = execFileSync("git", ["config", "user.email"], { encoding: "utf8" }).trim();
  } catch {}
  const emails = await ask("Google account email(s) allowed to sign in, comma-separated", gitEmail);
  setAllowedEmails(emails);
  console.log(green(`✓ ALLOWED_EMAILS set to ${emails || "the first account that signs in"}`));

  step(4, "Deploy");
  const secrets = existingSecrets();
  const firstSecrets = secrets.has("APP_SECRET") ? {} : { APP_SECRET: randomBytes(32).toString("hex") };
  let url = deploy(firstSecrets);
  if (!url) url = (await ask("Paste your Worker URL (https://beep-me.<you>.workers.dev)")).replace(/\/+$/, "");
  console.log(green(`✓ Deployed to ${url}`));

  step(5, "Google sign-in");
  if (secrets.has("GOOGLE_CLIENT_ID") && secrets.has("GOOGLE_CLIENT_SECRET")) {
    console.log(green("✓ Google client already set"));
  } else {
    console.log(`Create a Google OAuth client:
  1. Open ${bold("https://console.cloud.google.com/auth/clients/create")}
  2. Application type: ${bold("Web application")}. Name: Beep Me.
  3. Authorized redirect URI: ${bold(`${url}/auth/google/callback`)}
  4. Create, then copy the client ID and client secret.
  ${dim("Optional, for the Gmail channel: enable the Gmail API at https://console.cloud.google.com/apis/library/gmail.googleapis.com")}`);
    const clientId = await ask("Client ID");
    const clientSecret = await ask("Client secret");
    if (clientId && clientSecret) {
      wrangler(["secret", "bulk"], { input: JSON.stringify({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret }) });
      console.log(green("✓ Google client saved"));
    } else {
      console.log("Skipped. Run npm run setup again when you have the client ID and secret.");
    }
  }

  step(6, "Done");
  console.log(`Open ${bold(url)} on your phone and sign in with Google.
Then connect a channel and press Test.

Add Beep Me to Claude Code:
  ${bold(`claude mcp add --transport http --scope user beep-me ${url}/mcp`)}
Add Beep Me to Claude (web, desktop, mobile):
  Customize > Connectors > + Add > Add custom connector > ${bold(`${url}/mcp`)}
`);
}

main()
  .catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
