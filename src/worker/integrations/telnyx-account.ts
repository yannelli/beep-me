import type {
  TelnyxBrandDTO,
  TelnyxCampaignDTO,
  TelnyxNumberDTO,
  TelnyxProfileDTO,
  TelnyxRegistrationDTO,
} from "../../shared/telnyx-setup";
import { clip, http, isRecord, type HttpInit } from "../channels/http";
import { telnyxApi, telnyxError } from "../channels/telnyx";

export class TelnyxApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Calls the Telnyx v2 API and returns the JSON body. Throws TelnyxApiError with the Telnyx error text. */
export async function telnyxCall(env: Env, apiKey: string, path: string, init: HttpInit = {}): Promise<unknown> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
  if (init.body) headers["content-type"] = "application/json";
  const response = await http(`${telnyxApi(env)}${path}`, { ...init, headers });
  if (!response.ok) throw new TelnyxApiError(telnyxError(response), response.status);
  return response.json;
}

function list(json: unknown, key: "data" | "records"): Record<string, unknown>[] {
  const items = isRecord(json) ? json[key] : null;
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

function one(json: unknown): Record<string, unknown> {
  return isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function toNumber(item: Record<string, unknown>): TelnyxNumberDTO {
  const type = text(item.type);
  return {
    id: text(item.id) ?? "",
    phoneNumber: text(item.phone_number) ?? "",
    type,
    tollFree: /toll-?free/.test(type ?? ""),
    messagingProfileId: text(item.messaging_profile_id),
  };
}

export function toProfile(item: Record<string, unknown>): TelnyxProfileDTO {
  return {
    id: text(item.id) ?? "",
    name: text(item.name) ?? "Messaging profile",
    enabled: item.enabled !== false,
    webhookUrl: text(item.webhook_url),
  };
}

/** Numbers with their messaging settings. `phone` filters to one E.164 number. */
export async function listNumbers(env: Env, apiKey: string, phone?: string): Promise<TelnyxNumberDTO[]> {
  const filter = phone ? `&filter[phone_number]=${encodeURIComponent(phone)}` : "";
  const json = await telnyxCall(env, apiKey, `/phone_numbers/messaging?page[size]=250${filter}`);
  return list(json, "data").map(toNumber).filter((number) => number.id && number.phoneNumber);
}

export async function listProfiles(env: Env, apiKey: string): Promise<TelnyxProfileDTO[]> {
  const json = await telnyxCall(env, apiKey, "/messaging_profiles?page[size]=250");
  return list(json, "data").map(toProfile).filter((profile) => profile.id);
}

function toCampaign(item: Record<string, unknown>): TelnyxCampaignDTO {
  const id = text(item.campaignId) ?? text(item.id) ?? "";
  const name = [text(item.usecase), text(item.description)].filter(Boolean).join(": ");
  return { id, brandId: text(item.brandId), name: clip(name || id, 80), status: text(item.campaignStatus) ?? text(item.status) };
}

function toBrand(item: Record<string, unknown>): TelnyxBrandDTO {
  const id = text(item.brandId) ?? text(item.id) ?? "";
  return { id, name: text(item.displayName) ?? text(item.companyName) ?? id, status: text(item.status), identityStatus: text(item.identityStatus) };
}

async function orNull<T>(promise: Promise<T>, problems: string[]): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof TelnyxApiError && error.status === 404) return null;
    problems.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** 10DLC brand, campaign, and assignment for a US long code, or toll-free verification for a toll-free number. */
export async function readRegistration(env: Env, apiKey: string, number: TelnyxNumberDTO, problems: string[]): Promise<TelnyxRegistrationDTO> {
  const phone = encodeURIComponent(number.phoneNumber);
  if (number.tollFree) {
    const json = await orNull(telnyxCall(env, apiKey, `/messaging_tollfree/verification/requests?phone_number=${phone}&page=1&page_size=1`), problems);
    const request = list(json, "records")[0];
    return { kind: "tollfree", status: text(request?.verificationStatus), reason: text(request?.reason) };
  }
  if (!/^\+1\d{10}$/.test(number.phoneNumber) || /short-?code/.test(number.type ?? "")) return { kind: "none" };
  const assignment = one(await orNull(telnyxCall(env, apiKey, `/10dlc/phone_number_campaigns/${phone}`), problems));
  const campaignId = text(assignment.campaignId);
  const brandId = text(assignment.brandId);
  const campaign = campaignId ? await orNull(telnyxCall(env, apiKey, `/10dlc/campaign/${encodeURIComponent(campaignId)}`), problems) : null;
  const brand = brandId ? await orNull(telnyxCall(env, apiKey, `/10dlc/brand/${encodeURIComponent(brandId)}`), problems) : null;
  return {
    kind: "10dlc",
    assignmentStatus: campaignId ? text(assignment.assignmentStatus) : null,
    failureReasons: text(assignment.failureReasons),
    campaign: campaign ? toCampaign(one(campaign)) : null,
    brand: brand ? toBrand(one(brand)) : null,
    campaigns: campaignId ? [] : await listCampaigns(env, apiKey, problems),
  };
}

const MAX_BRANDS = 5;

async function listCampaigns(env: Env, apiKey: string, problems: string[]): Promise<TelnyxCampaignDTO[]> {
  const brands = list(await orNull(telnyxCall(env, apiKey, "/10dlc/brand?page=1&recordsPerPage=50"), problems), "records").map(toBrand);
  const campaigns: TelnyxCampaignDTO[] = [];
  for (const brand of brands.slice(0, MAX_BRANDS)) {
    const json = await orNull(telnyxCall(env, apiKey, `/10dlc/campaign?brandId=${encodeURIComponent(brand.id)}&page=1&recordsPerPage=100`), problems);
    campaigns.push(...list(json, "records").map(toCampaign).filter((campaign) => campaign.id));
  }
  return campaigns;
}
