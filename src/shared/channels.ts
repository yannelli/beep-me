export const CHANNEL_KINDS = [
  "telegram",
  "twilio",
  "telnyx",
  "resend",
  "gmail",
  "smtp",
  "slack",
  "discord",
  "ntfy",
  "pushover",
  "webhook",
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** "main" is the channel's default destination. "topic" is the per-topic thread (Telegram topics, Discord forum posts). */
export type ChannelTarget = "main" | "topic";

export type ChannelCategory = "chat" | "sms" | "email" | "push" | "developer";

export type FieldType = "text" | "secret" | "phone" | "email" | "url" | "number" | "select" | "toggle";

export interface ChannelField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean;
  /** Show the field only when another field has this value. */
  showWhen?: { key: string; equals: string | boolean };
}

/** How the add-channel sheet sets the channel up. */
export type ChannelSetup = "form" | "telegram" | "gmail";

export interface ChannelKindInfo {
  kind: ChannelKind;
  name: string;
  category: ChannelCategory;
  tagline: string;
  color: string;
  setup: ChannelSetup;
  /** Where the user gets the keys this form asks for. */
  keysUrl: string;
  keysLabel: string;
  fields: ChannelField[];
  /** True when this channel sends text messages. Text caps and quiet hours treat these differently. */
  isSms: boolean;
  /** True when the channel can deliver without sound during quiet hours. */
  supportsSilent: boolean;
}

export function isChannelKind(value: unknown): value is ChannelKind {
  return typeof value === "string" && (CHANNEL_KINDS as readonly string[]).includes(value);
}

export function secretFieldKeys(info: ChannelKindInfo): string[] {
  return info.fields.filter((field) => field.type === "secret").map((field) => field.key);
}
