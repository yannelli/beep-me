import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createApp } from "./app";
import { renderMessagePage } from "./auth/consent-page";
import { isLocalHost, publicOrigin } from "./auth/session";
import { findAgentByToken } from "./db/agents";
import { pruneMessages } from "./db/messages";
import { ensureSchema } from "./db/migrate";
import { runUpgradeTasks } from "./core/upgrade-tasks";
import { handleMcp } from "./mcp/handler";

const app = createApp();
const providers = new Map<string, OAuthProvider<Env>>();
const RETENTION_MS = 30 * 86_400_000;

/** One provider per origin, because every token is bound to the exact MCP URL (workers.dev, custom domain, or localhost). */
function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (provider) return provider;
  const resource = `${origin}/mcp`;
  provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { fetch: handleMcp as never },
    defaultHandler: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx) },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["notify"],
    resourceMetadata: { resource, authorization_servers: [origin], resource_name: "Beep Me", bearer_methods_supported: ["header"] },
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    refreshTokenTTL: 90 * 86_400,
    refreshTokenIdleTTL: 90 * 86_400,
    resolveExternalToken: async ({ token, env }) => {
      const agent = await findAgentByToken(env.DB, token);
      return agent && agent.status === "active" ? { props: { userId: agent.userId, agentId: agent.id }, audience: resource } : null;
    },
  });
  providers.set(origin, provider);
  return provider;
}

/** Sends Worker routes on other hosts to PUBLIC_URL; vite.config.ts does the same for pages. /hooks and /v1 callers do not follow redirects. */
function aliasRedirect(request: Request, env: Env): Response | null {
  const primary = env.PUBLIC_URL?.trim();
  if (!primary || isLocalHost(request)) return null;
  const url = new URL(request.url);
  const target = new URL(primary);
  if (url.hostname === target.hostname || /^\/(hooks|v1|media)\//.test(url.pathname)) return null;
  return Response.redirect(`${target.origin}${url.pathname}${url.search}`, 308);
}

export default {
  async fetch(request, env, ctx) {
    const redirect = aliasRedirect(request, env);
    if (redirect) return redirect;
    if (!env.APP_SECRET || env.APP_SECRET.length < 32) {
      return renderMessagePage("Finish setup", "Set APP_SECRET to a random value of 32 or more characters: bunx wrangler secret put APP_SECRET", 500);
    }
    await ensureSchema(env.DB);
    ctx.waitUntil(runUpgradeTasks(env));
    return providerFor(publicOrigin(request, env)).fetch(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(ensureSchema(env.DB).then(() => Promise.all([pruneMessages(env.DB, Date.now() - RETENTION_MS), runUpgradeTasks(env)])));
  },
} satisfies ExportedHandler<Env>;
