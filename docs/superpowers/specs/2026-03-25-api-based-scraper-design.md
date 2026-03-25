# API-Based Scraper: Replace Playwright with TieSports REST API

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Scraper, DB schema, DB queries, Web layer

## Problem

The scraper has two critical issues:

1. **Discovery bug**: Tournament discovery uses the FPP news feed (`get_news_by_codtou_header`), which returns empty for tournaments with no completed matches. Tournament 23404 ("XII Open PSC by Aguas do Caramulo") was skipped despite being a valid Padel tournament — the API confirms it exists via `get_tournament`.

2. **Playwright fragility**: The draws/schedule scraping relies on headless Chromium to parse HTML. This causes memory issues (browser recycled every 5 tournaments), timeout failures (30s per step), and breaks when the site changes. Meanwhile, all the same data is available via structured JSON APIs that we aren't using.

## Solution

Replace all Playwright and news feed scraping with TieSports REST API calls. Add `tournament_players` table and `category_code` normalization. Update web layer to display richer tournament data.

## API Endpoints (New)

All endpoints use base URL `https://api.tiesports.com`, token auth, JSON responses.

### `get_matches` — Structured draw data
```
GET /tournaments.asmx/get_matches?tournament_id={id}&section_id={sid}&round=0&count_items=0
```
- `section_id=0` returns all sections
- Response: `{sections: [{id, name}], rounds: [{id, name, matches: [Match]}]}`
- Each match has: GUID, side_a/side_b players (id, name, photo), sets, winner, infos (section name, round, date/time, court)
- **Replaces**: Playwright draws scraping + news feed match import

### `get_players_by_section` — Player pairs per category
```
GET /tournaments.asmx/get_players_by_section?section_id={sid}&count_items={offset}
```
- Response: `{list: [{row_title, players: [{id, name, photo, national_id, age_group, ranking}], club, ranking, age_group}]}`
- Players grouped in pairs for doubles
- **New capability**: not scraped today

### `get_homepage_matches` — Upcoming/completed matches
```
GET /tournaments.asmx/get_homepage_matches?tournament_id={id}&count_items={offset}&flag={flag}
```
- `flag=proximos` for upcoming, `flag=ultimos` for completed, empty for both
- **Replaces**: `scrape-upcoming-matches.ts`

### `get_search_tournaments_v2` — Search tournaments by name
```
GET /tournaments.asmx/get_search_tournaments_v2?search_type=2&search_by_name={q}&lat=0&lng=0&distance_km=100&filter_date=&count_tournaments={offset}&country_id=0&city_id=0&age_group_id=0&categories=
```
- **New capability**: targeted tournament search

### `get_tournament` — Tournament detail (already used for enrichment)
```
GET /tournaments.asmx/get_tournament?tournament_id={id}
```
- Works for tournaments with zero matches (fixes discovery bug)
- Nonexistent IDs return `{status: 0}`
- **New use**: primary discovery mechanism

## Data Model Changes

### New table: `tournament_players`

```sql
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
);
CREATE INDEX idx_tournament_players_tournament ON tournament_players(tournament_id, category_code);
```

Note: `category_code` is `NOT NULL DEFAULT 'UNKNOWN'` to prevent NULL composite key issues in SQLite. `section_id` stores the API section ID for efficient re-fetching without re-parsing names.

### New column on `matches`

```sql
ALTER TABLE matches ADD COLUMN category_code TEXT;
ALTER TABLE matches ADD COLUMN section_id INTEGER;
CREATE INDEX idx_matches_category_code ON matches(category_code);
```

`section_id` stores the API section ID for the match, enabling efficient re-fetching per section.

### Category code system

Derived from API section names. Stored as a text code, not FK-enforced.

**Open categories** (level 1-6):
- `"Masculinos 5"` → `M5`
- `"Femininos 4"` → `F4`
- `"Mix 3"` / `"Mistos 3"` → `MX3`

**Veterans** (age group):
- `"Masculinos Veteranos +45"` → `M+45`
- `"Femininos +50"` → `F+50`

**Youth**:
- `"Masculinos Sub-14"` → `M-SUB14`
- `"Femininos Sub-12"` → `F-SUB12`

