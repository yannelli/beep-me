import { Hono } from "hono";
import type { AppEnv } from "../auth/session";

/** Inbound Resend email webhooks (replies by email). Owned by the email work; mounted at /hooks/resend. */
export const resendHook = new Hono<AppEnv>();
