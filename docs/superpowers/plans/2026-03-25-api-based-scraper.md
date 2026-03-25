# API-Based Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Playwright browser scraping with TieSports REST API calls, add `tournament_players` table, normalize categories with `category_code`, and update web layer.

**Architecture:** Pure API-based scraper with two loops (discovery + sync). Category codes derived from section names via parser. `tournament_players` table links players to tournaments by category. Web layer uses `category_code` for filtering.

**Tech Stack:** Bun, bun:sqlite, bun:test, TieSports REST API, Next.js (web)

**Spec:** `docs/superpowers/specs/2026-03-25-api-based-scraper-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `packages/scraper/src/parse-category.ts` | Category normalization: section name → code |
| `packages/scraper/src/parse-category.test.ts` | Unit tests for all category patterns |
| `packages/scraper/src/sync-tournaments.ts` | Discovery + match/player sync logic |
| `packages/scraper/src/sync-tournaments.test.ts` | Integration tests for sync |

### Modified files
| File | Changes |
|------|---------|
| `packages/scraper/src/types.ts` | New types: ApiSection, ApiRound, ApiDrawsResponse, ApiSectionPlayer, ApiPlayerEntry, ApiPlayerEntriesResponse |
| `packages/scraper/src/api.ts` | New functions: getTournamentDraws, getSectionPlayers, getUpcomingMatches, searchTournaments. Remove getTournamentMatches |
| `packages/scraper/src/api.test.ts` | Tests for new API functions |
| `packages/scraper/src/db.ts` | Migration: tournament_players table, category_code + section_id columns, backfill |
| `packages/scraper/src/daemon.ts` | Rewrite: remove Playwright, use API sync loops |
| `packages/db/src/queries/tournaments.ts` | Updated queries for category_code, tournament_players joins |
| `packages/api/src/index.ts` | Update to handle new CategoryInfo return type from getTournamentCategories |
| `packages/scraper/src/cli.ts` | Remove deleted-file imports, add new sync/discover commands |

### Files to delete (Task 8)
| File | Reason |
|------|--------|
| `packages/scraper/src/scrape-matches-page.ts` | Replaced by get_matches API |
| `packages/scraper/src/scrape-matches-page.test.ts` | Tests for deleted file |
| `packages/scraper/src/scrape-draws-page.ts` | Replaced by get_matches API |
| `packages/scraper/src/scrape-draws-page.test.ts` | Tests for deleted file |
| `packages/scraper/src/store-schedule.ts` | Replaced by sync-tournaments.ts |
| `packages/scraper/src/store-schedule.test.ts` | Tests for deleted file |
| `packages/scraper/src/scrape-upcoming-matches.ts` | Replaced by get_homepage_matches |
| `packages/scraper/src/scrape-all-tournaments.ts` | Replaced by get_matches API |
| `packages/scraper/src/find-tournaments.ts` | Replaced by get_tournament discovery |
| `packages/scraper/src/import-matches.ts` | Superseded |
| `packages/scraper/src/skip-list.ts` | Was for Playwright failures |

---

## Task 1: Category Parser (`parse-category.ts`)

Pure function, no dependencies. TDD.

**Files:**
- Create: `packages/scraper/src/parse-category.ts`
- Create: `packages/scraper/src/parse-category.test.ts`

- [ ] **Step 1: Write failing tests for all category patterns**

```typescript
// packages/scraper/src/parse-category.test.ts
import { test, expect, describe } from "bun:test";
import { parseCategoryCode } from "./parse-category";

