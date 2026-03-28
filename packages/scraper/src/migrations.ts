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
  {
    version: 3,
    name: "recreate-tournament-players-table",
    resync: true,
    run: (db) => {
      db.run("DROP TABLE IF EXISTS tournament_players");
      db.run(`
        CREATE TABLE tournament_players (
          tournament_id INTEGER NOT NULL,
          player_id INTEGER NOT NULL,
          category_code TEXT NOT NULL DEFAULT 'UNKNOWN',
          partner_id INTEGER,
          section_id INTEGER,
          UNIQUE(tournament_id, player_id, category_code),
          FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
          FOREIGN KEY (player_id) REFERENCES players(id),
          FOREIGN KEY (partner_id) REFERENCES players(id)
        )
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_tournament_players_tournament ON tournament_players(tournament_id, category_code)");
      db.run("CREATE INDEX IF NOT EXISTS idx_tournament_players_player ON tournament_players(player_id)");
      console.log("[migration:3] Recreated tournament_players table with correct schema");
    },
  },
  {
    version: 4,
    name: "normalize-tournament-dates",
    resync: false,
    run: (db) => {
      const result = db.run(`
        UPDATE tournaments SET date = substr(date, 1, 10) WHERE date LIKE '____-__-__, %'
      `);
      console.log(`[migration:4] Normalized ${result.changes} tournament dates (stripped time suffix)`);
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
