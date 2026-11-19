import { Hono, type Context } from "hono";
import type { TelnyxAccountDTO, TelnyxActionBody, TelnyxPlanDTO, TelnyxSetupDTO } from "../../shared/telnyx-setup";
import { badRequest, notFound, readJson } from "../api/util";
import type { AppEnv } from "../auth/session";
import { isRecord } from "../channels/http";
import { telnyxInboundUrl } from "../channels/telnyx";
import { getChannel, saveChannelConfig, type StoredChannel } from "../db/channels";
import { randomString } from "../lib/crypto";
import { listNumbers, listProfiles, readRegistration, telnyxCall, TelnyxApiError, toProfile } from "./telnyx-account";

/** Dashboard API for guided Telnyx setup (numbers, messaging profiles, webhooks, 10DLC). Mounted at /api/integrations/telnyx. */
export const telnyxIntegration = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;

function failed(c: Ctx, error: unknown) {
  if (error instanceof TelnyxApiError) return badRequest(c, error.message);
  throw error;
}

async function telnyxChannel(c: Ctx): Promise<StoredChannel | null> {
  const channel = await getChannel(c.env, c.get("user").id, c.req.param("id") ?? "");
  if (!channel || channel.kind !== "telnyx") return null;
  if (typeof channel.config.webhookToken !== "string" || !channel.config.webhookToken) {
    channel.config = { ...channel.config, webhookToken: randomString(32) };
    await saveChannelConfig(c.env, channel.id, channel.config);
  }
  return channel;
}

function apiKey(channel: StoredChannel): string {
  return String(channel.config.apiKey ?? "");
}

function inboundUrl(c: Ctx, channel: StoredChannel): string {
  return telnyxInboundUrl(c.get("origin"), channel.id, String(channel.config.webhookToken));
}

/** Lists numbers and messaging profiles for a pasted API key, or for the key of a saved channel. */
telnyxIntegration.post("/account", async (c) => {
  const body = await readJson(c);
  let key = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!key && typeof body.channelId === "string") {
    const channel = await getChannel(c.env, c.get("user").id, body.channelId);
    if (channel?.kind === "telnyx") key = apiKey(channel);
  }
  if (key.length < 16) return badRequest(c, "Paste the full API key.", { apiKey: "Paste the full API key." });
  try {
    const [numbers, profiles] = await Promise.all([listNumbers(c.env, key), listProfiles(c.env, key)]);
    return c.json<TelnyxAccountDTO>({ numbers, profiles });
  } catch (error) {
    return failed(c, error);
  }
});

async function setupState(c: Ctx, channel: StoredChannel): Promise<TelnyxSetupDTO> {
  const key = apiKey(channel);
  const problems: string[] = [];
  const [numbers, profiles] = await Promise.all([listNumbers(c.env, key, String(channel.config.from)), listProfiles(c.env, key)]);
  const number = numbers.find((item) => item.phoneNumber === channel.config.from) ?? null;
  if (!number) problems.push(`${String(channel.config.from)} is not a messaging number in this Telnyx account.`);
  const profile = profiles.find((item) => item.id === number?.messagingProfileId) ?? null;
  return {
    inboundUrl: inboundUrl(c, channel),
    inboundReachable: c.get("origin").startsWith("https://"),
    publicKeySet: typeof channel.config.publicKey === "string" && channel.config.publicKey.length > 0,
    number,
    profile,
    profiles,
    registration: number ? await readRegistration(c.env, key, number, problems) : { kind: "none" },
    problems,
  };
}

telnyxIntegration.get("/channels/:id", async (c) => {
  const channel = await telnyxChannel(c);
  if (!channel) return notFound(c, "Telnyx channel not found");
  try {
    return c.json(await setupState(c, channel));
  } catch (error) {
    return failed(c, error);
  }
});

function parseAction(body: Record<string, unknown>): TelnyxActionBody | null {
  const confirm = body.confirm === true;
  const id = (key: string) => (typeof body[key] === "string" && body[key] ? String(body[key]) : null);
  if (body.action === "set_webhook") return { action: "set_webhook", confirm };
  if (body.action === "assign_profile" && id("profileId")) return { action: "assign_profile", profileId: id("profileId")!, confirm };
  if (body.action === "assign_campaign" && id("campaignId")) return { action: "assign_campaign", campaignId: id("campaignId")!, confirm };
  if (body.action === "create_profile") return { action: "create_profile", name: (id("name") ?? "Beep Me").trim().slice(0, 60), confirm };
  return null;
}

function destinations(channel: StoredChannel): string[] {
  return String(channel.config.to).startsWith("+1") ? ["US", "CA"] : ["*"];
}

