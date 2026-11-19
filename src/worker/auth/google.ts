import { Hono } from "hono";
import { listChannels, saveChannel } from "../db/channels";
import { upsertGoogleUser, type GoogleProfile, type User } from "../db/users";
import { base64url, fromBase64url, hmacSign, hmacVerify, randomId, randomString, sha256Base64url } from "../lib/crypto";
import {
  clearSessionCookie,
  isLocalHost,
  publicOrigin,
  readCookie,
  serializeCookie,
  sessionCookie,
  sessionUser,
  type AppEnv,
} from "./session";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

interface OAuthState {
  state: string;
  verifier: string;
  purpose: "login" | "gmail";
  next: string;
  timezone: string;
  channelId?: string;
  expires: number;
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(origin: string): string {
  return `${origin}/auth/google/callback`;
}

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

async function sealState(env: Env, state: OAuthState): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(state)));
  return `${body}.${await hmacSign(env.APP_SECRET, "oauth-state", body)}`;
}

async function openState(env: Env, sealed: string | null): Promise<OAuthState | null> {
  const [body, signature] = (sealed ?? "").split(".");
  if (!body || !signature || !(await hmacVerify(env.APP_SECRET, "oauth-state", body, signature))) return null;
  const state = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as OAuthState;
  return state.expires > Date.now() ? state : null;
}

/** ALLOWED_EMAILS: comma-separated list, or "*" for anyone. Empty lets only the first account sign up. */
async function emailAllowed(env: Env, email: string): Promise<boolean> {
  const list = (env.ALLOWED_EMAILS as string).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (list.includes("*") || list.includes(email.toLowerCase())) return true;
  if (list.length) return false;
  const existing = await env.DB.prepare("SELECT email FROM users LIMIT 2").all<{ email: string }>();
  return existing.results.length === 0 || existing.results.some((row) => row.email.toLowerCase() === email.toLowerCase());
}

function decodeIdToken(idToken: string, clientId: string): GoogleProfile & { emailVerified: boolean } {
  const payload = JSON.parse(new TextDecoder().decode(fromBase64url(idToken.split(".")[1] ?? ""))) as Record<string, unknown>;
  const issuerOk = payload.iss === "https://accounts.google.com" || payload.iss === "accounts.google.com";
  if (!issuerOk || payload.aud !== clientId || Number(payload.exp) * 1000 < Date.now()) throw new Error("Invalid Google ID token");
  return {
    sub: String(payload.sub),
    email: String(payload.email),
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
    emailVerified: payload.email_verified === true,
  };
}

function htmlError(message: string, status = 400): Response {
  const safe = message.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Beep Me</title><body style="font:16px system-ui;background:#0b0b10;color:#e8e8ef;display:grid;place-items:center;min-height:90vh;margin:0"><main style="max-width:420px;padding:24px"><h1 style="font-size:20px">Sign-in did not finish</h1><p>${safe}</p><p><a style="color:#a78bfa" href="/">Back to Beep Me</a></p></main>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/google/start", async (c) => {
  if (!googleConfigured(c.env)) return c.redirect("/");
  const origin = c.get("origin");
  const purpose = c.req.query("purpose") === "gmail" ? "gmail" : "login";
  const state: OAuthState = {
    state: randomString(24),
    verifier: randomString(64),
    purpose,
    next: safeNext(c.req.query("next")),
    timezone: c.req.query("tz") || "UTC",
    channelId: c.req.query("channel") || undefined,
    expires: Date.now() + 10 * 60_000,
  };
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope: purpose === "gmail" ? `openid email ${GMAIL_SCOPE}` : "openid email profile",
    state: state.state,
    code_challenge: await sha256Base64url(state.verifier),
    code_challenge_method: "S256",
    ...(purpose === "gmail" ? { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } : { prompt: "select_account" }),
  }).toString();
  c.header("set-cookie", serializeCookie(origin, "beepme_oauth", await sealState(c.env, state), 600));
  return c.redirect(url.toString());
});

authRoutes.get("/gmail/start", async (c) => {
  const channel = c.req.query("channel") ?? "new";
  return c.redirect(`/auth/google/start?purpose=gmail&channel=${encodeURIComponent(channel)}`);
});

authRoutes.get("/google/callback", async (c) => {
  const origin = c.get("origin");
  const state = await openState(c.env, readCookie(c.req.raw, origin, "beepme_oauth"));
  c.header("set-cookie", serializeCookie(origin, "beepme_oauth", "", 0));
  if (!state || state.state !== c.req.query("state")) return htmlError("This sign-in link expired. Start again from Beep Me.");
  if (c.req.query("error")) return c.redirect(state.purpose === "gmail" ? "/channels?gmail=denied" : "/?signin=denied");
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: c.req.query("code") ?? "",
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(origin),
      grant_type: "authorization_code",
      code_verifier: state.verifier,
    }),
  });
  const tokens = (await response.json()) as { id_token?: string; refresh_token?: string; scope?: string; error_description?: string };
  if (!response.ok || !tokens.id_token) return htmlError(tokens.error_description ?? "Google did not return an ID token.");
  const profile = decodeIdToken(tokens.id_token, c.env.GOOGLE_CLIENT_ID);
  if (!profile.emailVerified) return htmlError("Your Google email address is not verified.");

  if (state.purpose === "gmail") {
    const user = await sessionUser(c.req.raw, c.env);
    if (!user) return htmlError("Sign in to Beep Me first, then connect Gmail.", 401);
    if (!tokens.refresh_token || !tokens.scope?.includes(GMAIL_SCOPE)) return htmlError("Google did not grant permission to send email. Try again and allow sending.");
    const channelId = await storeGmail(c.env, user, state.channelId, profile.email, tokens.refresh_token);
    return c.redirect(`/channels/${channelId}?connected=1`);
  }

  if (!(await emailAllowed(c.env, profile.email))) return htmlError(`${profile.email} is not allowed to sign in to this Beep Me.`, 403);
  const user = await upsertGoogleUser(c.env.DB, profile, state.timezone);
  c.header("set-cookie", await sessionCookie(c.env, origin, user), { append: true });
  return c.redirect(state.next);
});

async function storeGmail(env: Env, user: User, channelId: string | undefined, email: string, refreshToken: string): Promise<string> {
  const channels = await listChannels(env, user.id);
  const existing = channels.find((channel) => channel.id === channelId && channel.kind === "gmail");
  const now = Date.now();
  const channel = existing ?? {
    id: randomId("chn"),
    userId: user.id,
    kind: "gmail" as const,
    name: "Gmail",
    enabled: true,
    status: "ready" as const,
    statusDetail: null,
    config: {},
    lastUsedAt: null,
    lastError: null,
    createdAt: now,
  };
  channel.config = { mode: "oauth", email, refreshToken, to: channel.config.to };
  channel.status = "ready";
  channel.statusDetail = null;
  await saveChannel(env, channel);
  return channel.id;
}

authRoutes.get("/dev", async (c) => {
  if (c.env.DEV_LOGIN !== "true" || !isLocalHost(c.req.raw)) return c.notFound();
  const user = await upsertGoogleUser(c.env.DB, { sub: "dev-local", email: "dev@localhost", name: "Developer", picture: null }, c.req.query("tz") || "UTC");
  c.header("set-cookie", await sessionCookie(c.env, publicOrigin(c.req.raw, c.env), user));
  return c.redirect(safeNext(c.req.query("next")));
});

authRoutes.post("/logout", (c) => {
  c.header("set-cookie", clearSessionCookie(c.get("origin")));
  return c.json({ ok: true });
});
