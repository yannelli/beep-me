/** @typedef {import("./types.mjs").Config} Config */
/** @typedef {import("./types.mjs").Reply} Reply */
/** @typedef {import("./types.mjs").NotifyResult} NotifyResult */

export class BeepMeError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** A signal that aborts on the caller's signal or after ms. @param {AbortSignal | undefined} signal @param {number} ms */
function deadlineSignal(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Timed out")), ms);
  timer.unref();
  if (signal?.aborted) controller.abort(signal.reason);
  signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller.signal;
}

/** @param {Response} response */
async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text.slice(0, 200) };
  }
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** REST client for one Beep Me deployment, with the agent token. @param {Config} config */
export function createApi(config) {
  if (!config.origin || !config.token) throw new Error("The Beep Me URL and token are not set.");
  const origin = config.origin;
  const headers = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
    "user-agent": `beep-me-plugin/${config.version} (${config.host})`,
  };

  /** @param {string} method @param {string} path @param {unknown} [body] @param {{ signal?: AbortSignal, timeoutMs?: number }} [options] */
  async function call(method, path, body, options = {}) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: deadlineSignal(options.signal, options.timeoutMs ?? 30_000),
    });
    const data = await readJson(response);
    if (!response.ok) throw new BeepMeError(`Beep Me returned HTTP ${response.status} for ${path}: ${data.error ?? "no detail"}`, response.status);
    return data;
  }

  return {
    /** @param {Record<string, unknown>} input @returns {Promise<NotifyResult>} */
    notify: (input) => call("POST", "/v1/notify", input),
    /** Marks the answers read. @param {string} messageId @param {number} waitSeconds @param {AbortSignal} [signal] @returns {Promise<Reply[]>} */
    replies: async (messageId, waitSeconds, signal) => {
      const query = `message_id=${encodeURIComponent(messageId)}&wait_seconds=${Math.round(waitSeconds)}`;
      const data = await call("GET", `/v1/replies?${query}`, undefined, { signal, timeoutMs: (waitSeconds + 30) * 1000 });
      return Array.isArray(data.replies) ? data.replies : [];
    },
    /** Older deployments do not have this route, so errors are ignored. @param {string} messageId */
    cancelFallbacks: (messageId) => call("POST", `/v1/messages/${encodeURIComponent(messageId)}/fallbacks/cancel`, {}).catch(() => null),
  };
}

/** @typedef {ReturnType<typeof createApi>} Api */

/**
 * Waits on a signed watch URL from notify. Needs no token, and returns no answer text.
 * @param {string} url @param {number} waitSeconds @param {AbortSignal} [signal] @returns {Promise<boolean>}
 */
export async function watchReady(url, waitSeconds, signal) {
  const response = await fetch(`${url}?wait_seconds=${Math.round(waitSeconds)}`, {
    headers: { accept: "application/json" },
    signal: deadlineSignal(signal, (waitSeconds + 30) * 1000),
  });
  const data = await readJson(response);
  if (!response.ok) throw new BeepMeError(`Beep Me returned HTTP ${response.status} for the watch URL: ${data.error ?? "no detail"}`, response.status);
  return data.ready === true;
}

/** HTTP statuses that will not change on a retry: bad token, revoked agent, deleted message. @param {unknown} error */
export function isFatal(error) {
  return error instanceof BeepMeError && [400, 401, 403, 404].includes(error.status);
}
