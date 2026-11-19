import type { ResendDnsRecord } from "../../shared/resend";

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

const SOA = 6;

/** Finds the zone that holds `domain` and whether Cloudflare serves it, from the SOA record over public DNS-over-HTTPS. */
export async function lookupZone(domain: string): Promise<{ zone: string | null; cloudflare: boolean }> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=SOA`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!response?.ok) return { zone: null, cloudflare: false };
  const json = (await response.json().catch(() => null)) as { Answer?: DohAnswer[]; Authority?: DohAnswer[] } | null;
  const soa = [...(json?.Answer ?? []), ...(json?.Authority ?? [])].find((answer) => answer.type === SOA);
  if (!soa) return { zone: null, cloudflare: false };
  const zone = soa.name.replace(/\.$/, "").toLowerCase();
  const primary = soa.data.split(/\s+/)[0]?.toLowerCase() ?? "";
  return { zone: zone || null, cloudflare: /\.ns\.cloudflare\.com\.?$/.test(primary) };
}

/** Resend can show a name relative to the domain ("send") or to the zone ("send.agents"). Both resolve to one host. */
export function fullName(name: string, domain: string, zone: string | null): string {
  const clean = name.replace(/\.$/, "").toLowerCase();
  if (!clean || clean === "@") return domain;
  if (clean === domain || clean.endsWith(`.${domain}`)) return clean;
  const apex = zone ?? domain.split(".").slice(-2).join(".");
  const sub = domain === apex ? "" : domain.slice(0, -(apex.length + 1));
  if (sub && (clean === sub || clean.endsWith(`.${sub}`))) return `${clean}.${apex}`;
  return `${clean}.${domain}`;
}

function zoneValue(record: ResendDnsRecord): string {
  if (record.type === "TXT") return (record.value.match(/.{1,255}/g) ?? [""]).map((chunk) => `"${chunk.replace(/"/g, '\\"')}"`).join(" ");
  const host = record.value.endsWith(".") ? record.value : `${record.value}.`;
  return ["MX", "CNAME", "NS"].includes(record.type) ? host : record.value;
}

export function zoneFile(records: ResendDnsRecord[]): string {
  return records
    .map((record) => {
      const ttl = /^\d+$/.test(record.ttl) ? record.ttl : "3600";
      const priority = record.type === "MX" && record.priority !== null ? `${record.priority} ` : "";
      return `${record.fqdn}.\t${ttl}\tIN\t${record.type}\t${priority}${zoneValue(record)}`;
    })
    .join("\n");
}
