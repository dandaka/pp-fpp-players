# FPP Players Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first web frontend for browsing padel player rankings, match history, and tournaments.

**Architecture:** Bun monorepo with 3 packages: `packages/db` (shared SQLite access + types + queries), `packages/scraper` (existing scraper code), `packages/web` (Next.js + shadcn/ui). The web app reads `padel.db` at project root directly via `bun:sqlite` server components — no REST API.

**Tech Stack:** Bun workspaces, Next.js 15 (App Router), shadcn/ui, Tailwind CSS, bun:sqlite

**Data reality:**
- 46k players, 338k matches, 13k tournaments, 24k rated players
- `section_name` is empty for all matches from the FPP scraper (vast majority)
- `gender` is populated for only 3 players
- `tournament_id` FK does not exist on matches — must be derived from `source` column (`scrape:tournament:${id}`)
- Category and gender ranks will be shown only when data exists (graceful degradation)

**Spec:** `docs/superpowers/specs/2026-03-20-frontend-design.md`

---

## File Structure

```
pp-fpp-players/
  package.json                          # workspace root (modify)
  tsconfig.json                         # root tsconfig (create)
  packages/
    db/
      package.json                      # @fpp/db package
      tsconfig.json
      src/
        index.ts                        # re-exports
        connection.ts                   # bun:sqlite singleton
        types.ts                        # domain types
        queries/
          players.ts                    # searchPlayers, getPlayer, getPlayerRanks
          matches.ts                    # getPlayerMatches
          tournaments.ts               # getTournaments, getTournament, getTournamentCategories, getTournamentPlayers
      test/
        players.test.ts
        matches.test.ts
        tournaments.test.ts
    scraper/
      package.json                      # @fpp/scraper package
      tsconfig.json
      src/                              # all existing src/ files moved here
    web/
      package.json                      # @fpp/web package
      tsconfig.json
      next.config.ts
      tailwind.config.ts
      postcss.config.mjs
      src/
        app/
          layout.tsx                    # root layout with nav
          page.tsx                      # redirect to /players
          players/
            page.tsx                    # player search page
            [id]/
              page.tsx                  # player profile page
          tournaments/
            page.tsx                    # tournament list page
            [id]/
              page.tsx                  # tournament detail page
          api/
            players/
              search/route.ts           # search API for client-side debounce
            matches/
              [playerId]/route.ts       # infinite scroll endpoint
        components/
          nav.tsx                       # bottom tab bar / top nav
          player-card.tsx               # player search result card
          match-card.tsx                # match display card
          rank-badge.tsx                # rank display badge
          score-display.tsx             # set-by-set score
          infinite-scroll.tsx           # generic infinite scroll wrapper
        lib/
          fuzzy-search.ts              # diacritics normalization + scoring
          format.ts                    # date/number formatting helpers
```

---

