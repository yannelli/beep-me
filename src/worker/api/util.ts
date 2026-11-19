import type { Context } from "hono";
import type { z } from "zod";
import type { ApiError } from "../../shared/api";
import type { AppEnv } from "../auth/session";
import type { RunContext } from "../core/notify";

export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    const missing = issue.code === "invalid_type" && issue.message.endsWith("received undefined");
    fields[key] ??= missing ? "This field is required." : issue.message;
  }
  return fields;
}

export function badRequest(c: Context<AppEnv>, error: string, fields?: Record<string, string>) {
  return c.json<ApiError>(fields ? { error, fields } : { error }, 400);
}

export function notFound(c: Context<AppEnv>, what = "Not found") {
  return c.json<ApiError>({ error: what }, 404);
}

export function runContext(c: Context<AppEnv>): RunContext {
  return { env: c.env, origin: c.get("origin"), waitUntil: (promise) => c.executionCtx.waitUntil(promise) };
}

export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json<unknown>();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
