import { Database } from "bun:sqlite";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database(process.env.DB_PATH || "padel.db", { create: true });
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
  db.run("CREATE INDEX IF NOT EXISTS idx_matches_source ON matches(source)");
  db.run("CREATE INDEX IF NOT EXISTS idx_matches_tournament_name ON matches(tournament_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_match_players_guid ON match_players(match_guid)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ratings_ordinal ON ratings(ordinal DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_players_gender ON players(gender)");

  // New columns for schedule scraping
  const matchCols = db.query("PRAGMA table_info(matches)").all() as Array<{ name: string }>;
  const colNames = new Set(matchCols.map((c) => c.name));

  if (!colNames.has("tournament_id")) {
    db.run("ALTER TABLE matches ADD COLUMN tournament_id INTEGER REFERENCES tournaments(id)");
  }
  if (!colNames.has("court")) {
    db.run("ALTER TABLE matches ADD COLUMN court TEXT");
  }
  if (!colNames.has("category")) {
    db.run("ALTER TABLE matches ADD COLUMN category TEXT");
  }
  if (!colNames.has("subcategory")) {
    db.run("ALTER TABLE matches ADD COLUMN subcategory TEXT");
  }
  if (!colNames.has("result_type")) {
    db.run("ALTER TABLE matches ADD COLUMN result_type TEXT DEFAULT 'normal'");
  }

  db.run("CREATE INDEX IF NOT EXISTS idx_matches_tournament_id ON matches(tournament_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_matches_category ON matches(category)");

  // New columns for tournament metadata
  const tournamentCols = db.query("PRAGMA table_info(tournaments)").all() as Array<{ name: string }>;
  const tColNames = new Set(tournamentCols.map((c) => c.name));

  if (!tColNames.has("sport")) {
    db.run("ALTER TABLE tournaments ADD COLUMN sport TEXT");
  }
  if (!tColNames.has("surface")) {
    db.run("ALTER TABLE tournaments ADD COLUMN surface TEXT");
  }
  if (!tColNames.has("club_id")) {
    db.run("ALTER TABLE tournaments ADD COLUMN club_id INTEGER");
  }
  if (!tColNames.has("cover")) {
    db.run("ALTER TABLE tournaments ADD COLUMN cover TEXT");
  }
  if (!tColNames.has("latitude")) {
    db.run("ALTER TABLE tournaments ADD COLUMN latitude REAL");
  }
  if (!tColNames.has("longitude")) {
    db.run("ALTER TABLE tournaments ADD COLUMN longitude REAL");
  }
  if (!tColNames.has("address")) {
    db.run("ALTER TABLE tournaments ADD COLUMN address TEXT");
  }

  db.run("CREATE INDEX IF NOT EXISTS idx_tournaments_sport ON tournaments(sport)");

  db.run(`
    CREATE TABLE IF NOT EXISTS match_ratings (
      match_guid TEXT NOT NULL,
      player_id INTEGER NOT NULL,
      ordinal_before REAL NOT NULL,
      ordinal_delta REAL NOT NULL,
      PRIMARY KEY (match_guid, player_id),
      FOREIGN KEY (match_guid) REFERENCES matches(guid),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_match_ratings_player ON match_ratings(player_id)");
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
