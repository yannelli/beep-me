import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    OAUTH_PROVIDER: OAuthHelpers;
    /** Optional. Set when the Worker is served on a custom domain, for example https://beep-me.example.com */
    PUBLIC_URL?: string;
  }
}
