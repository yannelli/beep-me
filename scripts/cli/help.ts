import { bold, dim } from "./ui.ts";

interface CommandHelp {
  usage: string;
  summary: string;
  flags?: string[];
  examples: string[];
}

export const COMMANDS: Record<string, CommandHelp> = {
  setup: {
    usage: "setup [flags]",
    summary: "Deploy Beep Me step by step. It finds what already exists and asks before each change.",
    flags: [
      "--account-id <id>            Cloudflare account. Also CLOUDFLARE_ACCOUNT_ID.",
      '--emails <list>              Google accounts that can sign in. "*" allows any account.',
      "--domain <host|none>         Serve on a hostname in one of your Cloudflare zones.",
      "--alias <host>               Extra hostname that redirects to --domain. Repeat it for more.",
      "--workers-dev on|off         Keep or turn off the workers.dev address.",
      "--google-client-id <id>      Also BEEPME_GOOGLE_CLIENT_ID. Without it, setup skips Google sign-in.",
      "--google-client-secret <s>   Use BEEPME_GOOGLE_CLIENT_SECRET instead, to keep it out of shell history.",
      "--rotate-app-secret          Replace APP_SECRET. Stored channel keys become unreadable.",
      "--record <path>              Write a Markdown record with the secrets from this run (mode 600).",
    ],
    examples: [
      "bun run setup",
      "bun run setup --dry-run",
      "BEEPME_GOOGLE_CLIENT_SECRET=... bun run setup --yes --account-id 0123abcd --emails you@example.com --google-client-id 123.apps.googleusercontent.com",
    ],
  },
  status: { usage: "status", summary: "Show the account, addresses, secret names, and counts of users, agents, channels, and messages.", examples: ["bun run cli status", "bun run cli status --json"] },
  agents: {
    usage: "agents list | agents revoke <id> | agents mute <id> <minutes>",
    summary: "List agents, revoke one, or mute one. Mute 0 unmutes. Revoke cuts the agent off on its next request.",
    examples: ["bun run cli agents list", "bun run cli agents mute agt_abc123 60", "bun run cli agents revoke agt_abc123 --yes --confirm agt_abc123"],
  },
  channels: { usage: "channels", summary: "List channels with their status and last error. Channel keys stay encrypted.", examples: ["bun run cli channels --json"] },
  messages: { usage: "messages [--limit <n>]", summary: "Show the latest messages with agent, priority, and status.", examples: ["bun run cli messages --limit 50"] },
  pause: { usage: "pause <minutes>", summary: "Stop all delivery for up to 7 days. Agents get a reply that Beep Me is paused.", examples: ["bun run cli pause 120"] },
  resume: { usage: "resume", summary: "End a pause now.", examples: ["bun run cli resume --yes"] },
  emails: { usage: "emails [--emails <list>]", summary: "Change who can sign in, then deploy.", examples: ['bun run cli emails --yes --emails "you@example.com,partner@example.com"'] },
  google: { usage: "google", summary: "Replace the Google sign-in client ID and secret.", examples: ["bun run cli google"] },
  domain: {
    usage: "domain [--domain <host|none>] [--alias <host>] [--workers-dev on|off]",
    summary: "Move Beep Me to a hostname in your Cloudflare zones, add aliases, or go back to workers.dev. Then deploy.",
    examples: ["bun run cli domain", "bun run cli domain --yes --domain beep.example.com --alias notify.example.com"],
  },
  upgrade: {
    usage: "upgrade [flags]",
    summary: "Update this checkout to the newest release, then build and deploy it. It shows the release notes and asks first.",
    flags: [
      "--check                      Only compare the installed version with the newest release. Add --json for JSON.",
      "--to <vX.Y.Z>                Update to this release. Older releases are refused.",
      "--remote <name>              Read releases from this git remote. Default: upstream, else origin.",
      "--no-deploy                  Update the code and packages, and skip the deploy.",
      "--continue                   Run the deploy part only, after scripts/upgrade.sh or a manual git update.",
    ],
    examples: ["bun run upgrade", "bun run upgrade --check --json", "bun run upgrade --dry-run", "bun run upgrade --yes --to v0.6.0"],
  },
  deploy: { usage: "deploy", summary: "Build with your deployment values and deploy.", examples: ["bun run cli deploy --yes"] },
  logs: { usage: "logs", summary: "Stream live logs from the Worker.", examples: ["bun run cli logs"] },
  open: { usage: "open", summary: "Open the dashboard in your browser, or print its address.", examples: ["bun run cli open"] },
  connect: { usage: "connect", summary: "Print the Claude Code command and the Claude connector steps.", examples: ["bun run cli connect"] },
  teardown: {
    usage: "teardown",
    summary: "Delete the Worker, the D1 database, and the KV namespace. You type the Worker name to confirm.",
    examples: ["bun run cli teardown", "bun run cli teardown --yes --confirm beep-me"],
  },
};

const COMMON = [
  "--yes, -y            Run without questions and accept each change.",
  "--non-interactive    Run without questions. Changes still need --yes.",
  "--confirm <word>     Allow a destructive action in headless mode.",
  "--dry-run            Read your account, print each change and command, and change nothing.",
  "--json               Print JSON on stdout (status, agents list, channels, messages, open, connect).",
  "--local              Run database commands on local dev data in .wrangler/state.",
  "--help, -h           Show help.",
];

export function mainHelp(): string {
  return [
    `${bold("Beep Me CLI")}`,
    "",
    `${bold("Usage")}  bun run cli [command] [flags]`,
    dim("With no command, it opens a menu. bun run setup is the same as bun run cli setup."),
    "",
    bold("Commands"),
    ...Object.entries(COMMANDS).map(([name, entry]) => `  ${name.padEnd(10)}${entry.summary.split(". ")[0].replace(/\.$/, "")}.`),
    "",
    bold("Flags"),
    ...COMMON.map((line) => `  ${line}`),
    "",
    "Headless mode starts when stdin is not a terminal, CI is set, or you pass --yes or --non-interactive.",
    "It never asks. When an input is missing, it lists it and exits with code 2.",
    "",
    `Run ${bold("bun run cli <command> --help")} for the flags and examples of one command.`,
  ].join("\n");
}

export function commandHelp(name: string): string {
  const entry = COMMANDS[name];
  return [
    `${bold("Usage")}  bun run cli ${entry.usage}`,
    "",
    entry.summary,
    ...(entry.flags ? ["", bold("Flags"), ...entry.flags.map((line) => `  ${line}`)] : []),
    "",
    bold("Common flags"),
    ...COMMON.map((line) => `  ${line}`),
    "",
    bold("Examples"),
    ...entry.examples.map((line) => `  ${line}`),
  ].join("\n");
}
