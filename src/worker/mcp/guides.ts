import type { McpServer } from "@modelcontextprotocol/server";
import { SkillsExtension, memorySkillFiles, type SkillCatalog } from "@modelcontextprotocol/server/ext/skills";
import { z } from "zod";
import channels from "./guides/channels.md?raw";
import examples from "./guides/examples.md?raw";
import fallbacks from "./guides/fallbacks.md?raw";
import notify from "./guides/notify.md?raw";
import overview from "./guides/overview.md?raw";
import replies from "./guides/replies.md?raw";
import topics from "./guides/topics.md?raw";
import waiting from "./guides/waiting.md?raw";

export const GUIDES = { overview, notify, channels, topics, replies, waiting, fallbacks, examples } as const;
export type GuideTopic = keyof typeof GUIDES;
const TOPICS = Object.keys(GUIDES) as [GuideTopic, ...GuideTopic[]];

interface SkillDef {
  name: string;
  description: string;
  guides: GuideTopic[];
}

/** One source of text: each skill is a set of guides, served as an MCP skill, a prompt, and through the help tool. */
export const SKILLS: SkillDef[] = [
  {
    name: "beep-me-notify",
    description: "Send Beep Me notifications well: when to send, priorities, topics and threads, picking channels, files, and reading the result.",
    guides: ["overview", "notify", "channels", "topics"],
  },
  {
    name: "beep-me-ask-and-wait",
    description: "Ask the user a question through Beep Me and wait for the answer without spending tokens: watch loop, background or foreground, and reading where an answer came from.",
    guides: ["replies", "waiting", "examples"],
  },
  {
    name: "beep-me-fallbacks",
    description: "Reach the user when they do not answer or a send fails: fallback steps on notify, how they run, and how to cancel them.",
    guides: ["fallbacks"],
  },
];

function skillText(skill: SkillDef): string {
  const body = skill.guides.map((topic) => GUIDES[topic].trim()).join("\n\n");
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${body}\n`;
}

let catalog: Promise<SkillCatalog> | null = null;

/** Built once per isolate. SEP-2640 skills at skill://beep-me/<name>/SKILL.md. */
export function skillCatalog(): Promise<SkillCatalog> {
  catalog ??= SkillsExtension.load(memorySkillFiles(Object.fromEntries(SKILLS.map((skill) => [`${skill.name}/SKILL.md`, skillText(skill)]))), {
    prefix: "beep-me",
    cacheHint: { ttlMs: 3_600_000, cacheScope: "public" },
  }).catch((error: unknown) => {
    catalog = null;
    throw error;
  });
  return catalog;
}

export function registerGuides(server: McpServer): void {
  server.registerTool(
    "help",
    {
      title: "Beep Me help",
      description: `Read how to use Beep Me, with examples. Topics: ${TOPICS.join(", ")}. Start with overview.`,
      inputSchema: z.object({ topic: z.enum(TOPICS).default("overview").describe("The guide to read.") }),
      annotations: { title: "Beep Me help", readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) => ({ content: [{ type: "text" as const, text: GUIDES[topic] }] }),
  );

  for (const skill of SKILLS) {
    server.registerPrompt(skill.name, { title: skill.name, description: skill.description }, () => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `Use this guide for Beep Me in this conversation.\n\n${skillText(skill)}` } }],
    }));
  }
}
