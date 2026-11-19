import { RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { RESEND_REGIONS, type ResendDnsRecord, type ResendDomainDetail, type ResendDomainSummary } from "../../../shared/resend";
import { CopyField, SelectField, TextField } from "../../components/form";
import { Badge, Button, ErrorBox, Skeleton, type Tone } from "../../components/ui";
import { errorMessage, fieldErrors } from "../../lib/api";
import { useQuery } from "../../lib/query";
import type { RunAction } from "./ResendSetup";

interface Props {
  base: string;
  busyPath: string | null;
  run: RunAction;
}

function statusTone(status: string): Tone {
  if (status === "verified") return "ok";
  if (status === "failed" || status === "partially_failed") return "error";
  return "warn";
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll("_", " ");
  return <Badge tone={statusTone(status)}>{label.charAt(0).toUpperCase() + label.slice(1)}</Badge>;
}

function RecordRow({ record }: { record: ResendDnsRecord }) {
  return (
    <li className="space-y-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{record.record || "Record"}</span>
        <span className="text-muted">
          {record.type}
          {record.priority !== null && `, priority ${record.priority}`}
        </span>
        <span className="ml-auto">
          <StatusBadge status={record.status} />
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:items-center sm:gap-2">
        <span className="text-xs text-muted">Name</span>
        <CopyField value={record.fqdn} label={`${record.record} name`} multiline />
        <span className="text-xs text-muted">Value</span>
        <CopyField value={record.value} label={`${record.record} value`} multiline />
      </div>
    </li>
  );
}

function DomainDetail({ detail, base, busyPath, run }: Props & { detail: ResendDomainDetail }) {
  const verifyPath = `${base}/domains/${detail.id}/verify`;
  const receivingPath = `${base}/domains/${detail.id}/receiving`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 font-medium break-all">{detail.name}</p>
        <StatusBadge status={detail.status} />
      </div>
      <p className="text-sm text-muted">
        Sending {detail.sending ? "on" : "off"}. Receiving {detail.receiving ? "on" : "off"}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          small
          busy={busyPath === verifyPath}
          disabled={busyPath !== null}
          onClick={() => run({ title: "Check DNS again?", confirmLabel: "Check DNS", path: verifyPath, success: "Resend checks the DNS records again." })}
        >
          {busyPath !== verifyPath && <RefreshCw className="size-4" aria-hidden />}
          Check DNS again
        </Button>
        {!detail.receiving && (
          <Button
            small
            busy={busyPath === receivingPath}
            disabled={busyPath !== null}
            onClick={() => run({ title: "Turn on receiving?", confirmLabel: "Turn on receiving", path: receivingPath, success: "Receiving is on. Add the new MX record." })}
          >
            Turn on receiving
          </Button>
        )}
      </div>
      {detail.records.length > 0 && (
        <>
          <p className="text-sm">Add these records at your DNS host.</p>
          <ul className="space-y-2">
            {detail.records.map((record, index) => (
              <RecordRow key={`${record.type}-${record.fqdn}-${index}`} record={record} />
            ))}
          </ul>
        </>
      )}
      {detail.zoneFile &&
        (detail.dns.cloudflare ? (
          <div className="space-y-2">
            <p className="text-sm">This domain uses Cloudflare DNS. Paste these records in the Cloudflare dashboard, or import them as a zone file.</p>
            <CopyField value={detail.zoneFile} label="zone file" multiline />
          </div>
        ) : (
          <details className="rounded-xl border border-line px-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Zone file</summary>
            <p className="pb-2 text-sm text-muted">Use this if your DNS host imports zone files.</p>
            <div className="pb-3">
              <CopyField value={detail.zoneFile} label="zone file" multiline />
            </div>
          </details>
        ))}
    </div>
  );
}

function AddDomainForm({ base, busyPath, run }: Props) {
  const path = `${base}/domains`;
  const [name, setName] = useState("");
  const [region, setRegion] = useState<string>(RESEND_REGIONS[0]);
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    run({
      title: `Add ${name.trim()}?`,
      confirmLabel: "Add domain",
      path,
      body: { name: name.trim(), region },
      success: "Domain added. Select Use to send from it.",
      onError: (caught) => setError(fieldErrors(caught).name ?? errorMessage(caught)),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line p-3">
      <p className="text-sm font-medium">Add a domain</p>
      <TextField
        label="Domain"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="agents.example.com"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        help="Use a subdomain if the domain already gets email."
        error={error}
        required
      />
      <SelectField label="Region" value={region} onChange={(event) => setRegion(event.target.value)}>
        {RESEND_REGIONS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </SelectField>
      <Button type="submit" small variant="primary" busy={busyPath === path} disabled={busyPath !== null || !name.trim()}>
        Add domain
      </Button>
    </form>
  );
}

function DomainPicker({ domains, base, busyPath, run }: Props & { domains: ResendDomainSummary[] }) {
  return (
    <div className="space-y-3">
      {domains.length === 0 ? (
        <p className="text-sm text-muted">Resend has no domains yet. Add one below.</p>
      ) : (
        <ul className="space-y-2">
          {domains.map((domain) => {
            const path = `${base}/domains/${domain.id}/use`;
            return (
              <li key={domain.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-all">{domain.name}</p>
                  <p className="text-sm text-muted">Receiving {domain.receiving ? "on" : "off"}</p>
                </div>
                <StatusBadge status={domain.status} />
                <Button
                  small
                  busy={busyPath === path}
                  disabled={busyPath !== null}
                  onClick={() => run({ title: `Use ${domain.name}?`, confirmLabel: "Use domain", path, success: `This channel now sends from ${domain.name}.` })}
                >
                  Use
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <AddDomainForm base={base} busyPath={busyPath} run={run} />
    </div>
  );
}

export function ResendDomain({ domain, ...props }: Props & { domain: string | null }) {
  const list = useQuery<{ items: ResendDomainSummary[] }>(`${props.base}/domains`);
  const saved = domain ? list.data?.items.find((item) => item.name === domain) : undefined;
  const detail = useQuery<ResendDomainDetail>(saved ? `${props.base}/domains/${saved.id}` : null);

  let body;
  if (!list.data) {
    body = list.error ? <ErrorBox error={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : <Skeleton className="h-24" />;
  } else if (!saved) {
    body = (
      <>
        {domain && <p className="text-sm text-muted">Resend has no domain named {domain}. Add it, or use another domain.</p>}
        <DomainPicker domains={list.data.items} {...props} />
      </>
    );
  } else if (detail.data) {
    body = <DomainDetail detail={detail.data} {...props} />;
  } else {
    body = detail.error ? <ErrorBox error={errorMessage(detail.error)} onRetry={() => void detail.refetch()} /> : <Skeleton className="h-40" />;
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Domain</h3>
      {body}
    </div>
  );
}
