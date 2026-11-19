import { Hono } from "hono";
import type { DeliveryStatus } from "../../shared/api";
import type { AppEnv } from "../auth/session";
import { updateDeliveryStatus } from "../db/messages";
import { hmacVerify } from "../lib/crypto";

export const smsHook = new Hono<AppEnv>();

const TWILIO: Record<string, DeliveryStatus> = { delivered: "delivered", undelivered: "failed", failed: "failed", sent: "sent" };
const TELNYX: Record<string, DeliveryStatus> = { delivered: "delivered", delivery_failed: "failed", sending_failed: "failed", sent: "sent" };

/** Delivery receipts from Twilio (form body) and Telnyx (JSON). The URL carries an HMAC of the delivery id. */
smsHook.post("/:deliveryId/:signature", async (c) => {
  const { deliveryId, signature } = c.req.param();
  if (!(await hmacVerify(c.env.APP_SECRET, "callback", deliveryId, signature))) return c.json({ ok: false }, 403);
  const contentType = c.req.header("content-type") ?? "";
  let status: DeliveryStatus | undefined;
  let detail: string | null = null;
  if (contentType.includes("application/json")) {
    const body = await c.req.json<{ data?: { payload?: { to?: { status?: string }[]; errors?: { title?: string; detail?: string }[] } } }>();
    const payload = body.data?.payload;
    status = TELNYX[payload?.to?.[0]?.status ?? ""];
    const error = payload?.errors?.[0];
    if (error) detail = `Telnyx: ${error.detail ?? error.title ?? "delivery failed"}`;
  } else {
    const form = await c.req.parseBody();
    status = TWILIO[String(form.MessageStatus ?? "")];
    if (form.ErrorCode) detail = `Twilio error ${String(form.ErrorCode)}`;
  }
  if (status && status !== "sent") await updateDeliveryStatus(c.env.DB, deliveryId, status, detail);
  return c.body(null, 204);
});
