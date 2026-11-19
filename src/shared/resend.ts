// Guided Resend setup: /api/integrations/resend/:channelId. Routes are in docs/api.md.

export interface ResendDomainSummary {
  id: string;
  name: string;
  /** Resend status: not_started, pending, verified, partially_verified, partially_failed, failed, temporary_failure. */
  status: string;
  region: string | null;
  sending: boolean;
  receiving: boolean;
}

export interface ResendDnsRecord {
  /** What the record is for, as Resend names it: SPF, DKIM, Receiving, and so on. */
  record: string;
  type: string;
  /** Name as Resend shows it. */
  name: string;
  /** Full host name, for example send.agents.example.com. */
  fqdn: string;
  value: string;
  ttl: string;
  priority: number | null;
  status: string;
}

export interface ResendDomainDetail extends ResendDomainSummary {
  records: ResendDnsRecord[];
  /** From a public DNS lookup. `cloudflare` is true when Cloudflare serves the zone. */
  dns: { zone: string | null; cloudflare: boolean };
  /** The records as BIND zone file lines, ready to paste or import. */
  zoneFile: string;
}

export interface ResendSetupState {
  /** The agent domain saved on the channel. */
  domain: string | null;
  /** Where Resend posts inbound email for this channel. null when this deployment has no https URL. */
  webhookUrl: string | null;
  webhook: { id: string; status: string; events: string[] } | null;
  secretSet: boolean;
  /** Set when the API key cannot read domains or webhooks. */
  keyError: string | null;
}

/** Every change needs `confirm: true`. Without it the API answers 409 with a preview of the change. */
export interface ResendConfirmBody {
  confirm?: boolean;
}

export interface ResendCreateDomainBody extends ResendConfirmBody {
  name: string;
  region?: string;
}

export interface ResendPreview {
  error: string;
  preview: { method: string; path: string; body?: unknown; summary: string };
}

export const RESEND_REGIONS = ["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"] as const;
