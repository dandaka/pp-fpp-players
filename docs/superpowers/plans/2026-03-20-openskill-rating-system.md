# OpenSkill Rating System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download all players and matches from the TieSports API into a local SQLite database, then calculate OpenSkill ratings for each player based on match results.

**Architecture:** Three-layer system: (1) API client module that wraps TieSports REST endpoints, (2) SQLite database with players/tournaments/matches tables plus a sync cursor for incremental updates, (3) rating calculation engine using openskill that processes matches chronologically. Data flows: API → sync scripts → SQLite → rating calculator.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `openskill`, TieSports REST API (token: hardcoded for now)

---

## File Structure

```
src/
  api.ts              — TieSports API client (fetch wrappers for all endpoints)
  db.ts               — SQLite database setup, schema, migrations
  sync-players.ts     — Sync players from existing players.json + API profiles
  sync-matches.ts     — Download match history per player, discover new players
  calculate-ratings.ts — OpenSkill rating calculation from match history
  types.ts            — Shared TypeScript types for API responses and DB rows
```

## API Endpoints Available

All endpoints use base URL `https://api.tiesports.com` with token `e7c75ca5-d749-47a2-a1d3-ae947f8eda81` and User-Agent `TiePlayer/339 CFNetwork/3860.400.51 Darwin/25.3.0`.

| Endpoint | Purpose | Pagination |
|----------|---------|------------|
| `player.asmx/get_profile?player_id={id}` | Player profile details | None |
| `matches.asmx/get_matches_v1?player_id={id}&type=0&sport_id=2&year={y}&count_matches=0` | All matches for a player in a year | `count_matches` is offset |
| `tournaments.asmx/get_tournaments_v2?find_by_name=&count_tournaments=0` | List tournaments | `count_tournaments` is offset, returns 10/page |
| `tournaments.asmx/get_tournament?tournament_id={id}` | Tournament details | None |
| `tournaments.asmx/get_homepage_matches?tournament_id={id}&count_items={offset}&flag=ultimos` | Tournament matches | `count_items` is offset, 10/page, `load_more_latest` indicates more |
| `matches.asmx/get_match_v1?match_id={guid}&Set_Match_id=0` | Single match detail | None |

## Data Collection Strategy

1. **Seed players** from existing `players.json` (526 players with FPP tournament IDs)
2. **Enrich profiles** via `get_profile` API (get photo, location details, license info)
3. **Collect matches per player** via `get_matches_v1` for years 2024-2026 — this is the most reliable way to get all matches since tournament match listing only shows recent/final rounds
4. **Deduplicate matches** by match GUID (same match appears for both players/teams)
5. **Discover new players** from match opponents not in our seed list → fetch their profiles too

---

### Task 1: Types and API Client

**Files:**
- Create: `src/types.ts`
- Create: `src/api.ts`

- [ ] **Step 1: Create types file**

```ts
// src/types.ts
export const API_BASE = "https://api.tiesports.com";
export const API_TOKEN = "e7c75ca5-d749-47a2-a1d3-ae947f8eda81";
export const USER_AGENT = "TiePlayer/339 CFNetwork/3860.400.51 Darwin/25.3.0";

export interface ApiPlayerProfile {
  status: number;
  status_msg: string;
  player_name: string;
  player_photo: string;
  player_location: string;
  count_matches: number;
  list: Array<{ title: string; text: string; text2: string }>;
  share_url: string;
}

export interface ApiMatchPlayer {
  id: number;
  name: string;
  photo: string;
}

export interface ApiMatchSet {
  set_a: number;
  set_b: number;
  tie_a: number;
  tie_b: number;
}

export interface ApiMatch {
  id: string;
  side_a: ApiMatchPlayer[];
  side_b: ApiMatchPlayer[];
  total_a: string;
  total_b: string;
  sets: ApiMatchSet[];
  winner_a: boolean;
  winner_b: boolean;
  have_live_scores: boolean;
  infos: {
    title_left: string;
    title_right: string;
    date_time: { date: string; time: string; str: string };
    top_left: string;
    top_right: string;
    player_a_info: string;
    player_b_info: string;
  };
}

export interface ApiTournament {
  id: number;
  title: string;
  date: string;
  club: string;
  distance: string;
  cover: string;
  cover_ratio: number;
  today: boolean;
}

export interface ApiTournamentDetail {
  id: number;
  name: string;
  club: { id: number; name: string };
  header_texts: string[];
  link_web: string;
}
```