/** What an action will change in the Telnyx account, in plain steps. */
function plan(action: TelnyxActionBody, state: TelnyxSetupDTO, channel: StoredChannel): TelnyxPlanDTO {
  const from = String(channel.config.from);
  const profileName = (id: string) => state.profiles.find((item) => item.id === id)?.name ?? id;
  if (action.action === "create_profile") {
    return {
      title: "Create a messaging profile?",
      steps: [
        `Create the messaging profile "${action.name}" with texts allowed to ${destinations(channel).join(", ").replace("*", "all countries")}.`,
        `Send inbound texts of the profile to ${state.inboundUrl}.`,
        `Move ${from} to the new profile.`,
      ],
    };
  }
  if (action.action === "assign_profile") {
    const current = state.profile ? ` It leaves "${state.profile.name}".` : "";
    return { title: "Change the messaging profile?", steps: [`Move ${from} to the messaging profile "${profileName(action.profileId)}".${current}`] };
  }
  if (action.action === "set_webhook") {
    const name = state.profile?.name ?? "the messaging profile";
    const current = state.profile?.webhookUrl ? `It replaces ${state.profile.webhookUrl}. Every number in "${name}" sends inbound texts to Beep Me after this.` : "";
    return { title: "Send replies to Beep Me?", steps: [`Set the inbound webhook URL of "${name}" to ${state.inboundUrl}.`, current].filter(Boolean) };
  }
  const campaign = state.registration.kind === "10dlc" ? state.registration.campaigns.find((item) => item.id === action.campaignId) : undefined;
  return {
    title: "Assign the number to a campaign?",
    steps: [`Assign ${from} to the 10DLC campaign ${campaign?.name ?? action.campaignId}.`, "Telnyx sends the assignment to the carriers. This can take a few days."],
  };
}

async function readAction(c: Ctx): Promise<{ channel: StoredChannel; action: TelnyxActionBody; state: TelnyxSetupDTO } | Response> {
  const channel = await telnyxChannel(c);
  if (!channel) return notFound(c, "Telnyx channel not found");
  const action = parseAction(await readJson(c));
  if (!action) return badRequest(c, "Pick an action.");
  const state = await setupState(c, channel);
  if (!state.number) return badRequest(c, `${String(channel.config.from)} is not a messaging number in this Telnyx account.`);
  if (action.action === "set_webhook" && !state.profile) return badRequest(c, "Assign the number to a messaging profile first.");
  if (action.action === "assign_profile" && !state.profiles.some((item) => item.id === action.profileId)) return badRequest(c, "Pick a messaging profile.");
  const campaigns = state.registration.kind === "10dlc" ? state.registration.campaigns : [];
  if (action.action === "assign_campaign" && !campaigns.some((item) => item.id === action.campaignId)) return badRequest(c, "Pick a campaign.");
  return { channel, action, state };
}

/** Returns the steps an action will take. Nothing changes in Telnyx. */
telnyxIntegration.post("/channels/:id/plan", async (c) => {
  try {
    const read = await readAction(c);
    if (read instanceof Response) return read;
    return c.json(plan(read.action, read.state, read.channel));
  } catch (error) {
    return failed(c, error);
  }
});

/** Runs an action after the user confirmed its plan. Refuses without confirm: true. */
telnyxIntegration.post("/channels/:id/actions", async (c) => {
  try {
    const read = await readAction(c);
    if (read instanceof Response) return read;
    const { channel, action, state } = read;
    if (!action.confirm) return c.json({ error: "Confirm this change first.", plan: plan(action, state, channel) }, 409);
    await runAction(c, channel, action, state);
    return c.json(await setupState(c, channel));
  } catch (error) {
    return failed(c, error);
  }
});

async function runAction(c: Ctx, channel: StoredChannel, action: TelnyxActionBody, state: TelnyxSetupDTO): Promise<void> {
  const key = apiKey(channel);
  const assignProfile = (profileId: string) =>
    telnyxCall(c.env, key, `/phone_numbers/${encodeURIComponent(state.number!.id)}/messaging`, {
      method: "PATCH",
      body: JSON.stringify({ messaging_profile_id: profileId }),
    });
  if (action.action === "assign_profile") await assignProfile(action.profileId);
  if (action.action === "set_webhook") {
    await telnyxCall(c.env, key, `/messaging_profiles/${encodeURIComponent(state.profile!.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ webhook_url: state.inboundUrl, webhook_api_version: "2" }),
    });
  }
  if (action.action === "create_profile") {
    const created = await telnyxCall(c.env, key, "/messaging_profiles", {
      method: "POST",
      body: JSON.stringify({ name: action.name, whitelisted_destinations: destinations(channel), webhook_url: state.inboundUrl, webhook_api_version: "2" }),
    });
    const profile = toProfile(isRecord(created) && isRecord(created.data) ? created.data : {});
    if (profile.id) await assignProfile(profile.id);
  }
  if (action.action === "assign_campaign") {
    await telnyxCall(c.env, key, "/10dlc/phone_number_campaigns", {
      method: "POST",
      body: JSON.stringify({ phoneNumber: String(channel.config.from), campaignId: action.campaignId }),
    });
  }
}
