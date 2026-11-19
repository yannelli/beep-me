import type { ApiError } from "../../shared/api";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

const DEMO_KEY = "beepme-demo";

function demoActive(): boolean {
  if (!import.meta.env.DEV) return false;
  const param = new URLSearchParams(location.search).get("demo");
  if (param === "1") sessionStorage.setItem(DEMO_KEY, "1");
  if (param === "0") sessionStorage.removeItem(DEMO_KEY);
  return sessionStorage.getItem(DEMO_KEY) === "1";
}

export const isDemo = demoActive();

export const UNAUTHORIZED_EVENT = "beepme:unauthorized";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function parseError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as Partial<ApiError>;
    if (typeof parsed.error === "string") return { error: parsed.error, fields: parsed.fields, preview: parsed.preview };
  } catch {
    // Plain-text bodies fall through.
  }
  return { error: text.trim().slice(0, 200) || `Request failed (${response.status}).` };
}

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (import.meta.env.DEV && isDemo) {
    const { demoFetch } = await import("./demo");
    return demoFetch(method, path, body) as Promise<T>;
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, { error: "Beep Me is offline. Check your connection. Then try again." });
  }
  if (!response.ok) {
    const error = new ApiRequestError(response.status, await parseError(response));
    if (response.status === 401 && path !== "/api/session") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.body.error;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiRequestError ? (error.body.fields ?? {}) : {};
}
