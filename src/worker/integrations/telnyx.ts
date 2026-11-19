import { Hono } from "hono";
import type { AppEnv } from "../auth/session";

/** Dashboard API for guided Telnyx setup (numbers, messaging profiles, webhooks, 10DLC). Mounted at /api/integrations/telnyx. */
export const telnyxIntegration = new Hono<AppEnv>();
