import { Database } from "bun:sqlite";
import { parseCategoryCode } from "./parse-category";

interface Migration {
  version: number;
  name: string;
  resync: boolean; // if true, clears matches_synced_at to force full resync
  run: (db: Database) => void;
}

// Add new migrations at the end. Never change or remove existing ones.
const migrations: Migration[] = [
  {
    version: 1,
    name: "backfill-tournament-id-from-source",
    resync: false,
    run: (db) => {
      const result = db.run(`
        UPDATE matches
        SET tournament_id = CAST(REPLACE(source, 'scrape:tournament:', '') AS INTEGER)
        WHERE tournament_id IS NULL AND source LIKE 'scrape:tournament:%'
      `);
      console.log(`[migration:1] Backfilled tournament_id for ${result.changes} matches`);
    },
  },
  {
    version: 2,
    name: "reparse-category-codes-v2",
    resync: true,
    run: (db) => {
      const rows = db.query(
        "SELECT guid, category, section_name FROM matches WHERE category IS NOT NULL OR section_name IS NOT NULL"
      ).all() as Array<{ guid: string; category: string | null; section_name: string | null }>;

      const update = db.prepare("UPDATE matches SET category_code = ? WHERE guid = ?");
      const tx = db.transaction(() => {
        for (const row of rows) {
          const raw = row.category || row.section_name || "";
          const code = parseCategoryCode(raw);
          update.run(code, row.guid);
        }
      });
      tx();
      console.log(`[migration:2] Re-parsed category_code for ${rows.length} matches`);
    },
  },
];

export function runMigrations(db: Database): { ranCount: number; needsResync: boolean } {
  const currentVersion = getCurrentVersion(db);
  const pending = migrations.filter((m) => m.version > currentVersion);

  if (pending.length === 0) return { ranCount: 0, needsResync: false };

  console.log(`Running ${pending.length} pending migration(s)...`);

  let needsResync = false;

  for (const m of pending) {
    console.log(`[migration:${m.version}] ${m.name}${m.resync ? " (triggers resync)" : ""}`);
    m.run(db);
    setVersion(db, m.version);
    if (m.resync) needsResync = true;
  }

  if (needsResync) {
    const result = db.run("UPDATE tournaments SET matches_synced_at = NULL WHERE matches_synced_at IS NOT NULL");
    console.log(`Resync triggered: cleared matches_synced_at for ${result.changes} tournaments`);
  }

  return { ranCount: pending.length, needsResync };
}

function getCurrentVersion(db: Database): number {
  const row = db.query("SELECT value FROM sync_cursors WHERE key = 'migration_version'").get() as { value: string } | null;
  return row ? parseInt(row.value) : 0;
}

function setVersion(db: Database, version: number) {
  db.run(
    "INSERT INTO sync_cursors (key, value) VALUES ('migration_version', ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    [String(version), String(version)]
  );
}