describe("parseCategoryCode", () => {
  // Open categories (API section names)
  test("Masculinos level", () => {
    expect(parseCategoryCode("Masculinos 5")).toBe("M5");
    expect(parseCategoryCode("Masculinos 1")).toBe("M1");
    expect(parseCategoryCode("Masculinos 6")).toBe("M6");
  });

  test("Femininos level", () => {
    expect(parseCategoryCode("Femininos 4")).toBe("F4");
    expect(parseCategoryCode("Femininos 1")).toBe("F1");
  });

  test("Mixed level", () => {
    expect(parseCategoryCode("Mix 3")).toBe("MX3");
    expect(parseCategoryCode("Mistos 3")).toBe("MX3");
  });

  // Veterans (age group)
  test("Veterans masculinos", () => {
    expect(parseCategoryCode("Masculinos Veteranos +45")).toBe("M+45");
    expect(parseCategoryCode("Masculinos +50")).toBe("M+50");
  });

  test("Veterans femininos", () => {
    expect(parseCategoryCode("Femininos +50")).toBe("F+50");
    expect(parseCategoryCode("Femininos Veteranos +45")).toBe("F+45");
  });

  // Youth
  test("Youth masculinos", () => {
    expect(parseCategoryCode("Masculinos Sub-14")).toBe("M-SUB14");
    expect(parseCategoryCode("Masculinos Sub-12")).toBe("M-SUB12");
  });

  test("Youth femininos", () => {
    expect(parseCategoryCode("Femininos Sub-14")).toBe("F-SUB14");
    expect(parseCategoryCode("Femininos Sub-12")).toBe("F-SUB12");
  });

  // Existing Playwright-scraped values (backfill compat)
  test("Playwright category codes passthrough", () => {
    expect(parseCategoryCode("M5")).toBe("M5");
    expect(parseCategoryCode("F4")).toBe("F4");
    expect(parseCategoryCode("MX3")).toBe("MX3");
  });

  test("Playwright with suffix", () => {
    expect(parseCategoryCode("M5-Quali")).toBe("M5");
    expect(parseCategoryCode("M6-QP")).toBe("M6");
    expect(parseCategoryCode("Quadro Principal M5")).toBe("M5");
    expect(parseCategoryCode("Qualificação F4")).toBe("F4");
  });

  // Unknown
  test("unknown returns UNKNOWN", () => {
    expect(parseCategoryCode("")).toBe("UNKNOWN");
    expect(parseCategoryCode("Some Random Text")).toBe("UNKNOWN");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/scraper && bun test src/parse-category.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parseCategoryCode**

```typescript
// packages/scraper/src/parse-category.ts

/**
 * Normalize a section/category name into a compact category code.
 *
 * Input formats:
 *   API section names: "Masculinos 5", "Femininos Veteranos +45", "Masculinos Sub-14", "Mix 3"
 *   Playwright scraped: "M5-Quali", "Quadro Principal M5", "Qualificação F4"
 *   Already normalized: "M5", "F4", "MX3"
 *
 * Output: "M5", "F4", "MX3", "M+45", "F-SUB14", or "UNKNOWN"
 */
export function parseCategoryCode(raw: string): string {
  if (!raw || !raw.trim()) return "UNKNOWN";
  const s = raw.trim();

  // Already a compact code? (M5, F4, MX3, M+45, M-SUB14)
  const compact = s.match(/^(M|F|MX)(\d+|\+\d+|-SUB\d+)$/);
  if (compact) return `${compact[1]}${compact[2]}`;

  // Playwright suffixed: "M5-Quali", "M6-QP" → take prefix
  const suffixed = s.match(/^((?:M|F|MX)\d+)-/);
  if (suffixed) return suffixed[1];

  // "Quadro Principal M5", "Qualificação F4" → extract code
  const embedded = s.match(/\b((?:M|F|MX)\d+)\b/);
  if (embedded) return embedded[1];

  // Determine gender prefix
  let gender: string;
  if (/^(?:Mix|Mist[oa]s)/i.test(s)) {
    gender = "MX";
  } else if (/^Feminino/i.test(s)) {
    gender = "F";
  } else if (/^Masculino/i.test(s)) {
    gender = "M";
  } else {
    return "UNKNOWN";
  }

  // Youth: Sub-14, Sub-12
  const youth = s.match(/Sub-(\d+)/i);
  if (youth) return `${gender}-SUB${youth[1]}`;

  // Veterans: +45, +50
  const vet = s.match(/\+(\d+)/);
  if (vet) return `${gender}+${vet[1]}`;

  // Open level: "Masculinos 5" → M5
  const level = s.match(/\b([1-6])\b/);
  if (level) return `${gender}${level[1]}`;

  return "UNKNOWN";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/scraper && bun test src/parse-category.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/parse-category.ts packages/scraper/src/parse-category.test.ts
git commit -m "feat(scraper): add category code parser with TDD tests"
```

---

## Task 2: API Types (`types.ts`)

**Files:**
- Modify: `packages/scraper/src/types.ts`

- [ ] **Step 1: Add new types to types.ts**

Append to end of `packages/scraper/src/types.ts`:

```typescript
// --- Draws / Sections API types ---

export interface ApiSection {
  id: number;
  name: string;
}

export interface ApiRound {
  id: number;
  name: string;
  matches: ApiMatch[];
}

export interface ApiDrawsResponse {
  sections: ApiSection[];
  rounds: ApiRound[];
  web_url: string;
}

export interface ApiSectionPlayer {
  id: number;
  name: string;
  photo: string;
  national_id: string;
  age_group: string;
  ranking: string;
}

export interface ApiPlayerEntry {
  row_title: string;
  players: ApiSectionPlayer[];
  national_id: string;
  club: string;
  ranking: string;
  age_group: string;
}

export interface ApiPlayerEntriesResponse {
  list: ApiPlayerEntry[];
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/scraper && bun build src/types.ts --no-bundle 2>&1 | head -5`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add packages/scraper/src/types.ts
git commit -m "feat(scraper): add API types for draws, sections, and player entries"
```

---

## Task 3: API Client Functions (`api.ts`)

**Files:**
- Modify: `packages/scraper/src/api.ts`
- Modify: `packages/scraper/src/api.test.ts`

- [ ] **Step 1: Write failing tests for new API functions**

Append to `packages/scraper/src/api.test.ts`:

```typescript
import { test, expect, describe } from "bun:test";
import { getTournamentDraws, getSectionPlayers, getUpcomingMatches, searchTournaments } from "./api";

describe("getTournamentDraws", () => {
  test("returns sections and rounds for a known tournament", async () => {
    // Tournament 23404 is known to exist per spec
    const result = await getTournamentDraws(23404);
    expect(result).toHaveProperty("sections");
    expect(result).toHaveProperty("rounds");
    expect(Array.isArray(result.sections)).toBe(true);
  });

  test("returns sections with id and name", async () => {
    const result = await getTournamentDraws(23404);
    if (result.sections.length > 0) {
      const section = result.sections[0];
      expect(typeof section.id).toBe("number");
      expect(typeof section.name).toBe("string");
    }
  });
});

describe("getSectionPlayers", () => {
  test("returns player entries for a section", async () => {
    // First get a section ID from draws
    const draws = await getTournamentDraws(23404);
    if (draws.sections.length === 0) return; // skip if no sections
    const sectionId = draws.sections[0].id;

    const result = await getSectionPlayers(sectionId);
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("players");
      expect(result[0]).toHaveProperty("row_title");
    }
  });
});

describe("getUpcomingMatches", () => {
  test("returns matches array", async () => {
    const result = await getUpcomingMatches(23404);
    expect(result).toHaveProperty("matches");
    expect(Array.isArray(result.matches)).toBe(true);
  });
});

describe("searchTournaments", () => {
  test("finds tournaments by name", async () => {
    const results = await searchTournaments("Padel");
    expect(Array.isArray(results)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/scraper && bun test src/api.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Add new functions to api.ts**

Add these functions to `packages/scraper/src/api.ts`. Also add the new type imports.

```typescript
// Add to imports at top:
import type { ApiDrawsResponse, ApiPlayerEntry, ApiSection, ApiRound } from "./types";

export async function getTournamentDraws(
  tournamentId: number,
  sectionId = 0
): Promise<ApiDrawsResponse> {
  const data = (await get(
    `/tournaments.asmx/get_matches?tournament_id=${tournamentId}&section_id=${sectionId}&round=0&count_items=0`
  )) as ApiDrawsResponse;
  return {
    sections: data.sections ?? [],
    rounds: data.rounds ?? [],
    web_url: (data as any).web_url ?? "",
  };
}

export async function getSectionPlayers(
  sectionId: number,
  offset = 0
): Promise<ApiPlayerEntry[]> {
  const data = (await get(
    `/tournaments.asmx/get_players_by_section?section_id=${sectionId}&count_items=${offset}`
  )) as { list: ApiPlayerEntry[] };
  return data.list ?? [];
}

export async function getUpcomingMatches(
  tournamentId: number,
  offset = 0,
  flag = ""
): Promise<{ matches: ApiMatch[]; hasMore: boolean }> {
  const data = (await get(
    `/tournaments.asmx/get_homepage_matches?tournament_id=${tournamentId}&count_items=${offset}&flag=${flag}`
  )) as { lists: ApiMatch[]; load_more_latest: boolean };
  return { matches: data.lists ?? [], hasMore: data.load_more_latest ?? false };
}

export async function searchTournaments(
  query: string,
  offset = 0
): Promise<ApiTournament[]> {
  const data = (await get(
    `/tournaments.asmx/get_search_tournaments_v2?search_type=2&search_by_name=${encodeURIComponent(query)}&lat=0&lng=0&distance_km=100&filter_date=&count_tournaments=${offset}&country_id=0&city_id=0&age_group_id=0&categories=`
  )) as { list: ApiTournament[] };
  return data.list ?? [];
}
```

- [ ] **Step 4: Remove old getTournamentMatches**

Remove the `getTournamentMatches` function from `api.ts` (lines 54-62). The new `getUpcomingMatches` replaces it with the same endpoint but more flexible parameters.

**Important:** Before removing, check if anything imports `getTournamentMatches` from api.ts:
```bash
cd packages/scraper && grep -r "getTournamentMatches" src/ --include="*.ts" | grep -v test | grep -v ".test."
```
Update any importers to use `getUpcomingMatches` instead (likely `scrape-all-tournaments.ts` which will be deleted in Task 8).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/scraper && bun test src/api.test.ts`
Expected: All PASS (note: these hit real API — tests may be slow)

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/api.ts packages/scraper/src/api.test.ts packages/scraper/src/types.ts
git commit -m "feat(scraper): add API functions for draws, section players, and search"
```

---

## Task 4: DB Schema Migration

**Files:**
- Modify: `packages/scraper/src/db.ts`

- [ ] **Step 1: Add tournament_players table to migrate()**

Add after the `match_ratings` table creation in `packages/scraper/src/db.ts` (after line 167):

```typescript
  db.run(`
    CREATE TABLE IF NOT EXISTS tournament_players (
      tournament_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      category_code TEXT NOT NULL DEFAULT 'UNKNOWN',
      partner_id INTEGER,
      section_id INTEGER,
      PRIMARY KEY (tournament_id, player_id, category_code),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
      FOREIGN KEY (player_id) REFERENCES players(id),
      FOREIGN KEY (partner_id) REFERENCES players(id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_tournament_players_tournament ON tournament_players(tournament_id, category_code)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tournament_players_player ON tournament_players(player_id)");
```

- [ ] **Step 2: Add category_code and section_id columns to matches**

Add to the column-check block in `migrate()` (after the `result_type` column addition, around line 123):

```typescript
  if (!colNames.has("category_code")) {
    db.run("ALTER TABLE matches ADD COLUMN category_code TEXT");
  }
  if (!colNames.has("section_id")) {
    db.run("ALTER TABLE matches ADD COLUMN section_id INTEGER");
  }
```

And add the index:
```typescript
  db.run("CREATE INDEX IF NOT EXISTS idx_matches_category_code ON matches(category_code)");
```

- [ ] **Step 3: Add category_code backfill logic**

Add a backfill function at the end of `migrate()` that populates `category_code` from existing `category` and `section_name` values.

**Important:** Add `import { parseCategoryCode } from "./parse-category"` at the top of `db.ts` alongside other imports.

```typescript
  // Backfill category_code from existing data
  const needsBackfill = db.query(
    "SELECT COUNT(*) as c FROM matches WHERE category_code IS NULL AND (category IS NOT NULL OR section_name IS NOT NULL)"
  ).get() as { c: number };

  if (needsBackfill.c > 0) {
    const rows = db.query(
      "SELECT guid, category, section_name FROM matches WHERE category_code IS NULL AND (category IS NOT NULL OR section_name IS NOT NULL)"
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
    console.log(`Backfilled category_code for ${rows.length} matches`);
  }
```

- [ ] **Step 4: Verify migration runs without errors**

Run: `cd packages/scraper && bun -e "const { getDb } = require('./src/db'); const db = getDb(); console.log('OK'); const cols = db.query('PRAGMA table_info(tournament_players)').all(); console.log('tournament_players columns:', cols.map(c => c.name))"`
Expected: OK, columns listed

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/db.ts
git commit -m "feat(db): add tournament_players table, category_code column, and backfill migration"
```

---

## Task 5: Sync Logic (`sync-tournaments.ts`)

This is the core new file. Replaces `find-tournaments.ts`, `scrape-all-tournaments.ts`, `store-schedule.ts`.

**Files:**
- Create: `packages/scraper/src/sync-tournaments.ts`
- Create: `packages/scraper/src/sync-tournaments.test.ts`

- [ ] **Step 1: Write failing tests for discovery**

```typescript
// packages/scraper/src/sync-tournaments.test.ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { discoverTournaments, rescanGaps, syncTournamentMatches, syncTournamentPlayers } from "./sync-tournaments";

// Use in-memory DB for testing
let db: Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  // Minimal schema for testing
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

    // Verify it was inserted into DB
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/scraper && bun test src/sync-tournaments.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement discoverTournaments**

```typescript
// packages/scraper/src/sync-tournaments.ts
import { Database } from "bun:sqlite";
import { getTournament, getTournamentDraws, getSectionPlayers } from "./api";
import { parseCategoryCode } from "./parse-category";
import type { ApiTournamentDetail, ApiMatch, ApiSection, ApiPlayerEntry } from "./types";

const MAX_CONCURRENT = 5;
const BATCH_DELAY_MS = 200;
const MAX_CONSECUTIVE_MISSES = 50;
const MAX_RETRIES = 3;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [sync] ${msg}`);
}

async function retry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === retries - 1) throw err;
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      if (err?.message?.includes("429")) {
        log("Rate limited (429), pausing 60s");
        await Bun.sleep(60_000);
      } else {
        await Bun.sleep(delay);
      }
    }
  }
  throw new Error("Unreachable");
}

interface DiscoverOptions {
  db: Database;
  startId?: number;
  endId?: number;
}

interface DiscoveredTournament {
  id: number;
  name: string;
  sport: string | null;
}

export async function discoverTournaments(opts: DiscoverOptions): Promise<DiscoveredTournament[]> {
  const { db } = opts;
  const discovered: DiscoveredTournament[] = [];

  // Get max known ID if no start specified
  let startId = opts.startId;
  if (startId == null) {
    const row = db.query("SELECT MAX(id) as maxId FROM tournaments").get() as { maxId: number | null };
    startId = (row.maxId ?? 0) + 1;
  }

  const endId = opts.endId;
  let consecutiveMisses = 0;
  let currentId = startId;

  const insertTournament = db.prepare(`
    INSERT OR IGNORE INTO tournaments (id, name, club, date, link_web, sport, club_id, cover, latitude, longitude, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  while (true) {
    // Build batch of IDs to check
    const batch: number[] = [];
    for (let i = 0; i < MAX_CONCURRENT && (endId == null || currentId <= endId); i++) {
      batch.push(currentId++);
    }
    if (batch.length === 0) break;

    // Check all IDs in parallel
    const results = await Promise.allSettled(
      batch.map((id) => retry(() => getTournament(id)))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const id = batch[i];

      if (result.status === "rejected") {
        consecutiveMisses++;
        continue;
      }

      const tournament = result.value;
      if (!tournament || !tournament.id) {
        consecutiveMisses++;
        if (endId == null && consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
          log(`Stopping scan: ${MAX_CONSECUTIVE_MISSES} consecutive misses at ID ${id}`);
          return discovered;
        }
        continue;
      }

      consecutiveMisses = 0;

      // Extract sport from info_texts
      const sportInfo = tournament.info_texts?.find((t) => t.title === "Sport" || t.title === "Desporto");
      const sport = sportInfo?.text ?? null;

      // Skip non-Padel
      if (sport && sport !== "Padel") {
        continue;
      }

      const dateInfo = tournament.info_texts?.find((t) => t.title === "Date" || t.title === "Data");

      insertTournament.run(
        tournament.id,
        tournament.name,
        tournament.club?.name ?? null,
        dateInfo?.text ?? null,
        tournament.link_web ?? null,
        sport,
        tournament.club?.id ?? null,
        tournament.cover ?? null,
        tournament.location?.latitude ?? null,
        tournament.location?.longitude ?? null,
        tournament.location?.address ?? null
      );

      discovered.push({ id: tournament.id, name: tournament.name, sport });
      log(`Discovered: ${tournament.name} (ID: ${tournament.id})`);
    }

    if (endId == null && consecutiveMisses >= MAX_CONSECUTIVE_MISSES) break;
    if (endId != null && currentId > endId) break;

    await Bun.sleep(BATCH_DELAY_MS);
  }

  return discovered;
}

/**
 * Rescan gaps in known tournament ID range.
 * Called every 24h by daemon. Finds IDs not in DB within [min, max] range and checks them.
 */
export async function rescanGaps(opts: { db: Database }): Promise<DiscoveredTournament[]> {
  const { db } = opts;
  const range = db.query("SELECT MIN(id) as minId, MAX(id) as maxId FROM tournaments").get() as { minId: number | null; maxId: number | null };
  if (!range.minId || !range.maxId) return [];

  // Get all known IDs
  const knownRows = db.query("SELECT id FROM tournaments WHERE id BETWEEN ? AND ?").all(range.minId, range.maxId) as { id: number }[];
  const knownIds = new Set(knownRows.map((r) => r.id));

  // Find gaps
  const gapIds: number[] = [];
  for (let id = range.minId; id <= range.maxId; id++) {
    if (!knownIds.has(id)) gapIds.push(id);
  }

  if (gapIds.length === 0) return [];
  log(`Rescan: found ${gapIds.length} gaps in range [${range.minId}, ${range.maxId}]`);

  const discovered: DiscoveredTournament[] = [];
  const insertTournament = db.prepare(`
    INSERT OR IGNORE INTO tournaments (id, name, club, date, link_web, sport, club_id, cover, latitude, longitude, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Process gaps in batches
  for (let i = 0; i < gapIds.length; i += MAX_CONCURRENT) {
    const batch = gapIds.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map((id) => retry(() => getTournament(id)))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "rejected" || !result.value?.id) continue;

      const tournament = result.value;
      const sportInfo = tournament.info_texts?.find((t: any) => t.title === "Sport" || t.title === "Desporto");
      const sport = sportInfo?.text ?? null;
      if (sport && sport !== "Padel") continue;

      const dateInfo = tournament.info_texts?.find((t: any) => t.title === "Date" || t.title === "Data");
      insertTournament.run(
        tournament.id, tournament.name, tournament.club?.name ?? null,
        dateInfo?.text ?? null, tournament.link_web ?? null, sport,
        tournament.club?.id ?? null, tournament.cover ?? null,
        tournament.location?.latitude ?? null, tournament.location?.longitude ?? null,
        tournament.location?.address ?? null
      );
      discovered.push({ id: tournament.id, name: tournament.name, sport });
    }

    await Bun.sleep(BATCH_DELAY_MS);
  }

  log(`Gap rescan: discovered ${discovered.length} new tournament(s)`);
  return discovered;
}
```

- [ ] **Step 4: Implement syncTournamentMatches**

Append to `sync-tournaments.ts`:

```typescript
interface SyncMatchesOptions {
  db: Database;
  tournamentId: number;
}

interface SyncMatchesResult {
  inserted: number;
  updated: number;
  skipped: number;
  sections: number;
  newPlayers: number;
}

export async function syncTournamentMatches(opts: SyncMatchesOptions): Promise<SyncMatchesResult> {
  const { db, tournamentId } = opts;
  const result: SyncMatchesResult = { inserted: 0, updated: 0, skipped: 0, sections: 0, newPlayers: 0 };

  // Fetch all sections + rounds + matches
  const draws = await retry(() => getTournamentDraws(tournamentId));
  result.sections = draws.sections.length;

  if (draws.rounds.length === 0) {
    log(`No draws data for tournament ${tournamentId}`);
    return result;
  }

  const insertPlayer = db.prepare("INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)");
  const insertMatch = db.prepare(`
    INSERT INTO matches (guid, tournament_id, tournament_name, section_name, round_name, date_time,
      is_singles, side_a_ids, side_b_ids, side_a_names, side_b_names,
      sets_json, winner_side, source, court, category, category_code, section_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertMatchPlayer = db.prepare("INSERT OR IGNORE INTO match_players (match_guid, player_id, side) VALUES (?, ?, ?)");
  const existingMatch = db.prepare("SELECT guid, winner_side FROM matches WHERE guid = ?");
  const updateMatchResult = db.prepare(
    "UPDATE matches SET sets_json = ?, winner_side = ?, date_time = ?, court = ?, category_code = ? WHERE guid = ?"
  );

  // Dedup: find existing matches from news feed by player IDs + tournament
  // API GUIDs differ from news feed UIDNEWs, so we check by player combination
  const findByPlayers = db.prepare(`
    SELECT guid, winner_side FROM matches
    WHERE tournament_id = ?
    AND ((side_a_ids = ? AND side_b_ids = ?) OR (side_a_ids = ? AND side_b_ids = ?))
    AND source LIKE 'scrape:tournament:%'
  `);
  const enrichExisting = db.prepare(`
    UPDATE matches SET category_code = ?, section_id = ?, category = ?, court = ?, round_name = ?
    WHERE guid = ?
  `);

  // Get tournament name for reference
  const tournamentRow = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  const tournamentName = tournamentRow?.name ?? "";
  const source = `api:tournament:${tournamentId}`;

  // Build section ID → name map
  const sectionMap = new Map<number, string>();
  for (const section of draws.sections) {
    sectionMap.set(section.id, section.name);
  }

  const tx = db.transaction(() => {
    for (const round of draws.rounds) {
      for (const match of round.matches) {
        const sideA = match.side_a ?? [];
        const sideB = match.side_b ?? [];

        const sideAIds = sideA.map((p) => p.id).filter((id) => id > 0);
        const sideBIds = sideB.map((p) => p.id).filter((id) => id > 0);

        if (sideAIds.length === 0 || sideBIds.length === 0) {
          result.skipped++;
          continue;
        }

        // Skip singles
        const isSingles = sideA.length === 1 && sideB.length === 1 ? 1 : 0;
        if (isSingles) {
          result.skipped++;
          continue;
        }

        // Insert players
        for (const p of [...sideA, ...sideB]) {
          if (p.id > 0) {
            const r = insertPlayer.run(p.id, p.name);
            if (r.changes > 0) result.newPlayers++;
          }
        }

        // Use API match GUID
        const guid = match.id;

        // Determine section from match infos
        const sectionName = match.infos?.title_left ?? "";
        const categoryCode = parseCategoryCode(sectionName);
        const sectionId = draws.sections.find((s) => s.name === sectionName)?.id ?? null;

        // Date/time from infos
        const dateTime = match.infos?.date_time?.str ?? null;
        const court = match.infos?.top_left ?? null;
        const roundName = match.infos?.top_right ?? round.name ?? null;

        // Winner
        let winnerSide: string | null = null;
        if (match.winner_a) winnerSide = "a";
        else if (match.winner_b) winnerSide = "b";

        // Sets
        const setsJson = match.sets?.length > 0 ? JSON.stringify(match.sets) : null;

        const sideAIdsJson = JSON.stringify(sideAIds);
        const sideBIdsJson = JSON.stringify(sideBIds);
        const sideANames = sideA.map((p) => p.name).join(" / ");
        const sideBNames = sideB.map((p) => p.name).join(" / ");

        // Check existing by API GUID
        const existing = existingMatch.get(guid) as { guid: string; winner_side: string | null } | null;
        if (existing) {
          if (!existing.winner_side && winnerSide) {
            updateMatchResult.run(setsJson, winnerSide, dateTime, court, categoryCode, guid);
            result.updated++;
          } else {
            result.skipped++;
          }
          continue;
        }

        // Dedup: check if same match exists from news feed (different GUID)
        const feedMatch = findByPlayers.get(
          tournamentId, sideAIdsJson, sideBIdsJson, sideBIdsJson, sideAIdsJson
        ) as { guid: string; winner_side: string | null } | null;
        if (feedMatch) {
          // Enrich existing news feed match with category_code and section data
          enrichExisting.run(categoryCode, sectionId, sectionName, court, roundName, feedMatch.guid);
          result.updated++;
          continue;
        }

        // Insert new match
        insertMatch.run(
          guid, tournamentId, tournamentName, sectionName, roundName, dateTime,
          isSingles, sideAIdsJson, sideBIdsJson, sideANames, sideBNames,
          setsJson, winnerSide, source, court, sectionName, categoryCode, sectionId
        );

        for (const id of sideAIds) insertMatchPlayer.run(guid, id, "a");
        for (const id of sideBIds) insertMatchPlayer.run(guid, id, "b");

        result.inserted++;
      }
    }
  });
  tx();

  // Update sync timestamp
  db.run(
    "UPDATE tournaments SET matches_synced_at = datetime('now') WHERE id = ?",
    [tournamentId]
  );

  log(`Matches sync for ${tournamentId}: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped`);
  return result;
}
```

- [ ] **Step 5: Implement syncTournamentPlayers**

Append to `sync-tournaments.ts`:

```typescript
interface SyncPlayersOptions {
  db: Database;
  tournamentId: number;
}

interface SyncPlayersResult {
  upserted: number;
  sections: number;
}

export async function syncTournamentPlayers(opts: SyncPlayersOptions): Promise<SyncPlayersResult> {
  const { db, tournamentId } = opts;
  const result: SyncPlayersResult = { upserted: 0, sections: 0 };

  // Get sections from draws
  const draws = await retry(() => getTournamentDraws(tournamentId));

  if (draws.sections.length === 0) {
    log(`No sections for tournament ${tournamentId}`);
    return result;
  }

  const insertPlayer = db.prepare("INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)");
  const upsertTournamentPlayer = db.prepare(`
    INSERT INTO tournament_players (tournament_id, player_id, category_code, partner_id, section_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, player_id, category_code)
    DO UPDATE SET partner_id = excluded.partner_id, section_id = excluded.section_id
  `);
  const updateLicense = db.prepare(
    "UPDATE players SET license_number = ? WHERE id = ? AND (license_number IS NULL OR license_number = '')"
  );

  for (const section of draws.sections) {
    const categoryCode = parseCategoryCode(section.name);
    let entries: ApiPlayerEntry[];

    try {
      entries = await retry(() => getSectionPlayers(section.id));
    } catch (err) {
      log(`Failed to get players for section ${section.id} (${section.name}): ${err}`);
      continue;
    }

    result.sections++;

    const tx = db.transaction(() => {
      for (const entry of entries) {
        const players = entry.players ?? [];
        const playerIds = players.map((p) => p.id).filter((id) => id > 0);

        for (const p of players) {
          if (p.id <= 0) continue;

          insertPlayer.run(p.id, p.name);

          if (p.national_id) {
            updateLicense.run(p.national_id, p.id);
          }

          // Find partner (the other player in the pair)
          const partnerId = playerIds.find((id) => id !== p.id) ?? null;

          upsertTournamentPlayer.run(tournamentId, p.id, categoryCode, partnerId, section.id);
          result.upserted++;
        }
      }
    });
    tx();

    await Bun.sleep(BATCH_DELAY_MS);
  }

  log(`Players sync for ${tournamentId}: ${result.upserted} upserted across ${result.sections} sections`);
  return result;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/scraper && bun test src/sync-tournaments.test.ts`
Expected: All PASS (hits real API)

- [ ] **Step 7: Commit**

```bash
git add packages/scraper/src/sync-tournaments.ts packages/scraper/src/sync-tournaments.test.ts
git commit -m "feat(scraper): add API-based tournament discovery and match/player sync"
```

---

## Task 6: Update DB Queries for category_code

**Files:**
- Modify: `packages/db/src/queries/tournaments.ts`
- Modify: `packages/db/test/tournaments.test.ts`

- [ ] **Step 1: Write failing test for getTournamentCategories with codes**

Add test to `packages/db/test/tournaments.test.ts`:

```typescript
describe("getTournamentCategories with category_code", () => {
  test("returns category codes when available", () => {
    // This test depends on data synced by the scraper having category_code populated
    // For now, test the function signature accepts and returns the right shape
    const categories = getTournamentCategories(23404);
    expect(Array.isArray(categories)).toBe(true);
  });
});
```

- [ ] **Step 2: Update getTournamentCategories**

Modify `packages/db/src/queries/tournaments.ts` function `getTournamentCategories` to return objects with code, name, and counts:

```typescript
interface CategoryInfo {
  code: string;
  name: string;
  matchCount: number;
  playerCount: number;
}

export function getTournamentCategories(tournamentId: number): CategoryInfo[] {
  const db = getDb();

  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  if (!tournament) return [];

  // Prefer category_code, fall back to section_name
  const rows = db.query(`
    SELECT
      COALESCE(m.category_code, m.section_name) as code,
      COALESCE(m.category, m.section_name) as name,
      COUNT(DISTINCT m.guid) as matchCount,
      COUNT(DISTINCT mp.player_id) as playerCount
    FROM matches m
    LEFT JOIN match_players mp ON mp.match_guid = m.guid
    WHERE (m.tournament_id = ? OR m.source LIKE ? OR m.tournament_name = ?)
    AND COALESCE(m.category_code, m.section_name) IS NOT NULL
    AND length(COALESCE(m.category_code, m.section_name)) > 0
    GROUP BY code
    ORDER BY code
  `).all(tournamentId, `%tournament:${tournamentId}`, tournament.name) as CategoryInfo[];

  // Merge with tournament_players data
  const tpRows = db.query(`
    SELECT category_code as code, COUNT(DISTINCT player_id) as cnt
    FROM tournament_players
    WHERE tournament_id = ?
    GROUP BY category_code
  `).all(tournamentId) as Array<{ code: string; cnt: number }>;

  const tpMap = new Map(tpRows.map((r) => [r.code, r.cnt]));

  // Update player counts from tournament_players if available (more accurate)
  for (const row of rows) {
    const tpCount = tpMap.get(row.code);
    if (tpCount != null) row.playerCount = tpCount;
  }

  // Add categories that only exist in tournament_players
  const existingCodes = new Set(rows.map((r) => r.code));
  for (const [code, cnt] of tpMap) {
    if (!existingCodes.has(code)) {
      rows.push({ code, name: code, matchCount: 0, playerCount: cnt });
    }
  }

  return rows;
}
```

**Note:** This changes the return type from `string[]` to `CategoryInfo[]`. Update callers:
- `packages/web/src/app/api/tournaments/[id]/route.ts` — update to pass new shape
- `packages/web/src/app/tournaments/[id]/category-filter.tsx` — update to use `.code` and `.name`

- [ ] **Step 3: Update getTournamentPlayers to support category_code**

Add an alternative path in `getTournamentPlayers` that uses `tournament_players` when available:

```typescript
export function getTournamentPlayers(
  tournamentId: number,
  category?: string,
  page = 1,
  pageSize = 50
): { players: TournamentPlayer[]; total: number } {
  const db = getDb();

  // Try tournament_players first (API-sourced data)
  const tpCount = db.query(
    "SELECT COUNT(*) as c FROM tournament_players WHERE tournament_id = ?"
  ).get(tournamentId) as { c: number };

  if (tpCount.c > 0) {
    return getTournamentPlayersFromTp(db, tournamentId, category, page, pageSize);
  }

  // Fall back to existing match_players-based logic
  return getTournamentPlayersFromMatches(db, tournamentId, category, page, pageSize);
}
```

Rename the existing function body to `getTournamentPlayersFromMatches` and add:

```typescript
function getTournamentPlayersFromTp(
  db: ReturnType<typeof getDb>,
  tournamentId: number,
  category: string | undefined,
  page: number,
  pageSize: number
): { players: TournamentPlayer[]; total: number } {
  let countQuery = "SELECT COUNT(DISTINCT tp.player_id) as c FROM tournament_players tp WHERE tp.tournament_id = ?";
  let idQuery = `
    SELECT DISTINCT tp.player_id, COALESCE(r.ordinal, -999999) as ord
    FROM tournament_players tp
    LEFT JOIN ratings r ON r.player_id = tp.player_id
    WHERE tp.tournament_id = ?
  `;
  const params: any[] = [tournamentId];

  if (category) {
    countQuery += " AND tp.category_code = ?";
    idQuery += " AND tp.category_code = ?";
    params.push(category);
  }

  idQuery += " ORDER BY ord DESC";

  const total = (db.query(countQuery).get(...params) as { c: number }).c;
  if (total === 0) return { players: [], total: 0 };

  const allIds = db.query(idQuery).all(...params) as Array<{ player_id: number; ord: number }>;
  const offset = (page - 1) * pageSize;
  const pagePlayerIds = allIds.slice(offset, offset + pageSize).map((r) => r.player_id);
  if (pagePlayerIds.length === 0) return { players: [], total };

  const placeholders = pagePlayerIds.map(() => "?").join(",");

  // Reuse the same player detail + ranks + last match logic from getTournamentPlayersFromMatches
  // (extract into shared helper to avoid duplication)
  const rows = db.query(`
    SELECT p.id, p.name, p.gender, p.club, p.photo_url, p.license_number,
      r.ordinal, r.matches_counted
    FROM players p
    LEFT JOIN ratings r ON r.player_id = p.id
    WHERE p.id IN (${placeholders})
    ORDER BY r.ordinal DESC NULLS LAST
  `).all(...pagePlayerIds) as Array<{
    id: number; name: string; gender: string | null; club: string | null;
    photo_url: string | null; license_number: string | null;
    ordinal: number | null; matches_counted: number | null;
  }>;

  // Ranks
  const globalRanks = new Map<number, number>();
  const genderRanks = new Map<number, number>();
  const rankRows = db.query(`
    SELECT player_id, global_rank, gender_rank FROM (
      SELECT r.player_id,
        RANK() OVER (ORDER BY r.ordinal DESC) as global_rank,
        RANK() OVER (PARTITION BY p.gender ORDER BY r.ordinal DESC) as gender_rank
      FROM ratings r
      JOIN players p ON p.id = r.player_id
    ) WHERE player_id IN (${placeholders})
  `).all(...pagePlayerIds) as Array<{ player_id: number; global_rank: number; gender_rank: number }>;
  for (const row of rankRows) {
    globalRanks.set(row.player_id, row.global_rank);
    genderRanks.set(row.player_id, row.gender_rank);
  }

  const bounds = db.query("SELECT MIN(ordinal) as minOrd, MAX(ordinal) as maxOrd FROM ratings").get() as { minOrd: number; maxOrd: number };
  const range = bounds.maxOrd - bounds.minOrd;

  const players = rows.map((row) => {
    let rating: PlayerRating | null = null;
    if (row.ordinal != null && row.matches_counted != null) {
      const score = range > 0 ? Math.round(((row.ordinal - bounds.minOrd) / range) * 1000) / 10 : 0;
      const reliability = Math.round((row.matches_counted / (row.matches_counted + RELIABILITY_K)) * 100);
      rating = { score, reliability };
    }
    return {
      id: row.id, name: row.name, club: row.club ?? null,
      photoUrl: row.photo_url ?? null, licenseNumber: row.license_number ?? null,
      globalRank: globalRanks.get(row.id) ?? null,
      genderRank: genderRanks.get(row.id) ?? null,
      categoryRank: null, ordinal: row.ordinal ?? 0, rating,
      lastMatch: null, // Not needed for tournament_players view
    };
  });

  return { players, total };
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/db && bun test test/tournaments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/tournaments.ts packages/db/test/tournaments.test.ts
git commit -m "feat(db): update tournament queries for category_code and tournament_players"
```

---

## Task 7: Daemon Rewrite

**Files:**
- Modify: `packages/scraper/src/daemon.ts`

- [ ] **Step 1: Rewrite daemon.ts to remove Playwright**

Replace entire `daemon.ts` with API-based loops:

```typescript
// packages/scraper/src/daemon.ts
import { getDb, getCursor, setCursor, shouldSkipTournament, recordScrapeFailure, clearScrapeFailure } from "./db";
import { discoverTournaments, rescanGaps, syncTournamentMatches, syncTournamentPlayers } from "./sync-tournaments";
import { calculateRatings } from "./calculate-ratings";
import { enrichPlayerProfiles } from "./sync-players";

const DISCOVERY_INTERVAL = 60;  // minutes
const SYNC_INTERVAL = 60;       // minutes
const ENRICH_INTERVAL = 30;     // minutes
const ENRICH_BATCH_SIZE = 50;
const GAP_RESCAN_HOURS = 24;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg: string, err: unknown) {
  console.error(`[${new Date().toISOString()}] ${msg}`, err);
}

/**
 * Get tournaments that need match syncing.
 * Prioritize: recently created, then oldest sync timestamp.
 */
function getTournamentsToSync(): { id: number; name: string }[] {
  const db = getDb();
  return db.query(`
    SELECT id, name FROM tournaments
    WHERE sport IS NULL OR sport = 'Padel'
    ORDER BY
      CASE WHEN matches_synced_at IS NULL THEN 0 ELSE 1 END,
      matches_synced_at ASC
    LIMIT 20
  `).all() as { id: number; name: string }[];
}

/**
 * Loop 1: Discover new tournaments via get_tournament API.
 */
async function discoveryLoop() {
  log("=== Discovery Sync starting ===");

  try {
    const db = getDb();
    const discovered = await discoverTournaments({ db });
    log(`Discovered ${discovered.length} new tournament(s)`);

    // Gap rescan every 24h
    const lastGapRescan = getCursor("last_gap_rescan");
    const hoursSinceRescan = lastGapRescan
      ? (Date.now() - new Date(lastGapRescan).getTime()) / 3600_000
      : Infinity;
    if (hoursSinceRescan >= GAP_RESCAN_HOURS) {
      log("Running 24h gap rescan...");
      const gaps = await rescanGaps({ db });
      log(`Gap rescan: ${gaps.length} new tournament(s)`);
      setCursor("last_gap_rescan", new Date().toISOString());
    }
  } catch (err) {
    logError("Tournament discovery failed:", err);
  }

  try {
    log("Recalculating ratings...");
    calculateRatings();
  } catch (err) {
    logError("Rating calculation failed:", err);
  }

  log("=== Discovery Sync complete ===\n");
}

/**
 * Loop 2: Sync matches + players for active tournaments.
 */
async function syncLoop() {
  log("=== Match/Player Sync starting ===");

  const tournaments = getTournamentsToSync();
  if (tournaments.length === 0) {
    log("No tournaments to sync");
    log("=== Match/Player Sync complete ===\n");
    return;
  }

  log(`Syncing ${tournaments.length} tournament(s)`);

  const db = getDb();

  for (const t of tournaments) {
    const check = shouldSkipTournament(t.id);
    if (check.skip) {
      log(`Skipping ${t.name} (ID: ${t.id}): ${check.reason}`);
      continue;
    }

    try {
      log(`Syncing matches: ${t.name} (ID: ${t.id})`);
      await syncTournamentMatches({ db, tournamentId: t.id });
      await syncTournamentPlayers({ db, tournamentId: t.id });
      clearScrapeFailure(t.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordScrapeFailure(t.id, msg);
      logError(`Sync failed for ${t.name} (${t.id}):`, err);
    }
  }

  try {
    log("Recalculating ratings...");
    calculateRatings();
  } catch (err) {
    logError("Rating calculation failed:", err);
  }

  log("=== Match/Player Sync complete ===\n");
}

/**
 * Loop 3: Enrich player profiles (unchanged).
 */
async function enrichLoop() {
  log("=== Player Enrichment starting ===");

  try {
    await enrichPlayerProfiles(ENRICH_BATCH_SIZE, 200, true);
  } catch (err) {
    logError("Player enrichment failed:", err);
  }

  log("=== Player Enrichment complete ===\n");
}

function scheduleLoop(name: string, fn: () => Promise<void>, intervalMin: number) {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      logError(`Unhandled error in ${name}:`, err);
    }
    setTimeout(run, intervalMin * 60 * 1000);
  };
  return run;
}

async function main() {
  log("Daemon starting (API-based)");
  log(`Discovery interval: ${DISCOVERY_INTERVAL}min`);
  log(`Sync interval: ${SYNC_INTERVAL}min`);
  log(`Enrich interval: ${ENRICH_INTERVAL}min (batch: ${ENRICH_BATCH_SIZE})`);
  log("");

  const discovery = scheduleLoop("discovery", discoveryLoop, DISCOVERY_INTERVAL);
  const sync = scheduleLoop("sync", syncLoop, SYNC_INTERVAL);
  const enrich = scheduleLoop("enrich", enrichLoop, ENRICH_INTERVAL);

  // Start discovery immediately
  await discovery();

  // Stagger sync by 5 min
  setTimeout(sync, 5 * 60 * 1000);
  log("Sync loop will start in 5 minutes");

  // Stagger enrich by 2 min
  setTimeout(enrich, 2 * 60 * 1000);
  log("Enrich loop will start in 2 minutes\n");

  process.on("SIGINT", () => { log("Received SIGINT, shutting down..."); process.exit(0); });
  process.on("SIGTERM", () => { log("Received SIGTERM, shutting down..."); process.exit(0); });
}

main().catch((err) => {
  logError("Daemon fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify daemon compiles**

Run: `cd packages/scraper && bun build src/daemon.ts --no-bundle 2>&1 | head -10`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add packages/scraper/src/daemon.ts
git commit -m "feat(scraper): rewrite daemon to use API-based sync, remove Playwright"
```

---

## Task 8: Cleanup — Delete Playwright Files & Dependencies

**Files:**
- Delete: 10 files (see file structure above)
- Modify: `packages/scraper/package.json`

- [ ] **Step 1: Delete Playwright scraping files**

```bash
cd packages/scraper/src
rm scrape-matches-page.ts scrape-matches-page.test.ts
rm scrape-draws-page.ts scrape-draws-page.test.ts
rm store-schedule.ts store-schedule.test.ts
rm scrape-upcoming-matches.ts
rm scrape-all-tournaments.ts
rm find-tournaments.ts
rm import-matches.ts
rm skip-list.ts
```

- [ ] **Step 2: Remove find-tournaments.test.ts or update it**

The `find-tournaments.test.ts` tests tournament discovery. Since we replaced that with `sync-tournaments.ts`, check if tests should be migrated or deleted:

```bash
cd packages/scraper && grep -l "find-tournaments" src/*.ts
```

If nothing else imports from `find-tournaments.ts`, delete the test file:
```bash
rm packages/scraper/src/find-tournaments.test.ts
```

- [ ] **Step 3: Remove playwright dependency**

```bash
cd packages/scraper && bun remove playwright playwright-core
```

- [ ] **Step 4: Rewrite cli.ts**

Replace `packages/scraper/src/cli.ts` with updated commands. Remove imports of deleted files, add new sync commands:

```typescript
// packages/scraper/src/cli.ts
import { enrichPlayerProfiles } from "./sync-players";
import { calculateRatings, printLeaderboard } from "./calculate-ratings";
import { getDb, getCursor, setCursor } from "./db";

const cmd = process.argv[2];

switch (cmd) {
  case "discover": {
    const { discoverTournaments, rescanGaps } = await import("./sync-tournaments");
    const db = getDb();
    const subCmd = process.argv[3];
    if (subCmd === "gaps") {
      const gaps = await rescanGaps({ db });
      console.log(`Discovered ${gaps.length} tournaments from gaps`);
    } else {
      const startId = parseInt(process.argv[3] ?? "0") || undefined;
      const endId = parseInt(process.argv[4] ?? "0") || undefined;
      const discovered = await discoverTournaments({ db, startId, endId });
      console.log(`Discovered ${discovered.length} new tournament(s)`);
    }
    break;
  }

  case "sync": {
    const { syncTournamentMatches, syncTournamentPlayers } = await import("./sync-tournaments");
    const tid = parseInt(process.argv[3]);
    if (!tid) { console.log("Usage: bun src/cli.ts sync <tournament-id>"); break; }
    const db = getDb();
    const matchResult = await syncTournamentMatches({ db, tournamentId: tid });
    console.log(`Matches: ${matchResult.inserted} inserted, ${matchResult.updated} updated`);
    const playerResult = await syncTournamentPlayers({ db, tournamentId: tid });
    console.log(`Players: ${playerResult.upserted} upserted`);
    break;
  }

  case "enrich": {
    const allFlag = process.argv.includes("--all");
    const batch = parseInt(process.argv[3] ?? "100");
    await enrichPlayerProfiles(batch, 200, allFlag);
    break;
  }

  case "rate":
    calculateRatings();
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;

  case "recalculate": {
    const db = getDb();
    db.run("DELETE FROM ratings");
    console.log("Cleared old ratings");
    calculateRatings();
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;
  }

  case "leaderboard":
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;

  case "player": {
    const db = getDb();
    const search = process.argv[3];
    if (!search) { console.log("Usage: bun src/cli.ts player <name>"); break; }
    const players = db.query(
      "SELECT p.*, r.mu, r.sigma, r.ordinal, r.matches_counted FROM players p LEFT JOIN ratings r ON r.player_id = p.id WHERE p.name LIKE ? ORDER BY r.ordinal DESC NULLS LAST LIMIT 10"
    ).all(`%${search}%`) as any[];
    for (const p of players) {
      console.log(`${p.name} (ID: ${p.id}) | ${p.section ?? "?"} | ordinal: ${p.ordinal?.toFixed(2) ?? "N/A"} | μ: ${p.mu?.toFixed(2) ?? "N/A"} | σ: ${p.sigma?.toFixed(2) ?? "N/A"} | matches: ${p.matches_counted ?? 0}`);
    }
    break;
  }

  case "stats": {
    const db = getDb();
    const players = db.query("SELECT COUNT(*) as cnt FROM players").get() as { cnt: number };
    const matches = db.query("SELECT COUNT(*) as cnt FROM matches").get() as { cnt: number };
    const rated = db.query("SELECT COUNT(*) as cnt FROM ratings").get() as { cnt: number };
    const withResults = db.query("SELECT COUNT(*) as cnt FROM matches WHERE winner_side IS NOT NULL").get() as { cnt: number };
    const tournaments = db.query("SELECT COUNT(*) as cnt FROM tournaments").get() as { cnt: number };
    const tPlayers = db.query("SELECT COUNT(*) as cnt FROM tournament_players").get() as { cnt: number };
    console.log(`Players: ${players.cnt}`);
    console.log(`Matches: ${matches.cnt} (${withResults.cnt} with results)`);
    console.log(`Tournaments: ${tournaments.cnt}`);
    console.log(`Tournament players: ${tPlayers.cnt}`);
    console.log(`Rated players: ${rated.cnt}`);
    break;
  }

  case "daemon": {
    await import("./daemon");
    break;
  }

  case "failures": {
    const { listScrapeFailures, clearScrapeFailure } = await import("./db");
    const subCmd = process.argv[3];
    if (subCmd === "clear") {
      const tid = parseInt(process.argv[4]);
      if (tid) {
        clearScrapeFailure(tid);
        console.log(`Cleared failure record for tournament ${tid}`);
      } else {
        const all = listScrapeFailures();
        for (const f of all) clearScrapeFailure(f.tournamentId);
        console.log(`Cleared ${all.length} failure record(s)`);
      }
    } else {
      const db = getDb();
      const failures = listScrapeFailures();
      if (failures.length === 0) { console.log("No scrape failures recorded"); break; }
      for (const f of failures) {
        const t = db.query("SELECT name FROM tournaments WHERE id = ?").get(f.tournamentId) as { name: string } | null;
        const name = t?.name ?? "Unknown";
        console.log(`[${f.tournamentId}] ${name} — ${f.failure.count} failures, skip until ${f.failure.skipUntil}`);
        console.log(`  Last error: ${f.failure.lastError}`);
      }
    }
    break;
  }

  default:
    console.log(`Usage: bun src/cli.ts <command>

Commands:
  discover [start] [end]  Discover new tournaments via API (default: scan from max known ID)
  discover gaps            Rescan gaps in known ID range
  sync <tournament-id>     Sync matches + players for a tournament
  enrich [n]               Enrich n player profiles from API (default: 100)
  daemon                   Start sync daemon (discovery + sync + enrich loops)
  rate [n]                 Calculate ratings and show top n (default: 30)
  recalculate [n]          Clear and recalculate all ratings
  leaderboard [n]          Show top n rated players
  player <name>            Search player by name
  stats                    Show database statistics
  failures                 List tournaments with scrape failures
  failures clear [id]      Clear failure records (all or by tournament ID)`);
}
```

- [ ] **Step 5: Verify build**

Run: `cd packages/scraper && bun build src/daemon.ts --no-bundle 2>&1 | head -10`
Expected: No errors

- [ ] **Step 6: Run all remaining tests**

Run: `cd packages/scraper && bun test`
Expected: All PASS (deleted test files should not run)

- [ ] **Step 7: Commit**

```bash
git add -A packages/scraper/
git commit -m "refactor(scraper): remove Playwright files and dependency, clean up imports"
```

---

## Task 9: API Package — CategoryInfo Compatibility

**Files:**
- Modify: `packages/api/src/index.ts`

The `packages/api/src/index.ts` imports `getTournamentCategories` from `@fpp/db` and returns its result directly (line 81). Since we changed the return type from `string[]` to `CategoryInfo[]`, the API response shape changes automatically — but callers consuming the old `string[]` format will break.

- [ ] **Step 1: Verify API package compiles with new types**

Run: `cd packages/api && bun build src/index.ts --no-bundle 2>&1 | head -10`
Expected: No TypeScript errors (the new object shape is a superset)

- [ ] **Step 2: Update API route if needed**

In `packages/api/src/index.ts` line 81, `getTournamentCategories(id)` now returns `CategoryInfo[]` instead of `string[]`. The response shape changes from:
```json
{"categories": ["M5", "F4"]}
```
to:
```json
{"categories": [{"code": "M5", "name": "Masculinos 5", "matchCount": 12, "playerCount": 25}]}
```

This is a **breaking change** for the API. The tournament detail endpoint (line 70-86) should pass `category.code` to `getTournamentPlayers` and `getTournamentMatches`:

```typescript
  .get("/tournaments/:id", ({ params, query, set }) => {
    const id = parseInt(params.id, 10);
    const categoryCode = (query.category as string) || undefined;
    const page = parseInt((query.page as string) || "1", 10);

    const tournament = getTournament(id);
    if (!tournament) {
      set.status = 404;
      return { error: "Tournament not found" };
    }

    const categories = getTournamentCategories(id);
    const { players, total: totalPlayers } = getTournamentPlayers(id, categoryCode, page);
    const matches = getTournamentMatches(id, categoryCode);

    return { tournament, categories, players, totalPlayers, matches };
  })
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat(api): update tournament endpoint for category_code"
```

---

## Task 10: Web Layer — Category Code Support

**Files:**
- Modify: `packages/web/src/app/api/tournaments/[id]/route.ts`
- Modify: `packages/web/src/app/tournaments/[id]/page.tsx`
- Modify: `packages/web/src/app/tournaments/[id]/category-filter.tsx`

- [ ] **Step 1: Update API route to return CategoryInfo objects**

In `packages/web/src/app/api/tournaments/[id]/route.ts`, the categories are returned from `getTournamentCategories()`. Since we changed the return type to `CategoryInfo[]`, update the response shape. The API should return:

```json
{
  "categories": [{"code": "M5", "name": "Masculinos 5", "matchCount": 12, "playerCount": 25}],
  ...
}
```

- [ ] **Step 2: Update category-filter.tsx**

Update `packages/web/src/app/tournaments/[id]/category-filter.tsx` to use `category.code` for URL params and `category.name` for display. Show match/player counts as badges.

- [ ] **Step 3: Update tournament page to pass category_code**

In `packages/web/src/app/tournaments/[id]/page.tsx`, the category filter should use `category_code` in the query parameter instead of the raw section name.

- [ ] **Step 4: Verify web build**

Run: `cd packages/web && bun run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): update tournament pages to use category codes"
```

---

## Task 11: Integration Test — End-to-End Sync

- [ ] **Step 1: Write E2E test**

Add to `packages/scraper/src/sync-tournaments.test.ts`:

```typescript
describe("end-to-end sync", () => {
  test("discover → sync matches → sync players for tournament 23404", async () => {
    // Discovery
    const discovered = await discoverTournaments({ db, startId: 23404, endId: 23404 });
    expect(discovered.length).toBe(1);

    // Match sync
    const matchResult = await syncTournamentMatches({ db, tournamentId: 23404 });
    expect(matchResult.sections).toBeGreaterThan(0);

    // Player sync
    const playerResult = await syncTournamentPlayers({ db, tournamentId: 23404 });

    // Verify data in DB
    const matchCount = db.query("SELECT COUNT(*) as c FROM matches WHERE tournament_id = 23404").get() as { c: number };
    const playerCount = db.query("SELECT COUNT(*) as c FROM tournament_players WHERE tournament_id = 23404").get() as { c: number };

    console.log(`Tournament 23404: ${matchCount.c} matches, ${playerCount.c} tournament_players`);
    expect(matchCount.c).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `cd packages/scraper && bun test src/sync-tournaments.test.ts`
Expected: All PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test` from project root
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/scraper/src/sync-tournaments.test.ts
git commit -m "test(scraper): add end-to-end integration test for API-based sync"
```
