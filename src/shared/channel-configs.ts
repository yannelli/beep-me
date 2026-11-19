import { z } from "zod";
import type { ChannelKind } from "./channels";

const phone = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Use international format, like +15551234567.");
const email = z.string().trim().email("Enter a valid email address.");
const httpsUrl = z
  .string()
  .trim()
  .url("Enter a full URL.")
  .refine((value) => /^https:\/\//i.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value), "Use an https URL.");
const optionalText = z.string().trim().optional().transform((value) => (value ? value : undefined));
const subjectPrefix = z.string().trim().max(40).optional().transform((value) => (value ? value : undefined));
const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, "Enter a domain, like agents.example.com.")
  .optional()
  .or(z.literal("").transform(() => undefined));
/** Test mocks only: the API base can point at a local server, never at another host. */
const localApiBase = z.string().regex(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/).optional();

/** Stored config for each channel kind. Fields not in the catalog form are set by the server. */
export const channelConfigSchemas = {
  telegram: z.object({
    botToken: z.string().trim().regex(/^\d{5,}:[\w-]{30,}$/, "This does not look like a bot token from @BotFather."),
    botId: z.number().optional(),
    botUsername: z.string().optional(),
    /** Set when the bot has forum topic mode on in private chats (getMe.has_topics_enabled). */
    privateTopics: z.boolean().optional(),
    /** Main chat, linked with the /start deep link. */
    chatId: z.string().optional(),
    chatTitle: z.string().optional(),
    /** Forum supergroup used for topic threads when private topics are off. */
    topicsChatId: z.string().optional(),
    topicsChatTitle: z.string().optional(),
    webhookSecret: z.string().optional(),
  }),
  twilio: z.object({
    accountSid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, "Account SIDs start with AC and have 34 characters."),
    authToken: z.string().trim().min(16, "Paste the full auth token."),
    from: z.string().trim().regex(/^(\+[1-9]\d{6,14}|MG[0-9a-fA-F]{32})$/, "Use a number like +15551234567 or a Messaging Service SID (MG…)."),
    to: phone,
    /** Path secret of the inbound URL /hooks/sms/twilio/<channel>/<token>. */
    webhookToken: z.string().optional(),
    /** Result of pointing the number's incoming message URL at Beep Me. */
    inboundDetail: z.string().optional(),
  }),
  telnyx: z.object({
    apiKey: z.string().trim().min(16, "Paste the full API key."),
    from: phone,
    to: phone,
    messagingProfileId: optionalText,
    /** Ed25519 public key of the Telnyx account (Base64). Inbound webhooks must carry a valid signature. */
    publicKey: optionalText.refine((value) => !value || /^[A-Za-z0-9+/]{43}=$/.test(value), "Paste the public key from Keys & Credentials in the Telnyx portal."),
    /** Path secret of the inbound URL /hooks/telnyx/<channel>/<token>. */
    webhookToken: z.string().optional(),
  }),
  resend: z.object({
    apiKey: z.string().trim().startsWith("re_", "Resend API keys start with re_."),
    from: optionalText,
    to: email,
    /** Each agent sends from and gets replies at its own address on this domain. */
    domain: domainName,
    subjectPrefix,
    webhookSecret: z.string().trim().startsWith("whsec_", "Resend signing secrets start with whsec_.").optional().or(z.literal("").transform(() => undefined)),
    webhookId: z.string().optional(),
    apiBase: localApiBase,
  }),
  gmail: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("oauth"),
      email: email.optional(),
      refreshToken: z.string().optional(),
      accessToken: z.string().optional(),
      accessTokenExpiresAt: z.number().optional(),
      to: email.optional().or(z.literal("").transform(() => undefined)),
      subjectPrefix,
    }),
    z.object({
      mode: z.literal("app_password"),
      email,
      appPassword: z.string().trim().transform((value) => value.replace(/\s+/g, "")).pipe(z.string().length(16, "App passwords have 16 letters.")),
      to: email.optional().or(z.literal("").transform(() => undefined)),
      subjectPrefix,
    }),
  ]),
  smtp: z.object({
    host: z.string().trim().min(3),
    security: z.enum(["tls", "starttls"]),
    port: z.coerce.number().int().min(1).max(65535).refine((port) => port !== 25, "Cloudflare blocks port 25. Use 465 or 587."),
    username: z.string().trim().min(1),
    password: z.string().min(1),
    from: z.string().trim().min(3),
    to: email,
    subjectPrefix,
  }),
  slack: z.object({
    webhookUrl: httpsUrl.refine((value) => value.startsWith("https://hooks.slack.com/"), "Slack webhook URLs start with https://hooks.slack.com/."),
  }),
  discord: z.object({
    webhookUrl: httpsUrl.refine((value) => /^https:\/\/(\w+\.)?discord(app)?\.com\/api\/webhooks\//.test(value), "Use a Discord webhook URL."),
    forumThreads: z.boolean().default(false),
  }),
  ntfy: z.object({
    server: httpsUrl.transform((value) => value.replace(/\/+$/, "")),
    topic: z.string().trim().regex(/^[\w-]{1,64}$/, "Use letters, numbers, dashes, and underscores."),
    token: optionalText,
  }),
  pushover: z.object({
    appToken: z.string().trim().regex(/^\w{30}$/, "App tokens have 30 characters."),
    userKey: z.string().trim().regex(/^\w{30}$/, "User keys have 30 characters."),
    device: optionalText,
  }),
  webhook: z.object({
    url: httpsUrl,
    secret: optionalText,
  }),
} satisfies Record<ChannelKind, z.ZodType>;

export type ChannelConfigs = { [K in ChannelKind]: z.output<(typeof channelConfigSchemas)[K]> };
export type ChannelConfig<K extends ChannelKind> = ChannelConfigs[K];
