import type { QuietHours } from "../../shared/settings";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localClock(timezone: string, at: number): { minutes: number; day: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(at);
  } catch {
    return localClock("UTC", at);
  }
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { minutes: Number(value("hour")) * 60 + Number(value("minute")), day: Math.max(0, WEEKDAYS.indexOf(value("weekday"))) };
}

function toMinutes(clock: string): number {
  const [hours = "0", minutes = "0"] = clock.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function isQuietNow(quiet: QuietHours, timezone: string, at = Date.now()): boolean {
  if (!quiet.enabled) return false;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === end) return false;
  const { minutes, day } = localClock(timezone, at);
  const overnight = start > end;
  const inWindow = overnight ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!inWindow) return false;
  if (!quiet.days.length) return true;
  // The early-morning part of an overnight window belongs to the day it started.
  const windowDay = overnight && minutes < end ? (day + 6) % 7 : day;
  return quiet.days.includes(windowDay);
}

export function formatClock(at: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(at);
  } catch {
    return new Date(at).toISOString().slice(11, 16) + " UTC";
  }
}
