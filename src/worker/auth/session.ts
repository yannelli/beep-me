import type { Context } from "hono";
import { getUser, type User } from "../db/users";
import { hmacSign, hmacVerify } from "../lib/crypto";

const MAX_AGE_SECONDS = 30 * 86_400;

export function publicOrigin(request: Request, env: Env): string {
  const configured = env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith("https://");
}

export function isLocalHost(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function cookieName(origin: string, base: string): string {
  return isSecureOrigin(origin) ? `__Host-${base}` : base;
}

export function serializeCookie(origin: string, base: string, value: string, maxAge: number): string {
  const secure = isSecureOrigin(origin) ? "; Secure" : "";
  return `${cookieName(origin, base)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function readCookie(request: Request, origin: string, base: string): string | null {
  const name = cookieName(origin, base);
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function sessionCookie(env: Env, origin: string, user: User): Promise<string> {
  const payload = `${user.id}.${user.sessionVersion}.${Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS}`;
  const signature = await hmacSign(env.APP_SECRET, "session", payload);
  return serializeCookie(origin, "beepme_session", `${payload}.${signature}`, MAX_AGE_SECONDS);
}

export function clearSessionCookie(origin: string): string {
  return serializeCookie(origin, "beepme_session", "", 0);
}

export async function sessionUser(request: Request, env: Env): Promise<User | null> {
  const origin = publicOrigin(request, env);
  const raw = readCookie(request, origin, "beepme_session");
  if (!raw) return null;
  const [userId, version, expires, signature] = raw.split(".");
  if (!userId || !version || !expires || !signature) return null;
  if (Number(expires) * 1000 < Date.now()) return null;
  if (!(await hmacVerify(env.APP_SECRET, "session", `${userId}.${version}.${expires}`, signature))) return null;
  const user = await getUser(env.DB, userId);
  return user && String(user.sessionVersion) === version ? user : null;
}

export type AppEnv = { Bindings: Env; Variables: { user: User; origin: string } };

/** Rejects cross-site writes: SameSite=Lax covers most cases, and this check covers the rest. */
export function isSameOriginWrite(c: Context<AppEnv>): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return true;
  const origin = c.req.header("origin");
  return !origin || origin === new URL(c.req.url).origin || origin === c.get("origin");
}
