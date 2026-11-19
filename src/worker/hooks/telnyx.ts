import { Hono } from "hono";
import type { AppEnv } from "../auth/session";

/** Inbound Telnyx messaging webhooks (replies and MMS). Owned by the Telnyx work; mounted at /hooks/telnyx. */
export const telnyxHook = new Hono<AppEnv>();