**Unknown**: if parsing fails, `category_code = 'UNKNOWN'`, raw text preserved in `category` column.

### Backfill

Existing matches with `category` text column get `category_code` populated by running the parser on existing data during migration. The parser must handle both formats: API section names (e.g. "Masculinos 5") and existing Playwright-scraped values (e.g. "M5-Quali", "Quadro Principal M5"). After backfill, all queries should use `tournament_id` for joins instead of `tournament_name`.

## Scraper Architecture

### Loop 1: Discovery + Metadata (60min interval)

**Incremental discovery:**
1. Get `max(id)` from `tournaments` table
2. Check IDs above max via `get_tournament(id)`, batched with concurrency cap (5 parallel)
3. If response has `obj.id` → insert tournament + metadata (name, club, sport, location, cover, link_web)
4. If `{status: 0}` → ID doesn't exist, increment consecutive-miss counter
5. Stop scanning after 50 consecutive misses (IDs are not contiguous — gaps are normal)
6. Skip non-Padel tournaments (check `info_texts` for Sport)
7. On API errors: retry with exponential backoff (1s, 2s, 4s), max 3 retries per ID

**Gap rescan** (every 24h):
1. Find gaps in known ID range (IDs not in DB)
2. Check each via `get_tournament(id)`
3. Insert any discovered tournaments

### Loop 2: Match + Player Sync (60min interval, staggered +5min)

For each tournament (prioritize recent/active, use cursor tracking):
1. Call `get_matches(tournament_id, section_id=0)` → all sections + rounds + matches
2. For each section:
   - Parse section name → derive `category_code`
   - Upsert matches: use API match GUID (the `id` field from `get_matches` response) as primary key. Note: these GUIDs differ from the news feed `UIDNEW` values, so existing matches imported via news feed will not be overwritten — they coexist as separate rows. Deduplication across sources is by `(tournament_id, side_a_ids, side_b_ids, date_time)` if needed later.
   - Populate: `tournament_id`, `category_code`, `category` (raw section name), `section_name` (round), `side_a/b_ids`, `side_a/b_names`, `sets_json`, `winner_side`, `date_time`, `court`
   - Upsert players: `INSERT OR IGNORE INTO players (id, name)`
   - Upsert match_players: join table
3. Call `get_players_by_section(section_id)` for each section
   - Upsert `tournament_players`: player_id, tournament_id, category_code, partner_id
   - Update player license_number from `national_id` field
4. Mark tournament synced with timestamp cursor

### Rate Limiting & Error Handling

- Max 5 concurrent API calls (down from 20 in old scanner)
- 200ms delay between batches
- Retry with exponential backoff: 1s, 2s, 4s (max 3 retries)
- On persistent failure (3 retries exhausted): log error, skip tournament, record in `sync_cursors` with backoff schedule (reuse existing `recordScrapeFailure`)
- On HTTP 429: pause all requests for 60s

### Loop 3: Enrichment (30min interval, unchanged)

Batch-enrich player profiles from `get_profile` API. No changes.

## API Client Changes (`api.ts`)

### New functions

```typescript
getTournamentDraws(tournamentId: number, sectionId?: number): Promise<ApiDrawsResponse>
getSectionPlayers(sectionId: number, offset?: number): Promise<ApiPlayerEntriesResponse>
getUpcomingMatches(tournamentId: number): Promise<{matches: ApiMatch[], hasMore: boolean}>
searchTournaments(query: string, offset?: number): Promise<ApiTournament[]>
```

### Removed functions

- `getTournamentMatches` — replaced by `getTournamentDraws`

### New types (`types.ts`)

```typescript
interface ApiSection { id: number; name: string }
interface ApiRound { id: number; name: string; matches: ApiMatch[] }
interface ApiDrawsResponse { sections: ApiSection[]; rounds: ApiRound[]; web_url: string }
interface ApiSectionPlayer { id: number; name: string; photo: string; national_id: string; age_group: string; ranking: string }
interface ApiPlayerEntry { row_title: string; players: ApiSectionPlayer[]; national_id: string; club: string; ranking: string; age_group: string }
interface ApiPlayerEntriesResponse { list: ApiPlayerEntry[] }
```

