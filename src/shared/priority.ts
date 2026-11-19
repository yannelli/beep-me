export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export function priorityRank(priority: Priority): number {
  return PRIORITIES.indexOf(priority);
}

export function minPriority(a: Priority, b: Priority): Priority {
  return priorityRank(a) <= priorityRank(b) ? a : b;
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

export interface PriorityInfo {
  label: string;
  emoji: string;
  /** One line for agents and for the routing screen. */
  guidance: string;
}

export const PRIORITY_INFO: Record<Priority, PriorityInfo> = {
  urgent: {
    label: "Urgent",
    emoji: "🔴",
    guidance: "The message needs action now. For example, production is down, data is at risk, or a run waits for a person.",
  },
  high: {
    label: "High",
    emoji: "🟠",
    guidance: "The message is important and time sensitive. For example, a long task failed or needs your decision soon.",
  },
  medium: {
    label: "Medium",
    emoji: "🔵",
    guidance: "The message is worth reading today. For example, a task finished, a deploy went out, or a summary is ready.",
  },
  low: {
    label: "Low",
    emoji: "⚪",
    guidance: "The message is background information. Read it when you have time.",
  },
};
