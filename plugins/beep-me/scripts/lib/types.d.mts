export type Host = "claude" | "codex" | "pi";

export interface Config {
  host: Host;
  /** Beep Me address without /mcp, for example https://beep-me.example. */
  origin: string | null;
  /** Agent token (beep_...). */
  token: string | null;
  /** Send permission prompts, questions, and plan reviews to the phone. */
  prompts: boolean;
  /** Seconds a prompt waits for an answer in the terminal before it goes to the phone. */
  askAfter: number;
  priority: string;
  /** Seconds this hook may wait, from --wait. Each hooks file sets it below the hook timeout. */
  wait: number;
  /** Writable folder for per-session state. */
  dataDir: string;
  version: string;
}

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: any;
  tool_response?: unknown;
  permission_suggestions?: unknown[];
  stop_hook_active?: boolean;
  source?: string;
}

export interface HookResult {
  /** JSON printed on stdout. */
  output?: Record<string, unknown>;
  /** Text for an asyncRewake hook: printed on stderr with exit code 2, which wakes the agent. */
  wake?: string;
}

export interface Question {
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/** An answer from GET /v1/replies (InteractionDTO in src/shared/api.ts). */
export interface Reply {
  id: string;
  messageId: string | null;
  channelName: string | null;
  kind: "reply" | "choice" | "reaction" | "vote";
  matchedBy: string | null;
  text: string | null;
  option: { index: number; label: string } | null;
  media: { kind: string; name: string; mime: string; url: string }[];
  sender: string | null;
}

export interface NotifyResult {
  id: string;
  status: string;
  watch_url: string | null;
}

/** A question the agent asked with notify, tracked so the Codex Stop hook can wait for it. */
export interface TrackedQuestion {
  messageId: string;
  /** The signed watch URL from notify. null when the result had none, and the hooks use the token instead. */
  watchUrl: string | null;
  title: string | null;
  at: number;
  /** The Stop hook already waited its full time for this one. Later stops only check it. */
  waited: boolean;
}

export type CheckResult = { state: "ready"; replies: Reply[] | null } | { state: "pending" | "gone" | "error" };

export type Decision =
  | { behavior: "allow"; updatedInput?: unknown; updatedPermissions?: unknown[] }
  | { behavior: "deny"; message: string };