- [ ] **Step 2: Create API client**

```ts
// src/api.ts
import { API_BASE, API_TOKEN, USER_AGENT } from "./types";
import type { ApiPlayerProfile, ApiMatch, ApiTournament, ApiTournamentDetail } from "./types";

const headers = {
  Accept: "application/json",
  "User-Agent": USER_AGENT,
};

async function get(path: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_BASE}${path}${sep}token=${API_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json();
}

export async function getPlayerProfile(playerId: number): Promise<ApiPlayerProfile> {
  return get(`/player.asmx/get_profile?player_id=${playerId}`) as Promise<ApiPlayerProfile>;
}

export async function getPlayerMatches(playerId: number, year: number): Promise<ApiMatch[]> {
  const allMatches: ApiMatch[] = [];
  let offset = 0;
  const pageSize = 50;

  while (true) {
    const data = (await get(
      `/matches.asmx/get_matches_v1?player_id=${playerId}&type=0&sport_id=2&year=${year}&count_matches=${offset}`
    )) as { list: ApiMatch[] };
    const page = data.list ?? [];
    if (page.length === 0) break;
    allMatches.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }

  return allMatches;
}

export async function getTournaments(offset = 0): Promise<ApiTournament[]> {
  const data = (await get(
    `/tournaments.asmx/get_tournaments_v2?find_by_name=&count_tournaments=${offset}`
  )) as { list: ApiTournament[] };
  return data.list ?? [];
}

export async function getTournament(tournamentId: number): Promise<ApiTournamentDetail> {
  const data = (await get(
    `/tournaments.asmx/get_tournament?tournament_id=${tournamentId}`
  )) as { obj: ApiTournamentDetail };
  return data.obj;
}

export async function getTournamentMatches(
  tournamentId: number,
  offset = 0
): Promise<{ matches: ApiMatch[]; hasMore: boolean }> {
  const data = (await get(
    `/tournaments.asmx/get_homepage_matches?tournament_id=${tournamentId}&count_items=${offset}&flag=ultimos`
  )) as { lists: ApiMatch[]; load_more_latest: boolean };
  return { matches: data.lists ?? [], hasMore: data.load_more_latest ?? false };
}

export async function getMatchDetail(matchGuid: string): Promise<unknown> {
  return get(`/matches.asmx/get_match_v1?match_id=${matchGuid}&Set_Match_id=0`);
}
```

- [ ] **Step 3: Write a quick smoke test**

```ts
// src/api.test.ts
import { test, expect } from "bun:test";
import { getPlayerProfile, getPlayerMatches } from "./api";

test("getPlayerProfile returns valid data", async () => {
  const profile = await getPlayerProfile(432061);
  expect(profile.status).toBe(1);
  expect(profile.player_name).toBeTruthy();
});

test("getPlayerMatches returns array", async () => {
  const matches = await getPlayerMatches(432061, 2026);
  expect(Array.isArray(matches)).toBe(true);
});
```

- [ ] **Step 4: Run tests**

Run: `bun test src/api.test.ts`
Expected: PASS (2 tests, hitting live API)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/api.ts src/api.test.ts
git commit -m "feat: add TieSports API client with typed endpoints"
```

---

### Task 2: SQLite Database Schema

**Files:**
- Create: `src/db.ts`

- [ ] **Step 1: Create database module**

```ts
// src/db.ts
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
```

- [ ] **Step 2: Verify DB creates correctly**

Run: `bun -e "import { getDb } from './src/db'; const db = getDb(); const tables = db.query(\"SELECT name FROM sqlite_master WHERE type='table'\").all(); console.log(tables);"`
Expected: Lists all 6 tables

- [ ] **Step 4: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: add SQLite schema for players, matches, tournaments, ratings"
```

