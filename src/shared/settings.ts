import { z } from "zod";
import { PRIORITIES, type Priority } from "./priority";

export const destinationSchema = z.object({
  channelId: z.string().min(1),
  target: z.enum(["main", "topic"]).default("main"),
});
export type Destination = z.infer<typeof destinationSchema>;

export const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  match: z.object({
    priorities: z.array(z.enum(PRIORITIES)).optional(),
    /** Glob patterns, for example "deploy*" or "billing". Case-insensitive. */
    topics: z.array(z.string().trim().min(1).max(64)).optional(),
    agentIds: z.array(z.string()).optional(),
  }),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("route"), destinations: z.array(destinationSchema).min(1) }),
    z.object({ type: z.literal("mute") }),
  ]),
});
export type Rule = z.infer<typeof ruleSchema>;

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour.");

export const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: clock,
  end: clock,
  /** 0 is Sunday. Empty means every day. */
  days: z.array(z.number().int().min(0).max(6)).default([]),
  /** The lowest priority that still makes sound during quiet hours. */
  breakthrough: z.enum(["high", "urgent"]),
});
export type QuietHours = z.infer<typeof quietHoursSchema>;

export const limitsSchema = z.object({
  /** Default text messages per agent per hour. Agents can override it. */
  smsPerHour: z.number().int().min(0).max(100),
  /** Default messages per agent per hour across all channels. */
  messagesPerHour: z.number().int().min(1).max(1000),
  /** Identical messages from one agent inside this window are collapsed into the first one. */
  collapseMinutes: z.number().int().min(0).max(1440),
});
export type Limits = z.infer<typeof limitsSchema>;

export const routesSchema = z.object({
  urgent: z.array(destinationSchema),
  high: z.array(destinationSchema),
  medium: z.array(destinationSchema),
  low: z.array(destinationSchema),
}) satisfies z.ZodType<Record<Priority, Destination[]>>;
export type Routes = z.infer<typeof routesSchema>;

export const userSettingsSchema = z.object({
  timezone: z.string().min(1),
  routes: routesSchema,
  /** False until the user edits routes. While false, routes follow the channels the user connects. */
  routesCustomized: z.boolean(),
  rules: z.array(ruleSchema).max(50),
  quietHours: quietHoursSchema,
  limits: limitsSchema,
  /** Epoch ms. While set and in the future, nothing is delivered. */
  pausedUntil: z.number().nullable(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

/** PATCH /api/settings body. Each key replaces the stored value. */
export const settingsPatchSchema = userSettingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function defaultSettings(timezone = "UTC"): UserSettings {
  return {
    timezone,
    routes: { urgent: [], high: [], medium: [], low: [] },
    routesCustomized: false,
    rules: [],
    quietHours: { enabled: false, start: "22:00", end: "07:00", days: [], breakthrough: "urgent" },
    limits: { smsPerHour: 5, messagesPerHour: 60, collapseMinutes: 10 },
    pausedUntil: null,
  };
}