### Task 1: Monorepo Setup + Workspace Config

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`, `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/scraper/package.json`, `packages/scraper/tsconfig.json`

- [ ] **Step 1: Update root package.json with workspaces**

```json
{
  "name": "pp-fpp-players",
  "private": true,
  "workspaces": ["packages/*"],
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

Remove the old `module`, `type`, `peerDependencies`, and `dependencies` fields — those move to the scraper package.

- [ ] **Step 2: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": {
      "@fpp/db": ["./packages/db/src"],
      "@fpp/db/*": ["./packages/db/src/*"]
    }
  }
}
```

- [ ] **Step 3: Create packages/db/package.json**

```json
{
  "name": "@fpp/db",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 4: Create packages/db/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create packages/scraper/package.json**

```json
{
  "name": "@fpp/scraper",
  "private": true,
  "type": "module",
  "main": "src/cli.ts",
  "dependencies": {
    "@fpp/db": "workspace:*",
    "cheerio": "^1.2.0",
    "openskill": "^4.1.1",
    "playwright": "^1.58.2"
  }
}
```

- [ ] **Step 6: Create packages/scraper/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Move src/ to packages/scraper/src/**

```bash
mkdir -p packages/scraper
mv src packages/scraper/src
```

- [ ] **Step 8: Update scraper imports to use @fpp/db for db.ts types**

In `packages/scraper/src/db.ts` — this file stays in scraper for now since the scraper needs write access and the active parser depends on it. The `packages/db` package will have its own read-only connection. No import changes needed yet.

- [ ] **Step 9: Run bun install and verify scraper still works**

```bash
bun install
bun packages/scraper/src/cli.ts stats
```

Expected: Same stats output as before (46k players, 338k matches, etc.)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: restructure into bun monorepo with workspaces"
```

---

### Task 2: Database Package — Connection + Types

**Files:**
- Create: `packages/db/src/connection.ts`, `packages/db/src/types.ts`, `packages/db/src/index.ts`

- [ ] **Step 1: Create packages/db/src/connection.ts**

```typescript
import { Database } from "bun:sqlite";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const dbPath = process.env.DB_PATH ?? new URL("../../../padel.db", import.meta.url).pathname;
  _db = new Database(dbPath, { readonly: true });
  return _db;
}
```

- [ ] **Step 2: Create packages/db/src/types.ts**

```typescript
export interface PlayerSearchResult {
  id: number
  name: string
  club: string | null
  globalRank: number
}

export interface Player {
  id: number
  name: string
  club: string | null
  photoUrl: string | null
  gender: string | null
  location: string | null
  ageGroup: string | null
  fppPontos: number | null
}

export interface PlayerRanks {
  global: { rank: number; total: number }
  gender: { rank: number; total: number; label: string } | null
  club: { rank: number; total: number; label: string } | null
}

export interface MatchDetail {
  guid: string
  tournamentId: number | null
  tournamentName: string | null
  sectionName: string | null
  roundName: string | null
  dateTime: string | null
  sets: Array<{ setA: number; setB: number; tieA: number; tieB: number }>
  winnerSide: string | null
  sideA: MatchPlayerInfo[]
  sideB: MatchPlayerInfo[]
}

export interface MatchPlayerInfo {
  id: number
  name: string
  categoryRank: number | null
  genderRank: number | null
}

export interface Tournament {
  id: number
  name: string
  club: string | null
  date: string | null
}

export interface TournamentDetail {
  id: number
  name: string
  club: string | null
  date: string | null
  linkWeb: string | null
}

export interface TournamentPlayer {
  id: number
  name: string
  genderRank: number | null
  categoryRank: number | null
  ordinal: number
}
```

- [ ] **Step 3: Create packages/db/src/index.ts**

```typescript
export { getDb } from "./connection";
export * from "./types";
export { searchPlayers, getPlayer, getPlayerRanks } from "./queries/players";
export { getPlayerMatches } from "./queries/matches";
export { getTournaments, getTournament, getTournamentCategories, getTournamentPlayers } from "./queries/tournaments";
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/connection.ts packages/db/src/types.ts packages/db/src/index.ts
git commit -m "feat(db): add connection, domain types, and index"
```

---

### Task 3: Database Package — Player Queries

**Files:**
- Create: `packages/db/src/queries/players.ts`, `packages/db/test/players.test.ts`

- [ ] **Step 1: Create packages/db/src/lib/fuzzy-search.ts**

```typescript
export function normalizeString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function scoreMatch(query: string, name: string): number {
  const normQuery = normalizeString(query);
  const normName = normalizeString(name);

  if (normName === normQuery) return 100;
  if (normName.startsWith(normQuery)) return 90;

  const words = normName.split(/\s+/);
  for (const word of words) {
    if (word.startsWith(normQuery)) return 80;
  }

  const idx = normName.indexOf(normQuery);
  if (idx >= 0) return 70 - idx * 0.1;

  return 0;
}
```

- [ ] **Step 2: Create packages/db/src/queries/players.ts**

```typescript
import { getDb } from "../connection";
import { normalizeString, scoreMatch } from "../lib/fuzzy-search";
import type { PlayerSearchResult, Player, PlayerRanks } from "../types";

// Cache all player names for fuzzy search (loaded once, ~46k rows, ~3MB)
let _playerCache: Array<{ id: number; name: string; club: string | null; normalized: string }> | null = null;

function getPlayerCache() {
  if (_playerCache) return _playerCache;
  const db = getDb();
  const rows = db.query("SELECT id, name, club FROM players").all() as Array<{ id: number; name: string; club: string | null }>;
  _playerCache = rows.map((r) => ({ ...r, normalized: normalizeString(r.name) }));
  return _playerCache;
}

export function searchPlayers(query: string, limit = 20): PlayerSearchResult[] {
  if (!query || query.trim().length === 0) return [];

  const db = getDb();
  const cache = getPlayerCache();

  const scored = cache
    .map((row) => ({ ...row, score: scoreMatch(query, row.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Batch-fetch ranks for matched players
  if (scored.length === 0) return [];

  const ids = scored.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const rankRows = db.query(`
    SELECT r.player_id as id,
      (SELECT COUNT(*) + 1 FROM ratings r2 WHERE r2.ordinal > r.ordinal) as globalRank
    FROM ratings r WHERE r.player_id IN (${placeholders})
  `).all(...ids) as Array<{ id: number; globalRank: number }>;

  const rankMap = new Map(rankRows.map((r) => [r.id, r.globalRank]));

  return scored.map(({ score, normalized, ...rest }) => ({
    ...rest,
    globalRank: rankMap.get(rest.id) ?? 0,
  }));
}

export function getPlayer(id: number): Player | null {
  const db = getDb();
  const row = db.query(`
    SELECT id, name, club, photo_url, gender, location, age_group, fpp_pontos
    FROM players WHERE id = ?
  `).get(id) as {
    id: number; name: string; club: string | null; photo_url: string | null;
    gender: string | null; location: string | null; age_group: string | null; fpp_pontos: number | null;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    club: row.club,
    photoUrl: row.photo_url,
    gender: row.gender,
    location: row.location,
    ageGroup: row.age_group,
    fppPontos: row.fpp_pontos,
  };
}

export function getPlayerRanks(id: number): PlayerRanks | null {
  const db = getDb();

  const player = db.query(`
    SELECT p.id, p.gender, p.club, r.ordinal
    FROM players p
    LEFT JOIN ratings r ON r.player_id = p.id
    WHERE p.id = ?
  `).get(id) as { id: number; gender: string | null; club: string | null; ordinal: number | null } | null;

  if (!player || player.ordinal === null) return null;

  const globalRank = db.query(
    "SELECT COUNT(*) + 1 as rank FROM ratings WHERE ordinal > ?"
  ).get(player.ordinal) as { rank: number };

  const globalTotal = db.query("SELECT COUNT(*) as total FROM ratings").get() as { total: number };

  const result: PlayerRanks = {
    global: { rank: globalRank.rank, total: globalTotal.total },
    gender: null,
    club: null,
  };

  if (player.gender) {
    const genderRank = db.query(`
      SELECT COUNT(*) + 1 as rank FROM ratings r
      JOIN players p ON p.id = r.player_id
      WHERE r.ordinal > ? AND p.gender = ?
    `).get(player.ordinal, player.gender) as { rank: number };

    const genderTotal = db.query(`
      SELECT COUNT(*) as total FROM ratings r
      JOIN players p ON p.id = r.player_id WHERE p.gender = ?
    `).get(player.gender) as { total: number };

    result.gender = { rank: genderRank.rank, total: genderTotal.total, label: player.gender };
  }

  if (player.club) {
    const clubRank = db.query(`
      SELECT COUNT(*) + 1 as rank FROM ratings r
      JOIN players p ON p.id = r.player_id
      WHERE r.ordinal > ? AND p.club = ?
    `).get(player.ordinal, player.club) as { rank: number };

    const clubTotal = db.query(`
      SELECT COUNT(*) as total FROM ratings r
      JOIN players p ON p.id = r.player_id WHERE p.club = ?
    `).get(player.club) as { total: number };

    result.club = { rank: clubRank.rank, total: clubTotal.total, label: player.club };
  }

  return result;
}
```

- [ ] **Step 3: Write test for player queries**

Create `packages/db/test/players.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { searchPlayers, getPlayer, getPlayerRanks } from "../src/queries/players";

test("searchPlayers returns results for a common name", () => {
  const results = searchPlayers("silva");
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].name.toLowerCase()).toContain("silva");
  expect(results[0]).toHaveProperty("globalRank");
});

test("searchPlayers handles diacritics", () => {
  const results1 = searchPlayers("joao");
  const results2 = searchPlayers("joão");
  // Both should return results (may not be identical due to scoring)
  expect(results1.length).toBeGreaterThan(0);
  expect(results2.length).toBeGreaterThan(0);
});

test("searchPlayers returns empty for empty query", () => {
  expect(searchPlayers("")).toEqual([]);
  expect(searchPlayers("   ")).toEqual([]);
});

test("getPlayer returns player data", () => {
  // Get any player ID from search
  const searchResults = searchPlayers("silva", 1);
  if (searchResults.length === 0) return; // skip if no data
  const player = getPlayer(searchResults[0].id);
  expect(player).not.toBeNull();
  expect(player!.name).toBeTruthy();
});

test("getPlayer returns null for nonexistent ID", () => {
  expect(getPlayer(999999999)).toBeNull();
});

test("getPlayerRanks returns ranks for rated player", () => {
  // Find a rated player
  const results = searchPlayers("silva", 1);
  if (results.length === 0) return;
  const ranks = getPlayerRanks(results[0].id);
  // May be null if player is unrated
  if (ranks) {
    expect(ranks.global.rank).toBeGreaterThan(0);
    expect(ranks.global.total).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/db/test/players.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/players.ts packages/db/src/lib/fuzzy-search.ts packages/db/test/players.test.ts
git commit -m "feat(db): add player search, detail, and ranking queries"
```

---

### Task 4: Database Package — Match Queries

**Files:**
- Create: `packages/db/src/queries/matches.ts`, `packages/db/test/matches.test.ts`

- [ ] **Step 1: Create packages/db/src/queries/matches.ts**

```typescript
import { getDb } from "../connection";
import type { MatchDetail, MatchPlayerInfo } from "../types";

function parseTournamentIdFromSource(source: string | null): number | null {
  if (!source) return null;
  const match = source.match(/scrape:tournament:(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function parseSets(setsJson: string | null): MatchDetail["sets"] {
  if (!setsJson) return [];
  try {
    const raw = JSON.parse(setsJson);
    return raw.map((s: any) => ({
      setA: s.set_a ?? 0,
      setB: s.set_b ?? 0,
      tieA: s.tie_a ?? -1,
      tieB: s.tie_b ?? -1,
    }));
  } catch {
    return [];
  }
}

function batchGetGenderRanks(playerIds: number[]): Map<number, number | null> {
  if (playerIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = playerIds.map(() => "?").join(",");

  const rows = db.query(`
    SELECT p.id, p.gender, r.ordinal,
      (SELECT COUNT(*) + 1 FROM ratings r2
       JOIN players p2 ON p2.id = r2.player_id
       WHERE r2.ordinal > r.ordinal AND p2.gender = p.gender) as genderRank
    FROM players p
    JOIN ratings r ON r.player_id = p.id
    WHERE p.id IN (${placeholders}) AND p.gender IS NOT NULL AND p.gender != ''
  `).all(...playerIds) as Array<{ id: number; genderRank: number }>;

  const map = new Map<number, number | null>();
  for (const id of playerIds) map.set(id, null);
  for (const row of rows) map.set(row.id, row.genderRank);
  return map;
}

export function getPlayerMatches(
  playerId: number,
  cursor?: string,
  limit = 20
): { matches: MatchDetail[]; nextCursor: string | null } {
  const db = getDb();

  let query = `
    SELECT m.guid, m.tournament_name, m.section_name, m.round_name, m.date_time,
           m.sets_json, m.winner_side, m.source,
           m.side_a_ids, m.side_b_ids, m.side_a_names, m.side_b_names
    FROM matches m
    JOIN match_players mp ON mp.match_guid = m.guid
    WHERE mp.player_id = ?
  `;
  const params: any[] = [playerId];

  if (cursor) {
    const [cursorDate, cursorGuid] = cursor.split("|");
    query += " AND (m.date_time < ? OR (m.date_time = ? AND m.guid < ?))";
    params.push(cursorDate, cursorDate, cursorGuid);
  }

  query += " ORDER BY m.date_time DESC, m.guid DESC LIMIT ?";
  params.push(limit + 1);

  const rows = db.query(query).all(...params) as Array<{
    guid: string; tournament_name: string | null; section_name: string | null;
    round_name: string | null; date_time: string | null; sets_json: string | null;
    winner_side: string | null; source: string | null;
    side_a_ids: string; side_b_ids: string; side_a_names: string | null; side_b_names: string | null;
  }>;

  const hasMore = rows.length > limit;
  const matchRows = hasMore ? rows.slice(0, limit) : rows;

  // Collect all player IDs across all matches for batch rank lookup
  const allPlayerIds = new Set<number>();
  const parsedRows = matchRows.map((row) => {
    const sideAIds: number[] = JSON.parse(row.side_a_ids);
    const sideBIds: number[] = JSON.parse(row.side_b_ids);
    for (const id of [...sideAIds, ...sideBIds]) allPlayerIds.add(id);
    return { ...row, sideAIds, sideBIds };
  });

  const genderRanks = batchGetGenderRanks([...allPlayerIds]);

  const matches: MatchDetail[] = parsedRows.map((row) => {
    const sideANames = (row.side_a_names ?? "").split(" / ");
    const sideBNames = (row.side_b_names ?? "").split(" / ");

    return {
      guid: row.guid,
      tournamentId: parseTournamentIdFromSource(row.source),
      tournamentName: row.tournament_name,
      sectionName: row.section_name,
      roundName: row.round_name,
      dateTime: row.date_time,
      sets: parseSets(row.sets_json),
      winnerSide: row.winner_side,
      sideA: row.sideAIds.map((id: number, i: number) => ({
        id,
        name: sideANames[i] ?? "",
        genderRank: genderRanks.get(id) ?? null,
        categoryRank: null, // section_name is empty in current data
      })),
      sideB: row.sideBIds.map((id: number, i: number) => ({
        id,
        name: sideBNames[i] ?? "",
        genderRank: genderRanks.get(id) ?? null,
        categoryRank: null,
      })),
    };
  });

  const nextCursor = hasMore && matchRows.length > 0
    ? `${matchRows[matchRows.length - 1].dateTime}|${matchRows[matchRows.length - 1].guid}`
    : null;

  return { matches, nextCursor };
}
```

- [ ] **Step 2: Write test for match queries**

Create `packages/db/test/matches.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { getPlayerMatches } from "../src/queries/matches";
import { searchPlayers } from "../src/queries/players";

test("getPlayerMatches returns matches for a known player", () => {
  const players = searchPlayers("silva", 1);
  if (players.length === 0) return;

  const { matches, nextCursor } = getPlayerMatches(players[0].id, undefined, 5);
  expect(matches.length).toBeGreaterThanOrEqual(0);

  if (matches.length > 0) {
    const m = matches[0];
    expect(m.guid).toBeTruthy();
    expect(m.sideA.length).toBeGreaterThan(0);
    expect(m.sideB.length).toBeGreaterThan(0);
    expect(m.sideA[0]).toHaveProperty("id");
    expect(m.sideA[0]).toHaveProperty("name");
  }
});

test("getPlayerMatches supports cursor pagination", () => {
  const players = searchPlayers("silva", 1);
  if (players.length === 0) return;

  const page1 = getPlayerMatches(players[0].id, undefined, 2);
  if (!page1.nextCursor) return;

  const page2 = getPlayerMatches(players[0].id, page1.nextCursor, 2);
  // Page 2 should not repeat page 1 matches
  if (page2.matches.length > 0 && page1.matches.length > 0) {
    expect(page2.matches[0].guid).not.toBe(page1.matches[0].guid);
  }
});

test("getPlayerMatches returns empty for nonexistent player", () => {
  const { matches } = getPlayerMatches(999999999);
  expect(matches).toEqual([]);
});
```

- [ ] **Step 3: Run tests**

```bash
bun test packages/db/test/matches.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/queries/matches.ts packages/db/test/matches.test.ts
git commit -m "feat(db): add player match queries with cursor pagination"
```

---

### Task 5: Database Package — Tournament Queries

**Files:**
- Create: `packages/db/src/queries/tournaments.ts`, `packages/db/test/tournaments.test.ts`

- [ ] **Step 1: Create packages/db/src/queries/tournaments.ts**

```typescript
import { getDb } from "../connection";
import type { Tournament, TournamentDetail, TournamentPlayer } from "../types";

export function getTournaments(page = 1, pageSize = 20): { tournaments: Tournament[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  const total = db.query("SELECT COUNT(*) as total FROM tournaments").get() as { total: number };

  const rows = db.query(`
    SELECT id, name, club, date FROM tournaments
    ORDER BY date DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset) as Tournament[];

  return { tournaments: rows, total: total.total };
}

export function getTournament(id: number): TournamentDetail | null {
  const db = getDb();
  const row = db.query(`
    SELECT id, name, club, date, link_web FROM tournaments WHERE id = ?
  `).get(id) as { id: number; name: string; club: string | null; date: string | null; link_web: string | null } | null;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    club: row.club,
    date: row.date,
    linkWeb: row.link_web,
  };
}

export function getTournamentCategories(tournamentId: number): string[] {
  const db = getDb();

  // Get tournament name to match against matches
  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  if (!tournament) return [];

  // Also try source-based matching
  const rows = db.query(`
    SELECT DISTINCT section_name FROM matches
    WHERE (source = ? OR tournament_name = ?)
    AND section_name IS NOT NULL AND length(section_name) > 0
    ORDER BY section_name
  `).all(`scrape:tournament:${tournamentId}`, tournament.name) as Array<{ section_name: string }>;

  return rows.map((r) => r.section_name);
}

export function getTournamentPlayers(
  tournamentId: number,
  category?: string
): TournamentPlayer[] {
  const db = getDb();

  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  if (!tournament) return [];

  let query = `
    SELECT DISTINCT p.id, p.name, p.gender, r.ordinal
    FROM players p
    JOIN match_players mp ON mp.player_id = p.id
    JOIN matches m ON m.guid = mp.match_guid
    LEFT JOIN ratings r ON r.player_id = p.id
    WHERE (m.source = ? OR m.tournament_name = ?)
  `;
  const params: any[] = [`scrape:tournament:${tournamentId}`, tournament.name];

  if (category) {
    query += " AND m.section_name = ?";
    params.push(category);
  }

  query += " ORDER BY r.ordinal DESC NULLS LAST";

  const rows = db.query(query).all(...params) as Array<{
    id: number; name: string; gender: string | null; ordinal: number | null;
  }>;

  return rows.map((row) => {
    let genderRank: number | null = null;
    if (row.gender && row.ordinal !== null) {
      const rank = db.query(`
        SELECT COUNT(*) + 1 as rank FROM ratings r
        JOIN players p ON p.id = r.player_id
        WHERE r.ordinal > ? AND p.gender = ?
      `).get(row.ordinal, row.gender) as { rank: number };
      genderRank = rank.rank;
    }

    return {
      id: row.id,
      name: row.name,
      genderRank,
      categoryRank: null, // section_name is mostly empty in current data
      ordinal: row.ordinal ?? 0,
    };
  });
}
```

- [ ] **Step 2: Write test for tournament queries**

Create `packages/db/test/tournaments.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { getTournaments, getTournament, getTournamentCategories, getTournamentPlayers } from "../src/queries/tournaments";

test("getTournaments returns paginated results", () => {
  const { tournaments, total } = getTournaments(1, 10);
  expect(total).toBeGreaterThan(0);
  expect(tournaments.length).toBeLessThanOrEqual(10);
  expect(tournaments[0]).toHaveProperty("id");
  expect(tournaments[0]).toHaveProperty("name");
});

test("getTournaments page 2 differs from page 1", () => {
  const page1 = getTournaments(1, 10);
  const page2 = getTournaments(2, 10);
  if (page2.tournaments.length > 0) {
    expect(page2.tournaments[0].id).not.toBe(page1.tournaments[0].id);
  }
});

test("getTournament returns detail for existing tournament", () => {
  const { tournaments } = getTournaments(1, 1);
  if (tournaments.length === 0) return;
  const detail = getTournament(tournaments[0].id);
  expect(detail).not.toBeNull();
  expect(detail!.name).toBeTruthy();
});

test("getTournament returns null for nonexistent", () => {
  expect(getTournament(999999999)).toBeNull();
});

test("getTournamentPlayers returns players for a tournament", () => {
  const { tournaments } = getTournaments(1, 1);
  if (tournaments.length === 0) return;
  const players = getTournamentPlayers(tournaments[0].id);
  // May be empty if tournament has no matches scraped
  expect(Array.isArray(players)).toBe(true);
});
```

- [ ] **Step 3: Run tests**

```bash
bun test packages/db/test/tournaments.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Run all db tests**

```bash
bun test packages/db/test/
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/tournaments.ts packages/db/test/tournaments.test.ts
git commit -m "feat(db): add tournament list, detail, and player queries"
```

---

### Task 6: Next.js App Setup + shadcn/ui

**Files:**
- Create: `packages/web/package.json`, `packages/web/next.config.ts`, `packages/web/tsconfig.json`, `packages/web/tailwind.config.ts`, `packages/web/postcss.config.mjs`, `packages/web/src/app/layout.tsx`, `packages/web/src/app/globals.css`

- [ ] **Step 1: Initialize Next.js in packages/web**

```bash
cd packages/web
bunx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-bun
```

When prompted, accept defaults. This scaffolds the Next.js project.

- [ ] **Step 2: Update packages/web/package.json**

Add workspace dependency and scripts:

```json
{
  "name": "@fpp/web",
  "private": true,
  "scripts": {
    "dev": "bun --bun next dev",
    "build": "bun --bun next build",
    "start": "bun --bun next start"
  },
  "dependencies": {
    "@fpp/db": "workspace:*",
    "next": "^15",
    "react": "^19",
    "react-dom": "^19"
  }
}
```

Keep other dependencies that create-next-app added (tailwindcss, postcss, etc).

- [ ] **Step 3: Update packages/web/next.config.ts for bun:sqlite**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bun:sqlite"],
};

export default nextConfig;
```

- [ ] **Step 4: Initialize shadcn/ui**

```bash
cd packages/web
bunx shadcn@latest init -d
```

Accept defaults (New York style, zinc base color).

- [ ] **Step 5: Add required shadcn components**

```bash
cd packages/web
bunx shadcn@latest add card input badge tabs skeleton button separator
```

- [ ] **Step 6: Verify dev server starts**

```bash
cd packages/web
bun run dev
```

Expected: Server starts on localhost:3000 without errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/
git commit -m "feat(web): scaffold Next.js app with shadcn/ui and tailwind"
```

---

### Task 7: Navigation + Layout

**Files:**
- Create: `packages/web/src/components/nav.tsx`
- Modify: `packages/web/src/app/layout.tsx`, `packages/web/src/app/page.tsx`

- [ ] **Step 1: Create packages/web/src/components/nav.tsx**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/players", label: "Players" },
  { href: "/tournaments", label: "Tournaments" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background sm:static sm:border-b sm:border-t-0">
      <div className="mx-auto flex max-w-2xl">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
              pathname.startsWith(tab.href)
                ? "text-foreground border-b-2 border-foreground sm:border-b-0 sm:border-t-2"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Update packages/web/src/app/layout.tsx**

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FPP Players",
  description: "Padel player rankings and match history",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex min-h-screen flex-col">
          <Nav />
          <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-20 pt-4 sm:pb-4">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Update packages/web/src/app/page.tsx to redirect**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/players");
}
```

- [ ] **Step 4: Verify layout renders**

```bash
cd packages/web && bun run dev
```

Visit `http://localhost:3000` — should redirect to `/players` and show nav bar.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/nav.tsx packages/web/src/app/layout.tsx packages/web/src/app/page.tsx
git commit -m "feat(web): add navigation layout with bottom tab bar"
```

---

### Task 8: Player Search Page

**Files:**
- Create: `packages/web/src/app/players/page.tsx`, `packages/web/src/app/api/players/search/route.ts`, `packages/web/src/components/player-card.tsx`, `packages/web/src/components/rank-badge.tsx`

- [ ] **Step 1: Create packages/web/src/components/rank-badge.tsx**

```tsx
interface RankBadgeProps {
  rank: number | null;
  label?: string;
  className?: string;
}

export function RankBadge({ rank, label, className = "" }: RankBadgeProps) {
  if (rank === null) return null;
  return (
    <span className={`inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground ${className}`}>
      #{rank}{label ? ` ${label}` : ""}
    </span>
  );
}
```

- [ ] **Step 2: Create packages/web/src/components/player-card.tsx**

```tsx
import Link from "next/link";
import { RankBadge } from "./rank-badge";

interface PlayerCardProps {
  id: number;
  name: string;
  club: string | null;
  globalRank: number;
}

export function PlayerCard({ id, name, club, globalRank }: PlayerCardProps) {
  return (
    <Link href={`/players/${id}`} className="block">
      <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          {club && <p className="truncate text-sm text-muted-foreground">{club}</p>}
        </div>
        <RankBadge rank={globalRank} className="ml-2 shrink-0" />
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Create search API route**

Create `packages/web/src/app/api/players/search/route.ts`:

```typescript
import { searchPlayers } from "@fpp/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const results = searchPlayers(query, 20);
  return NextResponse.json(results);
}
```

- [ ] **Step 4: Create player search page**

Create `packages/web/src/app/players/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { PlayerCard } from "@/components/player-card";
import { Skeleton } from "@/components/ui/skeleton";

interface PlayerResult {
  id: number;
  name: string;
  club: string | null;
  globalRank: number;
}

export default function PlayersPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search players by name..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="text-base"
        autoFocus
      />
      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}
      {!loading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((player) => (
            <PlayerCard key={player.id} {...player} />
          ))}
        </div>
      )}
      {!loading && query.trim() && results.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">No players found</p>
      )}
      {!query.trim() && !loading && (
        <p className="py-8 text-center text-muted-foreground">
          Type a name to search players
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify search page works**

```bash
cd packages/web && bun run dev
```

Visit `http://localhost:3000/players`, type "silva" — should see player results.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/players/page.tsx packages/web/src/app/api/players/search/route.ts packages/web/src/components/player-card.tsx packages/web/src/components/rank-badge.tsx
git commit -m "feat(web): add player search page with fuzzy matching"
```

---

### Task 9: Player Profile Page

**Files:**
- Create: `packages/web/src/app/players/[id]/page.tsx`, `packages/web/src/components/match-card.tsx`, `packages/web/src/components/score-display.tsx`, `packages/web/src/components/infinite-scroll.tsx`, `packages/web/src/app/api/matches/[playerId]/route.ts`

- [ ] **Step 1: Create packages/web/src/components/score-display.tsx**

```tsx
interface ScoreDisplayProps {
  sets: Array<{ setA: number; setB: number; tieA: number; tieB: number }>;
  winnerSide: string | null;
}

export function ScoreDisplay({ sets, winnerSide }: ScoreDisplayProps) {
  if (sets.length === 0) return <span className="text-sm text-muted-foreground">No score</span>;

  return (
    <div className="flex gap-2">
      {sets.map((set, i) => (
        <div key={i} className="text-center text-sm">
          <span className={winnerSide === "a" ? "font-semibold" : ""}>{set.setA}</span>
          <span className="text-muted-foreground">-</span>
          <span className={winnerSide === "b" ? "font-semibold" : ""}>{set.setB}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create packages/web/src/components/match-card.tsx**

```tsx
import Link from "next/link";
import { RankBadge } from "./rank-badge";
import { ScoreDisplay } from "./score-display";

// Type-only imports are safe in client components (erased at build time)
import type { MatchDetail, MatchPlayerInfo } from "@fpp/db";

function PlayerName({ player, isWinnerSide }: { player: MatchPlayerInfo; isWinnerSide: boolean }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Link
        href={`/players/${player.id}`}
        className={`hover:underline ${isWinnerSide ? "font-semibold" : ""}`}
      >
        {player.name}
      </Link>
      <RankBadge rank={player.genderRank} />
      <RankBadge rank={player.categoryRank} label="cat" />
    </div>
  );
}

function SidePlayers({ players, isWinnerSide }: { players: MatchPlayerInfo[]; isWinnerSide: boolean }) {
  return (
    <div className="space-y-0.5">
      {players.map((p) => (
        <PlayerName key={p.id} player={p} isWinnerSide={isWinnerSide} />
      ))}
    </div>
  );
}

interface MatchCardProps {
  match: MatchDetail;
  currentPlayerId: number;
}

export function MatchCard({ match, currentPlayerId }: MatchCardProps) {
  const isOnSideA = match.sideA.some((p) => p.id === currentPlayerId);
  const playerWon = (isOnSideA && match.winnerSide === "a") || (!isOnSideA && match.winnerSide === "b");
  const hasResult = match.winnerSide !== null;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          {match.tournamentId ? (
            <Link href={`/tournaments/${match.tournamentId}`} className="text-sm text-muted-foreground hover:underline truncate block">
              {match.tournamentName}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground truncate block">{match.tournamentName}</span>
          )}
        </div>
        {hasResult && (
          <span className={`shrink-0 ml-2 rounded-md px-1.5 py-0.5 text-xs font-medium ${
            playerWon ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}>
            {playerWon ? "W" : "L"}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <SidePlayers players={match.sideA} isWinnerSide={match.winnerSide === "a"} />
        </div>
        <div className="shrink-0 text-muted-foreground text-xs">vs</div>
        <div className="flex-1 min-w-0">
          <SidePlayers players={match.sideB} isWinnerSide={match.winnerSide === "b"} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <ScoreDisplay sets={match.sets} winnerSide={match.winnerSide} />
        {match.dateTime && <span>{match.dateTime}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create packages/web/src/components/infinite-scroll.tsx**

```tsx
"use client";

import { useEffect, useRef } from "react";

interface InfiniteScrollProps {
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
}

export function InfiniteScroll({ onLoadMore, hasMore, loading }: InfiniteScrollProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    const sentinel = sentinelRef.current;
    if (sentinel) observer.observe(sentinel);

    return () => {
      if (sentinel) observer.unobserve(sentinel);
    };
  }, [hasMore, loading, onLoadMore]);

  return (
    <div ref={sentinelRef} className="py-4 text-center">
      {loading && <span className="text-sm text-muted-foreground">Loading...</span>}
    </div>
  );
}
```

- [ ] **Step 4: Create match API route for infinite scroll**

Create `packages/web/src/app/api/matches/[playerId]/route.ts`:

```typescript
import { getPlayerMatches } from "@fpp/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const result = getPlayerMatches(parseInt(playerId), cursor, 20);
  return NextResponse.json(result);
}
```

- [ ] **Step 5: Create player profile page**

Create `packages/web/src/app/players/[id]/page.tsx`:

```tsx
import { getPlayer, getPlayerRanks } from "@fpp/db";
import { notFound } from "next/navigation";
import { RankBadge } from "@/components/rank-badge";
import { PlayerMatches } from "./matches";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = getPlayer(parseInt(id));
  if (!player) notFound();

  const ranks = getPlayerRanks(player.id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        {player.photoUrl && (
          <img
            src={player.photoUrl}
            alt={player.name}
            className="h-16 w-16 rounded-full object-cover"
          />
        )}
        <div>
          <h1 className="text-xl font-bold">{player.name}</h1>
          {player.club && <p className="text-sm text-muted-foreground">{player.club}</p>}
          {player.location && <p className="text-sm text-muted-foreground">{player.location}</p>}
        </div>
      </div>

      {/* Rankings */}
      {ranks && (
        <div className="rounded-lg border p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Rankings</h2>
          <div className="space-y-1">
            <p className="text-sm">
              <span className="font-semibold">#{ranks.global.rank}</span>
              <span className="text-muted-foreground"> of {ranks.global.total.toLocaleString()} players</span>
            </p>
            {ranks.gender && (
              <p className="text-sm">
                <span className="font-semibold">#{ranks.gender.rank}</span>
                <span className="text-muted-foreground"> of {ranks.gender.total.toLocaleString()} {ranks.gender.label}</span>
              </p>
            )}
            {ranks.club && (
              <p className="text-sm">
                <span className="font-semibold">#{ranks.club.rank}</span>
                <span className="text-muted-foreground"> of {ranks.club.total.toLocaleString()} in {ranks.club.label}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Matches */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Match History</h2>
        <PlayerMatches playerId={player.id} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create client-side match list component**

Create `packages/web/src/app/players/[id]/matches.tsx`:

```tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { MatchCard } from "@/components/match-card";
import { InfiniteScroll } from "@/components/infinite-scroll";
import type { MatchDetail } from "@fpp/db";

interface PlayerMatchesProps {
  playerId: number;
}

export function PlayerMatches({ playerId }: PlayerMatchesProps) {
  const [matches, setMatches] = useState<MatchDetail[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  const loadMore = useCallback(async () => {
    if (loading || cursor === null) return;
    setLoading(true);
    try {
      const url = `/api/matches/${playerId}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      setMatches((prev) => [...prev, ...data.matches]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [playerId, cursor, loading]);

  // Trigger initial load via useEffect
  useEffect(() => {
    if (initialLoad) {
      loadMore();
    }
  }, [initialLoad, loadMore]);

  if (!loading && matches.length === 0 && !initialLoad) {
    return <p className="py-4 text-center text-muted-foreground">No matches found</p>;
  }

  return (
    <div className="space-y-2">
      {matches.map((match) => (
        <MatchCard key={match.guid} match={match} currentPlayerId={playerId} />
      ))}
      <InfiniteScroll onLoadMore={loadMore} hasMore={cursor !== null} loading={loading} />
    </div>
  );
}
```

- [ ] **Step 7: Verify player profile page**

```bash
cd packages/web && bun run dev
```

Search for a player, click on them — should see profile with rankings and match list with infinite scroll.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app/players/\[id\]/ packages/web/src/app/api/matches/ packages/web/src/components/match-card.tsx packages/web/src/components/score-display.tsx packages/web/src/components/infinite-scroll.tsx
git commit -m "feat(web): add player profile page with rankings and match history"
```

---

### Task 10: Tournament List Page

**Files:**
- Create: `packages/web/src/app/tournaments/page.tsx`

- [ ] **Step 1: Create tournament list page**

Create `packages/web/src/app/tournaments/page.tsx`:

```tsx
import Link from "next/link";
import { getTournaments } from "@fpp/db";
import { Button } from "@/components/ui/button";

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1"));
  const pageSize = 30;
  const { tournaments, total } = getTournaments(page, pageSize);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Tournaments</h1>

      <div className="space-y-2">
        {tournaments.map((t) => (
          <Link key={t.id} href={`/tournaments/${t.id}`} className="block">
            <div className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
              <p className="font-medium">{t.name}</p>
              <div className="flex gap-2 text-sm text-muted-foreground">
                {t.club && <span>{t.club}</span>}
                {t.club && t.date && <span>·</span>}
                {t.date && <span>{t.date}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-4">
          {page > 1 && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/tournaments?page=${page - 1}`}>Previous</Link>
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/tournaments?page=${page + 1}`}>Next</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify tournament list**

```bash
cd packages/web && bun run dev
```

Visit `/tournaments` — should show paginated list of tournaments.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/tournaments/page.tsx
git commit -m "feat(web): add tournament list page with pagination"
```

---

### Task 11: Tournament Detail Page

**Files:**
- Create: `packages/web/src/app/tournaments/[id]/page.tsx`

- [ ] **Step 1: Create tournament detail page**

Create `packages/web/src/app/tournaments/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { getTournament, getTournamentCategories, getTournamentPlayers } from "@fpp/db";
import { notFound } from "next/navigation";
import { RankBadge } from "@/components/rank-badge";
import { CategoryFilter } from "./category-filter";

export default async function TournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { id } = await params;
  const { category } = await searchParams;

  const tournament = getTournament(parseInt(id));
  if (!tournament) notFound();

  const categories = getTournamentCategories(tournament.id);
  const players = getTournamentPlayers(tournament.id, category);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">{tournament.name}</h1>
        <div className="text-sm text-muted-foreground">
          {tournament.club && <span>{tournament.club}</span>}
          {tournament.club && tournament.date && <span> · </span>}
          {tournament.date && <span>{tournament.date}</span>}
        </div>
      </div>

      {/* Category filter */}
      {categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          selected={category ?? null}
          tournamentId={tournament.id}
        />
      )}

      {/* Player list */}
      <div className="space-y-1">
        {players.length > 0 ? (
          players.map((player, idx) => (
            <Link key={player.id} href={`/players/${player.id}`} className="block">
              <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-8 text-right text-sm text-muted-foreground">{idx + 1}.</span>
                  <span className="truncate font-medium">{player.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <RankBadge rank={player.genderRank} label="gender" />
                  <RankBadge rank={player.categoryRank} label="cat" />
                </div>
              </div>
            </Link>
          ))
        ) : (
          <p className="py-8 text-center text-muted-foreground">No players found</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create category filter component**

Create `packages/web/src/app/tournaments/[id]/category-filter.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";

interface CategoryFilterProps {
  categories: string[];
  selected: string | null;
  tournamentId: number;
}

export function CategoryFilter({ categories, selected, tournamentId }: CategoryFilterProps) {
  const router = useRouter();

  function handleChange(category: string | null) {
    const url = category
      ? `/tournaments/${tournamentId}?category=${encodeURIComponent(category)}`
      : `/tournaments/${tournamentId}`;
    router.push(url);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => handleChange(null)}
        className={`rounded-full px-3 py-1 text-sm transition-colors ${
          !selected ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => handleChange(cat)}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${
            selected === cat ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify tournament detail page**

```bash
cd packages/web && bun run dev
```

Click a tournament from the list — should show header, category filter (if categories exist), and player list sorted by global ranking.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/tournaments/\[id\]/
git commit -m "feat(web): add tournament detail page with category filter"
```

---

### Task 12: Final Integration Test + Polish

- [ ] **Step 1: Run all db tests**

```bash
bun test packages/db/test/
```

Expected: All tests pass.

- [ ] **Step 2: Verify full flow end-to-end**

```bash
cd packages/web && bun run dev
```

Test manually:
1. `/players` — search "silva", see results with ranks
2. Click a player → profile with rankings + match history scrolling
3. `/tournaments` — paginated list, prev/next works
4. Click a tournament → see players sorted by ranking
5. Click player name in match card → navigates to that player's profile
6. Bottom nav switches between Players and Tournaments

- [ ] **Step 3: Verify scraper still works**

```bash
bun packages/scraper/src/cli.ts stats
```

Expected: Same output as before.

- [ ] **Step 4: Commit any polish fixes**

```bash
git add -A
git commit -m "fix(web): integration polish and fixes"
```
