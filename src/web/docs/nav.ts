export interface DocPage {
  /** Path after /docs/. The empty slug is /docs. The MDX file is content/<slug or "index">.mdx */
  slug: string;
  title: string;
  description: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    title: "Get started",
    pages: [
      { slug: "", title: "Introduction", description: "What Beep Me does, and how a message gets from an agent to your phone." },
      { slug: "quickstart", title: "Quickstart", description: "Deploy Beep Me and get your first message in about five minutes." },
      { slug: "local-development", title: "Local development", description: "Run Beep Me on your computer with hot reload and a developer sign-in." },
    ],
  },
  {
    title: "Connect agents",
    pages: [
      { slug: "agents/claude", title: "Claude", description: "Add Beep Me to Claude on the web, desktop, and mobile as a custom connector." },
      { slug: "agents/claude-code", title: "Claude Code", description: "Add Beep Me to Claude Code with one command." },
      { slug: "agents/other-clients", title: "Other MCP clients", description: "Connect any MCP client that supports remote servers." },
      { slug: "agents/scripts", title: "Scripts and CI", description: "Send messages from curl, cron jobs, and CI pipelines with an agent token." },
      { slug: "agents/replies", title: "Replies and questions", description: "Let agents ask you something, send files, and read your answers." },
      { slug: "agents/access", title: "Agent access", description: "Set each agent's channels and highest priority, and mute or revoke it." },
    ],
  },
  {
    title: "Channels",
    pages: [
      { slug: "channels", title: "Overview", description: "Every channel Beep Me can send to, and what each one needs." },
      { slug: "channels/telegram", title: "Telegram", description: "A main chat for updates, plus a thread for each topic." },
      { slug: "channels/twilio", title: "Twilio SMS", description: "Text messages from your Twilio number." },
      { slug: "channels/telnyx", title: "Telnyx SMS", description: "Text messages from your Telnyx number." },
      { slug: "channels/resend", title: "Resend", description: "Email through the Resend API." },
      { slug: "channels/gmail", title: "Gmail", description: "Email from your own Gmail account." },
      { slug: "channels/smtp", title: "SMTP", description: "Email through any SMTP server." },
      { slug: "channels/slack", title: "Slack", description: "Posts to a Slack channel with an incoming webhook." },
      { slug: "channels/discord", title: "Discord", description: "Posts to a Discord channel, with a forum post for each topic." },
      { slug: "channels/ntfy", title: "ntfy", description: "Free phone push with the ntfy app." },
      { slug: "channels/pushover", title: "Pushover", description: "Phone push with priority levels and emergency alerts." },
      { slug: "channels/webhook", title: "Webhook", description: "A signed JSON request to any URL." },
    ],
  },
  {
    title: "Routing",
    pages: [
      { slug: "routing/priorities", title: "Priorities", description: "The four priority levels, and when an agent should use each one." },
      { slug: "routing/routes-and-rules", title: "Routes and rules", description: "Choose where each priority goes, and add rules for topics and agents." },
      { slug: "routing/quiet-hours", title: "Quiet hours", description: "Keep your phone silent at night and let urgent messages through." },
      { slug: "routing/limits", title: "Limits and repeats", description: "Text caps, message caps, collapsed repeats, and pausing everything." },
      { slug: "routing/topics", title: "Topics", description: "Group messages by project, with a thread for each topic." },
      { slug: "routing/delivery-log", title: "Delivery log", description: "Read what each agent sent, where it went, and whether it arrived." },
    ],
  },
  {
    title: "Reference",
    pages: [
      { slug: "reference/mcp", title: "MCP server", description: "The tools, prompt, instructions, and sign-in that Beep Me gives MCP clients." },
      { slug: "reference/rest-api", title: "REST API", description: "Send a notification with one HTTP request." },
      { slug: "reference/configuration", title: "Configuration", description: "Secrets, variables, custom domains, and data retention." },
      { slug: "reference/security", title: "Security", description: "How Beep Me stores keys, signs requests, and cuts off agents." },
      { slug: "reference/troubleshooting", title: "Troubleshooting", description: "Fixes for the problems people hit most." },
    ],
  },
];

export const DOC_PAGES: (DocPage & { section: string })[] = DOC_SECTIONS.flatMap((section) =>
  section.pages.map((page) => ({ ...page, section: section.title })),
);

export function docHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export function findDocPage(path: string): (DocPage & { section: string }) | undefined {
  const slug = path.replace(/^\/docs\/?/, "").replace(/\/+$/, "");
  return DOC_PAGES.find((page) => page.slug === slug);
}
