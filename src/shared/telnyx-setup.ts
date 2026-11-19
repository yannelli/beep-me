/** Guided Telnyx setup. Routes are under /api/integrations/telnyx; see docs/api.md. */

export interface TelnyxNumberDTO {
  id: string;
  phoneNumber: string;
  /** Telnyx number type, for example "long-code" or "toll-free". */
  type: string | null;
  tollFree: boolean;
  messagingProfileId: string | null;
}

export interface TelnyxProfileDTO {
  id: string;
  name: string;
  enabled: boolean;
  webhookUrl: string | null;
}

export interface TelnyxAccountDTO {
  numbers: TelnyxNumberDTO[];
  profiles: TelnyxProfileDTO[];
}

export interface TelnyxCampaignDTO {
  id: string;
  brandId: string | null;
  name: string;
  /** campaignStatus, for example MNO_PROVISIONED. */
  status: string | null;
}

export interface TelnyxBrandDTO {
  id: string;
  name: string;
  status: string | null;
  identityStatus: string | null;
}

export type TelnyxRegistrationDTO =
  | {
      kind: "10dlc";
      /** assignmentStatus of the number, for example ASSIGNED. null when the number has no campaign. */
      assignmentStatus: string | null;
      failureReasons: string | null;
      campaign: TelnyxCampaignDTO | null;
      brand: TelnyxBrandDTO | null;
      /** Campaigns the number can be assigned to, listed when it has none. */
      campaigns: TelnyxCampaignDTO[];
    }
  | { kind: "tollfree"; status: string | null; reason: string | null }
  | { kind: "none" };

export interface TelnyxSetupDTO {
  /** The URL that the messaging profile must send inbound texts to. */
  inboundUrl: string;
  /** False on http origins: Telnyx cannot reach them. */
  inboundReachable: boolean;
  publicKeySet: boolean;
  number: TelnyxNumberDTO | null;
  profile: TelnyxProfileDTO | null;
  profiles: TelnyxProfileDTO[];
  registration: TelnyxRegistrationDTO;
  /** Lookups that failed, as Telnyx error text. */
  problems: string[];
}

export type TelnyxAction =
  | { action: "assign_profile"; profileId: string }
  | { action: "create_profile"; name: string }
  | { action: "set_webhook" }
  | { action: "assign_campaign"; campaignId: string };

/** POST /actions refuses to run without confirm: true. POST /plan returns these steps first. */
export type TelnyxActionBody = TelnyxAction & { confirm?: boolean };

export interface TelnyxPlanDTO {
  title: string;
  steps: string[];
}
