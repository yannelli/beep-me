import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import { CHANNEL_KINDS, type ChannelKind } from "../../../shared/channels";
import { PRIORITIES } from "../../../shared/priority";
import { PRIORITY_INFO } from "../../../shared/priority";
import { PriorityChip } from "../../components/ui";
import { Link } from "../../lib/router";

const TOPIC_THREADS = new Set<ChannelKind>(["telegram", "discord"]);

const DEFAULT_ROUTE: Record<(typeof PRIORITIES)[number], string> = {
  urgent: "Text message and phone push",
  high: "Text message",
  medium: "Telegram main chat",
  low: "Telegram topic thread",
};

const CATEGORY_LABEL = { chat: "Chat", sms: "Text message", email: "Email", push: "Push", developer: "Developer" } as const;

const yes = <span className="text-ok">Yes</span>;
const no = <span className="text-muted">No</span>;

export function ChannelTable() {
  return (
    <table className="docs-stack">
      <thead>
        <tr>
          <th>Channel</th>
          <th>Type</th>
          <th>Topic threads</th>
          <th>Silent at night</th>
        </tr>
      </thead>
      <tbody>
        {CHANNEL_KINDS.map((kind) => {
          const info = CHANNEL_CATALOG[kind];
          return (
            <tr key={kind}>
              <td>
                <Link href={`/docs/channels/${kind}`}>{info.name}</Link>
              </td>
              <td data-label="Type">{CATEGORY_LABEL[info.category]}</td>
              <td data-label="Topic threads">{TOPIC_THREADS.has(kind) ? yes : no}</td>
              <td data-label="Silent at night">{info.supportsSilent ? yes : no}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ChannelFields({ kind }: { kind: ChannelKind }) {
  const info = CHANNEL_CATALOG[kind];
  if (!info) return null;
  return (
    <table className="docs-stack">
      <thead>
        <tr>
          <th>Field</th>
          <th>Required</th>
          <th>What to enter</th>
        </tr>
      </thead>
      <tbody>
        {info.fields.map((field) => {
          const condition = field.showWhen
            ? `Shown when ${info.fields.find((other) => other.key === field.showWhen?.key)?.label ?? field.showWhen.key} is ${
                info.fields.find((other) => other.key === field.showWhen?.key)?.options?.find((option) => option.value === field.showWhen?.equals)?.label ??
                String(field.showWhen.equals)
              }.`
            : null;
          const text = [field.help, condition].filter(Boolean).join(" ") || field.placeholder || "";
          return (
            <tr key={field.key}>
              <td className="font-medium sm:whitespace-nowrap">{field.label}</td>
              <td data-label="Required">{field.required ? "Yes" : "No"}</td>
              <td data-label="What to enter">{text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function PriorityTable() {
  return (
    <table className="docs-stack">
      <thead>
        <tr>
          <th>Priority</th>
          <th>Use it when</th>
          <th>Default route</th>
        </tr>
      </thead>
      <tbody>
        {[...PRIORITIES].reverse().map((priority) => (
          <tr key={priority}>
            <td>
              <PriorityChip priority={priority} />
            </td>
            <td data-label="Use it when">{PRIORITY_INFO[priority].guidance}</td>
            <td data-label="Default route">{DEFAULT_ROUTE[priority]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