---

### Task 3: Seed Players from Existing Data

**Files:**
- Create: `src/sync-players.ts`

- [ ] **Step 1: Create player sync script**

This loads the existing `players.json` into SQLite and optionally enriches via API.

```ts
// src/sync-players.ts
import { getDb, getCursor, setCursor } from "./db";
import { getPlayerProfile } from "./api";

interface SeedPlayer {
  id: number;
  name: string;
  club: string;
  section: string;
  location: string;
  age: string;
  pontos: number | null;
}

export async function seedPlayersFromJson() {
  const db = getDb();
  const players: SeedPlayer[] = await Bun.file("players.json").json();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO players (id, name, club, section, location, age_group, fpp_pontos)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const p of players) {
      insert.run(p.id, p.name, p.club, p.section, p.location, p.age, p.pontos);
    }
  });
  tx();

  console.log(`Seeded ${players.length} players from players.json`);
}

export async function enrichPlayerProfiles(batchSize = 10, delayMs = 500) {
  const db = getDb();
  const unsynced = db.query(
    "SELECT id, name FROM players WHERE profile_synced_at IS NULL ORDER BY id LIMIT ?"
  ).all(batchSize) as { id: number; name: string }[];

  if (unsynced.length === 0) {
    console.log("All player profiles already synced");
    return;
  }

  const update = db.prepare(`
    UPDATE players SET photo_url = ?, share_url = ?, license_number = ?, gender = ?,
    profile_synced_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const p of unsynced) {
    try {
      const profile = await getPlayerProfile(p.id);
      if (profile.status !== 1) {
        console.log(`  Skip ${p.name}: API status ${profile.status}`);
        continue;
      }

      const gender = profile.list?.find((l) => l.title === "Gender")?.text ?? null;
      const license = profile.list?.find((l) => l.title?.includes("License"))?.text ?? null;

      update.run(profile.player_photo, profile.share_url, license, gender, p.id);
      console.log(`  Enriched: ${p.name}`);

      if (delayMs > 0) await Bun.sleep(delayMs);
    } catch (err) {
      console.error(`  Error enriching ${p.name}:`, err);
    }
  }

  console.log(`Enriched ${unsynced.length} player profiles`);
}

// CLI entry point
if (import.meta.main) {
  const cmd = process.argv[2] ?? "seed";
  if (cmd === "seed") {
    await seedPlayersFromJson();
  } else if (cmd === "enrich") {
    const batch = parseInt(process.argv[3] ?? "50");
    await enrichPlayerProfiles(batch);
  } else {
    console.log("Usage: bun src/sync-players.ts [seed|enrich] [batchSize]");
  }
}
```

- [ ] **Step 2: Run seed**

Run: `bun src/sync-players.ts seed`
Expected: "Seeded 526 players from players.json"

- [ ] **Step 3: Run enrich for a small batch**

Run: `bun src/sync-players.ts enrich 5`
Expected: Enriches 5 player profiles

- [ ] **Step 4: Commit**

```bash
git add src/sync-players.ts
git commit -m "feat: seed players from JSON and enrich via API profiles"
```

---

### Task 4: Sync Matches Per Player

**Files:**
- Create: `src/sync-matches.ts`

- [ ] **Step 1: Create match sync script**

Strategy: iterate each player, fetch their matches for years 2024-2026, deduplicate by match GUID, discover new players from opponents.

```ts
// src/sync-matches.ts
import { getDb, getCursor, setCursor } from "./db";
import { getPlayerMatches } from "./api";
import type { ApiMatch } from "./types";

