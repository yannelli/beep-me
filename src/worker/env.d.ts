import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    OAUTH_PROVIDER: OAuthHelpers;
    /** Optional. Set when the Worker is served on a custom domain, for example https://beep-me.example.com */
    PUBLIC_URL?: string;
    /** Optional, for local testing. Sends Telnyx API calls to this origin instead of https://api.telnyx.com */
    TELNYX_API_URL?: string;
    /** Optional, for local testing. Sends Twilio API calls to this origin instead of https://api.twilio.com */
    TWILIO_API_URL?: string;
  }
}
