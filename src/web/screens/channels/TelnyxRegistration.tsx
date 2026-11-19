import { CircleAlert, CircleCheck, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { TelnyxAction, TelnyxRegistrationDTO } from "../../../shared/telnyx-setup";
import { SelectField } from "../../components/form";
import { Badge, Button, type Tone } from "../../components/ui";

const PORTAL = "https://portal.telnyx.com/";

export function statusTone(status: string | null): Tone {
  if (!status) return "neutral";
  if (/fail|reject|suspend|expire/i.test(status)) return "error";
  if (/^(assigned|ok|verified|vetted_verified|tcr_accepted|telnyx_accepted|mno_accepted|mno_provisioned|active)$/i.test(status)) return "ok";
  return "warn";
}

export function StatusBadge({ status }: { status: string | null }) {
  return <Badge tone={statusTone(status)}>{status ? status.replace(/_/g, " ") : "Unknown"}</Badge>;
}

export function SetupRow({ ok, title, children }: { ok: boolean; title: ReactNode; children?: ReactNode }) {
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <div className="flex gap-3">
      <Icon className={`mt-0.5 size-5 shrink-0 ${ok ? "text-ok" : "text-amber-500"}`} aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium break-words">{title}</p>
        {children}
      </div>
    </div>
  );
}

function PortalLink({ children }: { children: ReactNode }) {
  return (
    <a href={PORTAL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent">
      {children}
      <ExternalLink className="size-4" aria-hidden />
    </a>
  );
}

/** 10DLC brand, campaign, and assignment, or toll-free verification, for the channel's number. */
export function TelnyxRegistration({ registration, busy, onAction }: { registration: TelnyxRegistrationDTO; busy: boolean; onAction: (action: TelnyxAction) => void }) {
  const [campaignId, setCampaignId] = useState("");

  if (registration.kind === "none") return <SetupRow ok title="This number does not need US registration." />;

  if (registration.kind === "tollfree") {
    const verified = registration.status === "Verified";
    return (
      <SetupRow ok={verified} title={<>Toll-free verification: <StatusBadge status={registration.status ?? "Not submitted"} /></>}>
        {registration.reason && <p className="text-sm text-muted">{registration.reason}</p>}
        {!verified && <PortalLink>Submit verification in the Telnyx portal</PortalLink>}
      </SetupRow>
    );
  }

  const { campaign, brand, campaigns, assignmentStatus } = registration;
  if (campaign) {
    return (
      <SetupRow ok={assignmentStatus === "ASSIGNED"} title={<>10DLC campaign: <StatusBadge status={assignmentStatus} /></>}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Brand</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-words">{brand?.name ?? campaign.brandId ?? "Unknown"}</span>
            {brand && <StatusBadge status={brand.identityStatus ?? brand.status} />}
          </dd>
          <dt className="text-muted">Campaign</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-words">{campaign.name}</span>
            <StatusBadge status={campaign.status} />
          </dd>
        </dl>
        {registration.failureReasons && <p className="text-sm text-danger">{registration.failureReasons}</p>}
      </SetupRow>
    );
  }

  return (
    <SetupRow ok={false} title="This number has no 10DLC campaign. US carriers block its texts until it has one.">
      {campaigns.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <SelectField label="Campaign" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
              <option value="">Select a campaign</option>
              {campaigns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.status ?? "unknown"})
                </option>
              ))}
            </SelectField>
          </div>
          <Button disabled={!campaignId} busy={busy} onClick={() => onAction({ action: "assign_campaign", campaignId })}>
            Assign number
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Create a brand and a campaign in the Telnyx portal. Telnyx asks for business details and charges fees for both.</p>
      )}
      <PortalLink>Open the Telnyx portal</PortalLink>
    </SetupRow>
  );
}
