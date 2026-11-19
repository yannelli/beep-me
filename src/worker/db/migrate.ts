import schemaSql from "../../../migrations/0001_init.sql?raw";

const SCHEMA_VERSION = "1";
let ready: Promise<void> | null = null;

/** Applies migrations/0001_init.sql once per isolate, so a fresh deploy needs no migration step. */
export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= migrate(db).catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

async function migrate(db: D1Database): Promise<void> {
  const current = await db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .first<{ value: string }>()
    .catch(() => null);
  if (current?.value === SCHEMA_VERSION) return;
  const statements = schemaSql
    .replace(/^\s*--.*$/gm, "")
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  await db.batch([
    ...statements.map((statement) => db.prepare(statement)),
    db
      .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(SCHEMA_VERSION),
  ]);
}
