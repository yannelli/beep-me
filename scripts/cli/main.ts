#!/usr/bin/env node
import { connect, domainCommand, googleCommand, logs, open, teardown } from "./admin.ts";
import { signIn, type Account } from "./cloudflare.ts";
import { createContext, UsageError, type Ctx } from "./context.ts";
import { deployCommand } from "./deploy.ts";
import { commandHelp, COMMANDS, mainHelp } from "./help.ts";
import { agentsList, agentsMute, agentsRevoke, channelsList, messagesList, pause, resume, status } from "./manage.ts";
import { emailsCommand, setup } from "./setup.ts";
import { dim, prompt, say, type Choice } from "./ui.ts";
import { upgradeCommand } from "./upgrade.ts";
import { updateAvailable } from "./versions.ts";
import { query } from "./wrangler.ts";

const LOCAL_COMMANDS = new Set(["agents", "channels", "messages", "pause", "resume"]);

async function run(ctx: Ctx, account: Account | null, args: string[]): Promise<void> {
  const [command, sub, ...rest] = args;
  switch (command) {
    case "status":
      if (!account) throw new UsageError("status reads Cloudflare. Run it without --local.");
      return status(ctx, account);
    case "agents":
      if (sub === "list" || sub === undefined) return agentsList(ctx);
      if (sub === "revoke") return agentsRevoke(ctx, rest[0]);
      if (sub === "mute") return agentsMute(ctx, rest[0], rest[1]);
      throw new UsageError(`Unknown agents command "${sub}". Use list, revoke, or mute.`);
    case "channels":
      return channelsList(ctx);
    case "messages":
      return messagesList(ctx);
    case "pause":
      return pause(ctx, sub);
    case "resume":
      return resume(ctx);
    case "emails":
      return emailsCommand(ctx);
    case "google":
      return googleCommand(ctx);
    case "domain":
      return domainCommand(ctx);
    case "deploy":
      return deployCommand(ctx);
    case "logs":
      return logs(ctx);
    case "open":
      return open(ctx);
    case "connect":
      return connect(ctx);
    case "teardown":
      return teardown(ctx);
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}

async function pickAgent(ctx: Ctx): Promise<string | null> {
  const result = query<{ id: string; name: string; status: string }>(ctx, "SELECT id, name, status FROM agents WHERE status = 'active' ORDER BY name");
  if (!result.ok) throw new Error(result.error);
  if (!result.rows.length) {
    say.info("No active agents.");
    return null;
  }
  return prompt.select("Which agent?", result.rows.map((agent) => ({ value: agent.id, label: agent.name, hint: agent.id })));
}

const MENU: Choice<string>[] = [
  { value: "status", label: "Status" },
  { value: "agents list", label: "Agents" },
  { value: "agents mute", label: "Mute an agent" },
  { value: "agents revoke", label: "Revoke an agent" },
  { value: "channels", label: "Channels" },
  { value: "messages", label: "Latest messages" },
  { value: "pause", label: "Pause delivery" },
  { value: "resume", label: "Resume delivery" },
  { value: "emails", label: "Who can sign in" },
  { value: "google", label: "Google sign-in client" },
  { value: "domain", label: "Domain and aliases" },
  { value: "deploy", label: "Deploy" },
  { value: "logs", label: "Live logs" },
  { value: "open", label: "Open the dashboard" },
  { value: "connect", label: "Connect an agent" },
  { value: "setup", label: "Run setup again" },
  { value: "teardown", label: "Delete this deployment" },
  { value: "quit", label: "Quit" },
];

async function menu(ctx: Ctx): Promise<void> {
  say.intro("Beep Me");
  const account = await signIn(ctx);
  say.info(`Account: ${account.name} ${dim(account.id)}`);
  const latest = updateAvailable(ctx);
  const update: Choice<string> = { value: "upgrade", label: latest ? `Update available: ${latest}` : "Update Beep Me" };
  const options = MENU.flatMap((item) => (item.value === "deploy" ? [update, item] : [item]));
  for (;;) {
    const choice = await prompt.select("What do you want to do?", options);
    if (choice === "quit") return say.outro("Bye.");
    if (choice === "upgrade") return upgradeCommand(ctx);
    try {
      if (choice === "setup") await setup(ctx);
      else if (choice === "agents mute" || choice === "agents revoke") {
        const id = await pickAgent(ctx);
        if (!id) continue;
        const minutes = choice === "agents mute" ? await prompt.select("Mute for how long?", [30, 60, 240, 1440, 0].map((value) => ({ value: String(value), label: value ? `${value} minutes` : "Unmute" }))) : undefined;
        await run(ctx, account, [...choice.split(" "), id, ...(minutes ? [minutes] : [])]);
      } else if (choice === "pause") {
        const minutes = await prompt.select("Pause for how long?", [30, 60, 120, 480, 1440].map((value) => ({ value: String(value), label: `${value} minutes` })));
        await run(ctx, account, ["pause", minutes]);
      } else await run(ctx, account, choice.split(" "));
    } catch (error) {
      say.error((error as Error).message);
    }
  }
}

async function main(): Promise<void> {
  const { ctx, positionals } = createContext(process.argv.slice(2));
  const [command] = positionals;
  if (command === "help" || (ctx.flags.help && !command)) return void console.log(mainHelp());
  if (ctx.flags.help) {
    if (!COMMANDS[command]) throw new UsageError(`Unknown command "${command}".`);
    return void console.log(commandHelp(command));
  }
  if (!command) {
    if (!ctx.interactive) throw new UsageError("The menu needs a terminal. Give a command, for example bun run cli status.");
    return menu(ctx);
  }
  if (command === "setup") return setup(ctx);
  if (command === "upgrade") return upgradeCommand(ctx);
  if (!COMMANDS[command]) throw new UsageError(`Unknown command "${command}".`);
  const account = ctx.flags.local && LOCAL_COMMANDS.has(command) ? null : await signIn(ctx);
  await run(ctx, account, positionals);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\nRun bun run cli --help for commands and flags.\n`);
    process.exit(2);
  }
  say.error((error as Error).message);
  process.exit(1);
});