function parseMatchInfo(m: ApiMatch) {
  const sideAIds = m.side_a.map((p) => p.id);
  const sideBIds = m.side_b.map((p) => p.id);
  const sideANames = m.side_a.map((p) => p.name).join(" / ");
  const sideBNames = m.side_b.map((p) => p.name).join(" / ");
  const isSingles = m.side_a.length === 1 && m.side_b.length === 1;
  const winner = m.winner_a ? "a" : m.winner_b ? "b" : null;

  let tournamentName = "";
  let sectionName = "";
  let roundName = "";
  if (m.infos) {
    tournamentName = m.infos.top_left ?? "";
    const topRight = m.infos.top_right ?? "";
    const parts = topRight.split("\r\n");
    if (parts.length >= 2) {
      roundName = parts[0];
      sectionName = parts[1];
    } else if (parts.length === 1) {
      sectionName = parts[0];
    }
  }

  const dateTime = m.infos?.date_time?.str ?? "";

  return {
    guid: m.id,
    tournamentName,
    sectionName,
    roundName,
    dateTime,
    isSingles,
    sideAIds: JSON.stringify(sideAIds),
    sideBIds: JSON.stringify(sideBIds),
    sideANames,
    sideBNames,
    setsJson: JSON.stringify(m.sets),
    winner,
  };
}