## DB Query Changes (`@fpp/db`)

### Updated queries

**`getTournamentCategories(tournamentId)`**
- Query distinct `category_code` from matches + tournament_players for a tournament
- Return: `[{code: "M5", name: "Masculinos 5", matchCount: 12, playerCount: 25}]`

**`getTournamentMatchesByCategory(tournamentId, categoryCode)`**
- Filter by `category_code` instead of text `category`
- Include round info from `section_name`
- Split results: upcoming (winner_side IS NULL) vs completed (winner_side IS NOT NULL)

**`getTournamentPlayersByCategory(tournamentId, categoryCode, page)`**
- Join `tournament_players` + `players` + `ratings`
- Return player pairs (player + partner), club, rating, rank
- Paginated

**`getUpcomingMatches(playerId)`**
- Use `tournament_players` to find active tournaments
- Return scheduled matches across all tournaments

## Web Layer Changes (`@fpp/web`)

### Tournament page (`/tournaments/[id]`)

- Category tabs/filter derived from `getTournamentCategories`
- Per category view:
  - Draw/bracket: rounds → matches (from `section_name`: R32, QF, SF, F, Grupo A, etc.)
  - Player list with ratings and clubs
  - Upcoming matches with dates/times/courts
- Completed matches with scores

### Player page (`/players/[id]`)

- Upcoming matches section from scheduled tournament matches
- Tournament history showing categories played

### API routes

- Updated to accept `category_code` parameter instead of text `category`

## Files to Delete

| File | Reason |
|------|--------|
| `scrape-matches-page.ts` | Replaced by `get_matches` API |
| `scrape-matches-page.test.ts` | Tests for deleted file |
| `scrape-draws-page.ts` | Replaced by `get_matches` API |
| `scrape-draws-page.test.ts` | Tests for deleted file |
| `store-schedule.ts` | Replaced by `get_matches` API |
| `store-schedule.test.ts` | Tests for deleted file |
| `scrape-upcoming-matches.ts` | Replaced by `get_homepage_matches` |
| `scrape-all-tournaments.ts` | Replaced by `get_matches` API |
| `find-tournaments.ts` | Replaced by `get_tournament` discovery |
| `import-matches.ts` | Superseded |

## New Files

| File | Purpose |
|------|---------|
| `parse-category.ts` | Category normalization: "Masculinos 5" → `M5` |
| `parse-category.test.ts` | Tests for all category patterns |
| `sync-tournaments.ts` | Discovery + match/player sync logic |
| `sync-tournaments.test.ts` | Tests for sync logic |

## Files to Update

| File | Changes |
|------|---------|
| `api.ts` | New API functions, remove `getTournamentMatches` |
| `types.ts` | New types for sections, rounds, player entries |
| `db.ts` | Migration: `tournament_players` table, `category_code` column, backfill |
| `daemon.ts` | Rewrite loops: remove Playwright, use API sync |
| `cli.ts` | Update commands to match new architecture |
| `skip-list.ts` | Remove (was for Playwright failures) |
| `find-tournaments.test.ts` | Update: failing tests should now pass |
| `api.test.ts` | Add tests for new API functions |
| `packages/db/src/queries/tournaments.ts` | Updated queries for category_code, tournament_players |
| `packages/web/src/app/tournaments/[id]/page.tsx` | Category tabs, draw view, player list |
| `packages/web/src/app/players/[id]/page.tsx` | Upcoming matches section |

## Dependencies

### Remove
- `playwright` or `playwright-core` from `packages/scraper/package.json`

### No new dependencies needed
- All API calls use built-in `fetch`
- SQLite via `bun:sqlite`

## Testing Strategy

1. **`parse-category.test.ts`**: Unit tests for all category patterns (M1-M6, F1-F6, MX1-MX6, veterans, youth, edge cases)
2. **`api.test.ts`**: Integration tests hitting real TieSports API for new endpoints
3. **`sync-tournaments.test.ts`**: Test discovery logic (tournament 23404 must be found), match upsert, player sync
4. **`find-tournaments.test.ts`**: Existing failing tests should pass after fix
5. **`packages/db/test/`**: Query tests for new tournament_players joins and category_code filters
