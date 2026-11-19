import { errorText, isRecord } from "./http";
import { base64, planAttachments, renderEmail } from "./render-email";
import { RESEND_ATTACHMENT_BUDGET, agentAddress, displayName, emailDomain, resendRequest, threadHeaders } from "./resend-api";
import { parseAddress } from "./smtp";
import type { ChannelAdapter } from "./types";

export const resend: ChannelAdapter<"resend"> = {
  kind: "resend",

  async send(ctx, message) {
    const { apiKey, apiBase, to, domain, subjectPrefix, webhookSecret } = ctx.config;
    const agentFrom = domain && message.agent.id ? await agentAddress({ id: message.agent.id, name: message.agent.name }, domain) : null;
    const from = agentFrom
      ? displayName(message.senderName ?? message.agent.name, agentFrom)
      : (ctx.config.from ?? displayName(message.senderName ?? "Beep Me", `beep@${domain}`));
    const replyTo = agentFrom ?? parseAddress(from).email;
    const { files, links } = await planAttachments(message.attachments, RESEND_ATTACHMENT_BUDGET, (file) => file.url.startsWith("https://"));
    const { subject, text, html } = renderEmail(message, { subjectPrefix, replies: Boolean(webhookSecret), links });
    const response = await resendRequest({ apiKey, apiBase }, "/emails", {
      method: "POST",
      headers: { "idempotency-key": `${message.id}:${ctx.channel.id}` },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: replyTo,
        subject,
        html,
        text,
        headers: threadHeaders(message.id, emailDomain(replyTo) ?? "beep-me.local"),
        attachments: files.length
          ? files.map(({ attachment, bytes }) =>
              bytes
                ? { filename: attachment.name, content: base64(bytes), content_type: attachment.mime }
                : { filename: attachment.name, path: attachment.url, content_type: attachment.mime },
            )
          : undefined,
      }),
      timeoutMs: files.length ? 30_000 : undefined,
    });
    if (!response.ok) return { ok: false, detail: `Resend ${response.status}: ${errorText(response)}` };
    const id = isRecord(response.json) && typeof response.json.id === "string" ? response.json.id : undefined;
    const linked = links.length ? ` ${links.length} file${links.length === 1 ? "" : "s"} sent as links.` : "";
    return { ok: true, providerId: id, detail: `Sent from ${parseAddress(from).email}.${linked}` };
  },

  /** `ref` is "<email id>/<attachment id>". Download URLs last one hour, so each request gets a new one. */
  async fetchMedia(ctx, ref) {
    const [emailId, attachmentId] = ref.split("/");
    const meta = await resendRequest(ctx.config, `/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`);
    const url = isRecord(meta.json) && typeof meta.json.download_url === "string" ? meta.json.download_url : null;
    if (!meta.ok || !url) return new Response(null, { status: meta.status || 502 });
    return fetch(url, { signal: AbortSignal.timeout(30_000) });
  },
};