export async function syncPlayerMatches(
  years = [2024, 2025, 2026],
  delayMs = 300,
  resumeFromId?: number
) {
  const db = getDb();

  const cursorKey = "sync_matches_last_player_id";
  const lastId = resumeFromId ?? parseInt(getCursor(cursorKey) ?? "0");

  const players = db.query(
    "SELECT id, name FROM players WHERE id > ? ORDER BY id"
  ).all(lastId) as { id: number; name: string }[];

  console.log(`Syncing matches for ${players.length} players (starting after id=${lastId})`);

  const insertMatch = db.prepare(`
    INSERT OR IGNORE INTO matches (guid, tournament_name, section_name, round_name, date_time,
      is_singles, side_a_ids, side_b_ids, side_a_names, side_b_names, sets_json, winner_side, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMatchPlayer = db.prepare(`
    INSERT OR IGNORE INTO match_players (match_guid, player_id, side)
    VALUES (?, ?, ?)
  `);

  const insertNewPlayer = db.prepare(`
    INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)
  `);

  let totalMatches = 0;

  for (const player of players) {
    let playerMatchCount = 0;

    for (const year of years) {
      try {
        const matches = await getPlayerMatches(player.id, year);

        const tx = db.transaction(() => {
          for (const m of matches) {
            const info = parseMatchInfo(m);
            insertMatch.run(
              info.guid, info.tournamentName, info.sectionName, info.roundName,
              info.dateTime, info.isSingles ? 1 : 0,
              info.sideAIds, info.sideBIds, info.sideANames, info.sideBNames,
              info.setsJson, info.winner, `player:${player.id}`
            );

            for (const p of m.side_a) {
              insertMatchPlayer.run(info.guid, p.id, "a");
              insertNewPlayer.run(p.id, p.name);
            }
            for (const p of m.side_b) {
              insertMatchPlayer.run(info.guid, p.id, "b");
              insertNewPlayer.run(p.id, p.name);
            }

            playerMatchCount++;
          }
        });
        tx();

        if (delayMs > 0) await Bun.sleep(delayMs);
      } catch (err) {
        console.error(`  Error fetching matches for ${player.name} (${year}):`, err);
      }
    }

    totalMatches += playerMatchCount;
    if (playerMatchCount > 0) {
      console.log(`  ${player.name}: ${playerMatchCount} matches`);
    }

    setCursor(cursorKey, String(player.id));
  }

  const discoveredPlayers = db.query(
    "SELECT COUNT(*) as cnt FROM players WHERE profile_synced_at IS NULL AND club IS NULL"
  ).get() as { cnt: number };

  console.log(`\nSync complete: ${totalMatches} matches, ${discoveredPlayers.cnt} new players discovered`);
}

if (import.meta.main) {
  const resumeFrom = process.argv[2] ? parseInt(process.argv[2]) : undefined;
  await syncPlayerMatches([2024, 2025, 2026], 300, resumeFrom);
}
```

- [ ] **Step 2: Test with a single player**

Run: `bun -e "import { getDb } from './src/db'; import { getPlayerMatches } from './src/api'; const m = await getPlayerMatches(432061, 2026); console.log('Matches:', m.length); if(m[0]) console.log('First:', JSON.stringify(m[0], null, 2).slice(0, 500));"`
Expected: Shows match count and structure

- [ ] **Step 3: Run full sync (this will take a while ~526 players x 3 years)**

Run: `bun src/sync-matches.ts`
Expected: Progressively syncs all matches, shows progress

- [ ] **Step 4: Commit**

```bash
git add src/sync-matches.ts
git commit -m "feat: sync match history per player from TieSports API"
```

---

### Task 5: Calculate OpenSkill Ratings

**Files:**
- Create: `src/calculate-ratings.ts`

- [ ] **Step 1: Install openskill**

Run: `bun add openskill`

- [ ] **Step 2: Create rating calculator**

```ts
// src/calculate-ratings.ts
import { getDb } from "./db";
import { rating, rate, ordinal } from "openskill";

interface MatchRow {
  guid: string;
  side_a_ids: string;
  side_b_ids: string;
  winner_side: string | null;
  date_time: string;
  is_singles: number;
}

export function calculateRatings() {
  const db = getDb();

  const matches = db.query(`
    SELECT guid, side_a_ids, side_b_ids, winner_side, date_time, is_singles
    FROM matches
    WHERE winner_side IS NOT NULL
    ORDER BY date_time ASC
  `).all() as MatchRow[];

  console.log(`Processing ${matches.length} matches with results...`);

  const playerRatings = new Map<number, ReturnType<typeof rating>>();
  const playerMatchCounts = new Map<number, number>();

  function getRating(playerId: number) {
    if (!playerRatings.has(playerId)) {
      playerRatings.set(playerId, rating());
    }
    return playerRatings.get(playerId)!;
  }

  for (const m of matches) {
    const sideAIds: number[] = JSON.parse(m.side_a_ids);
    const sideBIds: number[] = JSON.parse(m.side_b_ids);

    const teamA = sideAIds.map((id) => getRating(id));
    const teamB = sideBIds.map((id) => getRating(id));

    const ranks = m.winner_side === "a" ? [1, 2] : [2, 1];

    try {
      const [newA, newB] = rate([teamA, teamB], { rank: ranks });

      for (let i = 0; i < sideAIds.length; i++) {
        playerRatings.set(sideAIds[i], newA[i]);
        playerMatchCounts.set(sideAIds[i], (playerMatchCounts.get(sideAIds[i]) ?? 0) + 1);
      }
      for (let i = 0; i < sideBIds.length; i++) {
        playerRatings.set(sideBIds[i], newB[i]);
        playerMatchCounts.set(sideBIds[i], (playerMatchCounts.get(sideBIds[i]) ?? 0) + 1);
      }
    } catch (err) {
      console.error(`Error rating match ${m.guid}:`, err);
    }
  }

  console.log(`Calculated ratings for ${playerRatings.size} players`);

  const upsert = db.prepare(`
    INSERT INTO ratings (player_id, mu, sigma, ordinal, matches_counted, calculated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(player_id) DO UPDATE SET
      mu = ?, sigma = ?, ordinal = ?, matches_counted = ?, calculated_at = datetime('now')
  `);

  const tx = db.transaction(() => {
    for (const [playerId, r] of playerRatings) {
      const ord = ordinal(r);
      const cnt = playerMatchCounts.get(playerId) ?? 0;
      upsert.run(playerId, r.mu, r.sigma, ord, cnt, r.mu, r.sigma, ord, cnt);
    }
  });
  tx();

  console.log("Ratings saved to database");
}

export function printLeaderboard(limit = 30) {
  const db = getDb();
  const rows = db.query(`
    SELECT r.player_id, p.name, p.section, p.club, r.mu, r.sigma, r.ordinal, r.matches_counted
    FROM ratings r
    JOIN players p ON p.id = r.player_id
    WHERE r.matches_counted >= 3
    ORDER BY r.ordinal DESC
    LIMIT ?
  `).all(limit) as Array<{
    player_id: number; name: string; section: string; club: string;
    mu: number; sigma: number; ordinal: number; matches_counted: number;
  }>;

  console.log("\n=== OpenSkill Leaderboard ===\n");
  console.log("Rank | Player                          | Section     | Ordinal |   μ   |   σ   | Matches");
  console.log("-----|--------------------------------|-------------|---------|-------|-------|--------");

  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)} | ${r.name.padEnd(30)} | ${(r.section ?? "").padEnd(11)} | ${r.ordinal.toFixed(2).padStart(7)} | ${r.mu.toFixed(2).padStart(5)} | ${r.sigma.toFixed(2).padStart(5)} | ${String(r.matches_counted).padStart(7)}`
    );
  });
}

