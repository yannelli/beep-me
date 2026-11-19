import { Hono } from "hono";
import type { AppEnv } from "../auth/session";

/** Dashboard API for Resend domains and inbound email setup. Mounted at /api/integrations/resend. */
export const resendIntegration = new Hono<AppEnv>();
