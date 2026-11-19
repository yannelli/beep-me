import { Hono } from "hono";
import { agentsApi } from "./api/agents";
import { channelsApi } from "./api/channels";
import { meApi, publicApi } from "./api/me";
import { messagesApi } from "./api/messages";
import { v1Routes } from "./api/v1";
import { consentRoutes } from "./auth/consent";
import { authRoutes } from "./auth/google";
import { isSameOriginWrite, publicOrigin, sessionUser, type AppEnv } from "./auth/session";
import { serveMedia } from "./core/media";
import { interactionMedia } from "./core/replies";
import { getInteraction } from "./db/interactions";
import { resendHook } from "./hooks/resend";
import { smsHook } from "./hooks/sms";
import { telegramHook } from "./hooks/telegram";
import { telnyxHook } from "./hooks/telnyx";
import { ntfyHook } from "./hooks/ntfy";
import { resendIntegration } from "./integrations/resend";
import { telnyxIntegration } from "./integrations/telnyx";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("origin", publicOrigin(c.req.raw, c.env));
    await next();
  });

  app.route("/auth", authRoutes);
  app.route("/", consentRoutes);
  app.route("/v1", v1Routes);
  app.route("/hooks/telegram", telegramHook);
  app.route("/hooks/sms", smsHook);
  app.route("/hooks/telnyx", telnyxHook);
  app.route("/hooks/resend", resendHook);
  app.route("/hooks/ntfy", ntfyHook);
  app.get("/media/:id/:name", (c) => serveMedia(c.env, c.req.param("id")));
  app.route("/api", publicApi);

  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    if (!isSameOriginWrite(c)) return c.json({ error: "Cross-site request blocked." }, 403);
    const user = await sessionUser(c.req.raw, c.env);
    if (!user) return c.json({ error: "Sign in to continue." }, 401);
    c.set("user", user);
    await next();
  });
  api.route("/", meApi);
  api.route("/channels", channelsApi);
  api.route("/agents", agentsApi);
  api.route("/integrations/telnyx", telnyxIntegration);
  api.route("/integrations/resend", resendIntegration);
  api.get("/media/:interaction/:index", async (c) => {
    const row = await getInteraction(c.env.DB, c.req.param("interaction"));
    if (!row || row.user_id !== c.get("user").id) return c.json({ error: "Not found" }, 404);
    return interactionMedia(c.env, row, Number(c.req.param("index")));
  });
  api.route("/", messagesApi);
  app.route("/api", api);

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((error, c) => {
    console.error("Unhandled error", error);
    return c.json({ error: "Something went wrong. Check the Worker logs." }, 500);
  });
  return app;
}