if (import.meta.main) {
  calculateRatings();
  printLeaderboard();
}
```

- [ ] **Step 3: Run rating calculation**

Run: `bun src/calculate-ratings.ts`
Expected: Processes all matches, prints leaderboard

- [ ] **Step 4: Commit**

```bash
git add src/calculate-ratings.ts
git commit -m "feat: calculate OpenSkill ratings from match history"
```

---

### Task 6: Main CLI Entry Point

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Create unified CLI**

```ts
// src/cli.ts
import { seedPlayersFromJson, enrichPlayerProfiles } from "./sync-players";
import { syncPlayerMatches } from "./sync-matches";
import { calculateRatings, printLeaderboard } from "./calculate-ratings";
import { getDb } from "./db";

const cmd = process.argv[2];

switch (cmd) {
  case "seed":
    await seedPlayersFromJson();
    break;

  case "enrich":
    await enrichPlayerProfiles(parseInt(process.argv[3] ?? "50"));
    break;

  case "sync":
    await syncPlayerMatches();
    break;

  case "rate":
    calculateRatings();
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;

  case "leaderboard":
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;

  case "stats": {
    const db = getDb();
    const players = db.query("SELECT COUNT(*) as cnt FROM players").get() as { cnt: number };
    const matches = db.query("SELECT COUNT(*) as cnt FROM matches").get() as { cnt: number };
    const rated = db.query("SELECT COUNT(*) as cnt FROM ratings").get() as { cnt: number };
    const withResults = db.query("SELECT COUNT(*) as cnt FROM matches WHERE winner_side IS NOT NULL").get() as { cnt: number };
    console.log(`Players: ${players.cnt}`);
    console.log(`Matches: ${matches.cnt} (${withResults.cnt} with results)`);
    console.log(`Rated players: ${rated.cnt}`);
    break;
  }

  case "full":
    console.log("=== Full sync pipeline ===");
    await seedPlayersFromJson();
    await syncPlayerMatches();
    calculateRatings();
    printLeaderboard();
    break;

  default:
    console.log(`Usage: bun src/cli.ts <command>

Commands:
  seed          Seed players from players.json
  enrich [n]    Enrich n player profiles from API (default: 50)
  sync          Sync all player matches from API
  rate [n]      Calculate ratings and show top n (default: 30)
  leaderboard [n]  Show top n rated players
  stats         Show database statistics
  full          Run full pipeline: seed → sync → rate`);
}
```

- [ ] **Step 2: Test CLI**

Run: `bun src/cli.ts stats`
Expected: Shows player/match/rating counts

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add unified CLI for sync pipeline"
```

---

## Execution Order

1. **Task 1** — Types + API client (foundation)
2. **Task 2** — Database schema (storage layer)
3. **Task 3** — Seed players (populate initial data)
4. **Task 4** — Sync matches (the big data download, ~30 min)
5. **Task 5** — Calculate ratings (the goal)
6. **Task 6** — CLI entry point (convenience)

## Notes

- The match sync (Task 4) will take ~30 minutes for 526 players x 3 years with 300ms delay between requests. It's resumable via cursor.
- New players discovered from match opponents get auto-inserted with just `id` and `name`. Run `enrich` afterward to fill in their profiles.
- `count_matches=0` in the API means "return all" (offset=0), not "return zero".
- Match GUIDs are uppercase UUIDs. Deduplication via `INSERT OR IGNORE`.
- The `infos.top_left` field contains tournament name, `infos.top_right` contains round + section info (separated by `\r\n`).
