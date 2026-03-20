import { Database } from "bun:sqlite";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database("padel.db", { create: true });
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      club TEXT,
      section TEXT,
      location TEXT,
      age_group TEXT,
      photo_url TEXT,
      fpp_pontos REAL,
      share_url TEXT,
      license_number TEXT,
      gender TEXT,
      profile_synced_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      club TEXT,
      date TEXT,
      link_web TEXT,
      matches_synced_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS matches (
      guid TEXT PRIMARY KEY,
      tournament_name TEXT,
      section_name TEXT,
      round_name TEXT,
      date_time TEXT,
      is_singles INTEGER,
      side_a_ids TEXT NOT NULL,
      side_b_ids TEXT NOT NULL,
      side_a_names TEXT,
      side_b_names TEXT,
      sets_json TEXT,
      winner_side TEXT,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS match_players (
      match_guid TEXT NOT NULL,
      player_id INTEGER NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('a', 'b')),
      PRIMARY KEY (match_guid, player_id),
      FOREIGN KEY (match_guid) REFERENCES matches(guid),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ratings (
      player_id INTEGER NOT NULL,
      mu REAL NOT NULL,
      sigma REAL NOT NULL,
      ordinal REAL NOT NULL,
      matches_counted INTEGER DEFAULT 0,
      calculated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (player_id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_cursors (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date_time)");
  db.run("CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ratings_ordinal ON ratings(ordinal DESC)");
}

export function getCursor(key: string): string | null {
  const row = getDb().query("SELECT value FROM sync_cursors WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setCursor(key: string, value: string) {
  getDb().run(
    "INSERT INTO sync_cursors (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')",
    [key, value, value]
  );
}
