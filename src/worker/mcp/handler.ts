import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import type { McpGrantProps } from "../auth/consent";
import { publicOrigin } from "../auth/session";
import { getAgent, touchAgent } from "../db/agents";
import { getUser } from "../db/users";
import { skillCatalog } from "./guides";
import { buildServer, type McpSession } from "./server";

const mcp = createMcpHandler(async (ctx) => {
  const server = buildServer(ctx.authInfo?.extra?.session as McpSession | undefined);
  (await skillCatalog()).attach(server);
  return server;
});

type ProviderContext = ExecutionContext & { props?: unknown; auth?: { clientId?: string; scope: string[] } };

function unauthorized(origin: string, description: string): Response {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer error="invalid_token", error_description="${description}", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
    },
  });
}

/** Runs after the OAuth provider validated the bearer token. Re-reads the agent so a revoke takes effect on the next call. */
export async function handleMcp(request: Request, env: Env, ctx: ProviderContext): Promise<Response> {
  const origin = publicOrigin(request, env);
  const host = new URL(origin).hostname;
  const rejected = originValidationResponse(request, [host, new URL(request.url).hostname, "localhost", "127.0.0.1"]);
  if (rejected) return rejected;
  const props = ctx.props as Partial<McpGrantProps> | undefined;
  if (!props?.agentId || !props.userId) return unauthorized(origin, "Unknown agent");
  const [agent, user] = await Promise.all([getAgent(env.DB, props.agentId), getUser(env.DB, props.userId)]);
  if (!agent || !user || agent.userId !== user.id) return unauthorized(origin, "Unknown agent");
  if (agent.status !== "active") return unauthorized(origin, "Access for this agent was revoked");
  ctx.waitUntil(touchAgent(env.DB, agent.id, request.headers.get("user-agent")));
  const plugin = request.headers.has("x-beep-me-plugin");
  const session: McpSession = { env, origin, waitUntil: (promise) => ctx.waitUntil(promise), user, agent, plugin };
  return mcp.fetch(request, {
    authInfo: { token: "", clientId: ctx.auth?.clientId ?? agent.id, scopes: ctx.auth?.scope ?? ["notify"], extra: { session } },
  });
}
