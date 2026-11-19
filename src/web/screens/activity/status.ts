import type { DeliveryStatus, FallbackStatus, MessageStatus } from "../../../shared/api";
import type { Tone } from "../../components/ui";

export const MESSAGE_STATUS: Record<MessageStatus, { label: string; tone: Tone }> = {
  delivered: { label: "Delivered", tone: "ok" },
  partial: { label: "Partly delivered", tone: "warn" },
  failed: { label: "Failed", tone: "error" },
  muted: { label: "Muted", tone: "neutral" },
  throttled: { label: "Over limit", tone: "warn" },
  paused: { label: "Paused", tone: "neutral" },
};

export const DELIVERY_STATUS: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  pending: { label: "Queued", tone: "neutral" },
  sent: { label: "Sent", tone: "ok" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Failed", tone: "error" },
};

export const FALLBACK_STATUS: Record<FallbackStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "accent" },
  sending: { label: "Sending", tone: "accent" },
  sent: { label: "Sent", tone: "ok" },
  skipped: { label: "Skipped", tone: "warn" },
  canceled: { label: "Canceled", tone: "neutral" },
};
