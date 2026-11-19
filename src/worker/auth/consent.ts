import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { isPriority } from "../../shared/priority";
import { createAgent, getAgent, listClientAgents, revokeAgent, updateAgent, type Agent } from "../db/agents";
import { listChannels } from "../db/channels";
import { renderConsentPage, renderMessagePage } from "./consent-page";
import { sessionUser, type AppEnv } from "./session";

export interface McpGrantProps {
  userId: string;
  agentId: string;
}

export const consentRoutes = new Hono<AppEnv>();

function handleError(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
  if (error instanceof AuthorizationError) return renderMessagePage("This request cannot continue", error.description ?? "The sign-in request is not valid.");
  if (error instanceof CimdFetchError) return renderMessagePage("This app could not be verified", "Beep Me could not read the app's metadata. Try again later.");
  throw error;
}

consentRoutes.get("/authorize", async (c) => {
  try {
    const oauth = c.env.OAUTH_PROVIDER;
    const request = await oauth.parseAuthRequest(c.req.raw);
    const user = await sessionUser(c.req.raw, c.env);
    if (!user) {
      const url = new URL(c.req.url);
      return c.redirect(`/?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
    const details = await oauth.describeConsent(request);
    const [agents, channels] = await Promise.all([listClientAgents(c.env.DB, user.id, request.clientId), listChannels(c.env, user.id)]);
    const consent = await oauth.beginConsent(request);
    consent.headers.set("content-type", "text/html; charset=utf-8");
    return new Response(renderConsentPage({ details, handle: consent.handle, user, agents, channels }), { headers: consent.headers });
  } catch (error) {
    return handleError(error);
  }
});

consentRoutes.post("/authorize", async (c) => {
  try {
    const oauth = c.env.OAUTH_PROVIDER;
    const user = await sessionUser(c.req.raw, c.env);
    if (!user) return renderMessagePage("Sign in first", "Your Beep Me session ended. Start the connection again from your app.", 401);
    const form = await c.req.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope: ["notify"] });
    const client = await oauth.lookupClient(approved.request.clientId);
    const name = String(form.get("name") ?? "").trim().slice(0, 60) || client?.clientName || "Agent";
    const maxPriority = isPriority(form.get("max_priority")) ? (form.get("max_priority") as Agent["maxPriority"]) : "high";
    const owned = new Set((await listChannels(c.env, user.id)).map((channel) => channel.id));
    const channelIds = form.get("scope") === "custom" ? form.getAll("channel").map(String).filter((id) => owned.has(id)) : null;

    const chosen = String(form.get("agent") ?? "new");
    const existing = chosen !== "new" ? await getAgent(c.env.DB, chosen, user.id) : null;
    const agent =
      existing && existing.status === "active" && existing.clientId === approved.request.clientId
        ? await updateAgent(c.env.DB, user.id, existing.id, { name, maxPriority, channelIds })
        : await createAgent(c.env.DB, {
            userId: user.id,
            name,
            kind: "oauth",
            clientId: approved.request.clientId,
            clientName: client?.clientName ?? null,
            maxPriority,
            channelIds,
          });
    if (!agent) throw new Error("Agent was not saved");

    const props: McpGrantProps = { userId: user.id, agentId: agent.id };
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: user.id,
      metadata: { agentId: agent.id },
      scope: approved.request.scope.length ? approved.request.scope : ["notify"],
      props,
    });
    approved.headers.set("location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    return handleError(error);
  }
});

/** Marks the agent revoked in D1 (checked on every request) and deletes its OAuth grants. */
export async function revokeAgentAccess(env: Env, userId: string, agentId: string): Promise<Agent | null> {
  const agent = await revokeAgent(env.DB, userId, agentId);
  if (agent?.kind === "oauth") {
    let cursor: string | undefined;
    do {
      const page = await env.OAUTH_PROVIDER.listUserGrants(userId, { cursor });
      for (const grant of page.items) {
        if ((grant.metadata as { agentId?: string } | null)?.agentId === agentId) await env.OAUTH_PROVIDER.revokeGrant(grant.id, userId);
      }
      cursor = page.cursor;
    } while (cursor);
  }
  return agent;
}
