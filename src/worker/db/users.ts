import type { UserDTO } from "../../shared/api";
import { defaultSettings, userSettingsSchema, type UserSettings } from "../../shared/settings";
import { randomId } from "../lib/crypto";

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  google_sub: string | null;
  settings: string;
  session_version: number;
  created_at: number;
  updated_at: number;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  sessionVersion: number;
  settings: UserSettings;
}

export function parseSettings(raw: string): UserSettings {
  const base = defaultSettings();
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return base;
  }
  const merged = userSettingsSchema.safeParse({ ...base, ...stored });
  return merged.success ? merged.data : base;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    sessionVersion: row.session_version,
    settings: parseSettings(row.settings),
  };
}

export function toUserDTO(user: User): UserDTO {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ? toUser(row) : null;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export async function upsertGoogleUser(db: D1Database, profile: GoogleProfile, timezone: string): Promise<User> {
  const now = Date.now();
  const existing = await db
    .prepare("SELECT * FROM users WHERE google_sub = ? OR email = ? ORDER BY google_sub IS NULL LIMIT 1")
    .bind(profile.sub, profile.email)
    .first<UserRow>();
  if (existing) {
    await db
      .prepare("UPDATE users SET google_sub = ?, email = ?, name = ?, avatar_url = ?, updated_at = ? WHERE id = ?")
      .bind(profile.sub, profile.email, profile.name, profile.picture, now, existing.id)
      .run();
    return toUser({ ...existing, google_sub: profile.sub, email: profile.email, name: profile.name, avatar_url: profile.picture });
  }
  const row: UserRow = {
    id: randomId("usr"),
    email: profile.email,
    name: profile.name,
    avatar_url: profile.picture,
    google_sub: profile.sub,
    settings: JSON.stringify(defaultSettings(timezone)),
    session_version: 1,
    created_at: now,
    updated_at: now,
  };
  await db
    .prepare(
      "INSERT INTO users (id, email, name, avatar_url, google_sub, settings, session_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.id, row.email, row.name, row.avatar_url, row.google_sub, row.settings, row.session_version, now, now)
    .run();
  return toUser(row);
}

export async function saveSettings(db: D1Database, userId: string, settings: UserSettings): Promise<void> {
  await db
    .prepare("UPDATE users SET settings = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(settings), Date.now(), userId)
    .run();
}

export async function bumpSessionVersion(db: D1Database, userId: string): Promise<void> {
  await db.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").bind(userId).run();
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM deliveries WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM link_codes WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
}
