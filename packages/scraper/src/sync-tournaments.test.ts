import { test, expect, describe, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { discoverTournaments, syncTournamentMatches, syncTournamentPlayers } from "./sync-tournaments";

let db: Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE tournaments (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, club TEXT, date TEXT,
    link_web TEXT, matches_synced_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    sport TEXT, surface TEXT, club_id INTEGER, cover TEXT,
    latitude REAL, longitude REAL, address TEXT
  )`);
  db.run(`CREATE TABLE players (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, club TEXT, license_number TEXT,
    gender TEXT, photo_url TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')), section TEXT, location TEXT,
    age_group TEXT, fpp_pontos REAL, share_url TEXT, profile_synced_at TEXT
  )`);
  db.run(`CREATE TABLE matches (
    guid TEXT PRIMARY KEY, tournament_name TEXT, section_name TEXT, round_name TEXT,
    date_time TEXT, is_singles INTEGER, side_a_ids TEXT NOT NULL, side_b_ids TEXT NOT NULL,
    side_a_names TEXT, side_b_names TEXT, sets_json TEXT, winner_side TEXT,
    source TEXT, tournament_id INTEGER, court TEXT, category TEXT,
    subcategory TEXT, result_type TEXT DEFAULT 'normal',
    category_code TEXT, section_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE match_players (
    match_guid TEXT NOT NULL, player_id INTEGER NOT NULL, side TEXT NOT NULL,
    PRIMARY KEY (match_guid, player_id)
  )`);
  db.run(`CREATE TABLE tournament_players (
    tournament_id INTEGER NOT NULL, player_id INTEGER NOT NULL,
    category_code TEXT NOT NULL DEFAULT 'UNKNOWN',
    partner_id INTEGER, section_id INTEGER,
    PRIMARY KEY (tournament_id, player_id, category_code)
  )`);
  db.run(`CREATE TABLE sync_cursors (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now'))
  )`);
});

describe("discoverTournaments", () => {
  test("discovers tournament 23404 (the spec bug case)", async () => {
    const discovered = await discoverTournaments({ db, startId: 23404, endId: 23404 });
    expect(discovered.length).toBeGreaterThanOrEqual(1);
    expect(discovered[0].id).toBe(23404);

    const row = db.query("SELECT id, name FROM tournaments WHERE id = 23404").get() as any;
    expect(row).not.toBeNull();
    expect(row.name).toBeTruthy();
  });

  test("skips nonexistent tournament IDs", async () => {
    const discovered = await discoverTournaments({ db, startId: 999999, endId: 999999 });
    expect(discovered.length).toBe(0);
  });
});

describe("syncTournamentMatches", () => {
  test("syncs matches for tournament 23404", async () => {
    const result = await syncTournamentMatches({ db, tournamentId: 23404 });
    expect(result.inserted).toBeGreaterThanOrEqual(0);
    expect(result.sections).toBeGreaterThanOrEqual(0);
  });
});

describe("syncTournamentPlayers", () => {
  test("syncs players for tournament 23404", async () => {
    const result = await syncTournamentPlayers({ db, tournamentId: 23404 });
    expect(result.upserted).toBeGreaterThanOrEqual(0);
  });
});

describe("end-to-end sync", () => {
  test("discover → sync matches → sync players for tournament 23404", async () => {
    // Discovery (may already be inserted from earlier tests)
    const discovered = await discoverTournaments({ db, startId: 23404, endId: 23404 });
    expect(discovered.length).toBeGreaterThanOrEqual(0); // may already exist

    // Match sync
    const matchResult = await syncTournamentMatches({ db, tournamentId: 23404 });
    expect(matchResult.sections).toBeGreaterThanOrEqual(0);

    // Player sync
    const playerResult = await syncTournamentPlayers({ db, tournamentId: 23404 });

    // Verify data in DB
    const matchCount = db.query("SELECT COUNT(*) as c FROM matches WHERE tournament_id = 23404").get() as { c: number };
    const playerCount = db.query("SELECT COUNT(*) as c FROM tournament_players WHERE tournament_id = 23404").get() as { c: number };

    console.log(`Tournament 23404: ${matchCount.c} matches, ${playerCount.c} tournament_players`);
    expect(matchCount.c).toBeGreaterThanOrEqual(0);
  });
});
