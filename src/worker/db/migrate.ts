import initSql from "../../../migrations/0001_init.sql?raw";
import interactionsSql from "../../../migrations/0002_interactions.sql?raw";

/** Each file runs once, in order, when the stored schema version is lower than its number. */
const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: initSql },
  { version: 2, sql: interactionsSql },
];

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= migrate(db).catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

function statements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, "")
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function migrate(db: D1Database): Promise<void> {
  const row = await db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .first<{ value: string }>()
    .catch(() => null);
  const current = Number(row?.value ?? 0);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.batch([
      ...statements(migration.sql).map((statement) => db.prepare(statement)),
      db
        .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(String(migration.version)),
    ]);
  }
}
