# Upcoming Tournament Matches — Design Spec

**Date**: 2026-03-21
**Status**: Draft

## Goal

Scrape tournament match schedules and draw brackets from fpp.tiepadel.com, store in existing DB alongside completed matches, enrich player data (license numbers, full names), and automatically transition upcoming matches to rated results when scores arrive.

## Data Sources

### 1. Matches Page (primary)
- **URL**: `https://fpp.tiepadel.com/Tournaments/{slug}/Matches`
- **Tech**: ASP.NET Telerik RadGrid, postback-based date tabs and pagination
- **Provides**: Player names + IDs (via `Dashboard.aspx?id=X` links), category, subcategory, time, court, scores (if completed)
- **Pagination**: 12 matches per page, up to 7 pages per date tab
- **Date tabs**: One per tournament day (e.g. "qua, 18 mar", "sáb, 21 mar")

### 2. Draws Page (enrichment + round structure)
- **URL**: `https://fpp.tiepadel.com/Tournaments/{slug}/Draws`
- **Tech**: ASP.NET with category dropdown and sub-draw tabs (QP/Quali)
- **Provides**: Full bracket structure with round positions, license numbers, ratings (first round only), seedings, schedule info for unplayed matches, byes
- **No player IDs** — player names are plain text spans, no Dashboard links
- **Round numbering**: Descending (6=R32, 5=R16, 4=QF, 3=SF, 2=F)
- **Category dropdown**: Numeric IDs per category (e.g. 157617 = Masculinos 1)

### Cross-referencing strategy

Match players between sources by **name** (Matches page names are canonical since they have IDs). Use Draws page to enrich with:
- **Round name** (R32, R16, QF, SF, F) — inferred from round number and draw size
- **License number** — available in first-round entries, stored to `players.license_number`
- **Seeding** — e.g. "(1)", "(8)", "WC"
- **Draw position** — bracket position for ordering

## Schema Changes

### `matches` table — new columns

```sql
ALTER TABLE matches ADD COLUMN tournament_id INTEGER REFERENCES tournaments(id);
ALTER TABLE matches ADD COLUMN court TEXT;
ALTER TABLE matches ADD COLUMN category TEXT;      -- e.g. "M6", "F1", "Mistos 3"
ALTER TABLE matches ADD COLUMN subcategory TEXT;    -- e.g. "QP", "Quali"
```

### New indexes

```sql
CREATE INDEX IF NOT EXISTS idx_matches_tournament_id ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_category ON matches(category);
```

Already added in this session (for query performance):
```sql
CREATE INDEX IF NOT EXISTS idx_matches_source ON matches(source);
CREATE INDEX IF NOT EXISTS idx_matches_tournament_name ON matches(tournament_name);
CREATE INDEX IF NOT EXISTS idx_match_players_guid ON match_players(match_guid);
CREATE INDEX IF NOT EXISTS idx_players_gender ON players(gender);
```

### `players` table — enrichment

- `license_number` column already exists, currently unpopulated
- Populate from Draws page first-round data by matching player names to IDs from Matches page

## GUID Strategy

Deterministic GUID for scheduled matches:

```
schedule:{tournamentId}:{sortedAllPlayerIds}
```

Example: `schedule:23261:98573-208692-254197-213445`

- Sort all player IDs (both sides combined) to ensure uniqueness regardless of side ordering
- No collision with real UUIDs from the news feed API (different format)
- Same match re-scraped produces same GUID — enables idempotent upserts

## Dedup Strategy

Before inserting a match:

1. Check if GUID already exists (re-scrape of same scheduled match)
   - If upcoming → upcoming: skip (no change)
   - If upcoming → now has result: **update** `sets_json`, `winner_side`, `date_time`
2. Check if a match with same player IDs + same tournament exists from news feed source (`source = "scrape:tournament:X"`)
   - If found: enrich existing record with `court`, `category`, `subcategory`, `tournament_id` — do NOT duplicate

## Category Parsing

Input: `"Masculinos 6 - M6-QP"` or `"Femininos 5 - F5-Quali"`

```
/^((?:Masculinos|Femininos|Mistos)\s+\d+)\s*-\s*(\w+)-(.+)$/
```

- Full name: `"Masculinos 6"` (stored in `section_name` for backward compat)
- Category code: `"M6"` → stored in `category`
- Subcategory: `"QP"` or `"Quali"` → stored in `subcategory`

## Round Name Inference

From Draws page round numbers (descending):

| Draw size | Round numbers → labels |
|-----------|----------------------|
| 32 teams  | 6=R32, 5=R16, 4=QF, 3=SF, 2=F |
| 16 teams  | 5=R16, 4=QF, 3=SF, 2=F |
| 8 teams   | 4=QF, 3=SF, 2=F |
| 4 teams   | 3=SF, 2=F |

Stored in `round_name` column (already exists, currently unpopulated).

## Date Handling

Matches page shows relative dates: `"sáb, 21 mar"`.

Resolution: Use tournament year from `tournaments.date` or current year. Parse Portuguese day/month names to ISO date. Combine with time field for full `date_time`.

Portuguese month map: jan=01, fev=02, mar=03, abr=04, mai=05, jun=06, jul=07, ago=08, set=09, out=10, nov=11, dez=12.

## Missing Players

When a player ID from the Matches page is not found in `players` table:

1. Insert with `id` and `name` (full name from Matches page)
2. Leave other fields NULL for later profile enrichment via the mobile API
3. Log as new player for review

## Scraping Flow

### Step 1: Scrape Matches Page

For each date tab:
1. Click date tab (postback)
2. For each pagination page:
   - Extract match rows: category, time, court, players (id + name), result
3. Collect all matches with player IDs

### Step 2: Scrape Draws Page

For each category in dropdown:
1. Select category (postback)
2. For each sub-draw tab (QP, Quali):
   - Extract bracket: round numbers, player names, license numbers, seedings, scores, schedule info
3. Map round numbers to round names based on draw size

### Step 3: Cross-reference

1. For each Draws entry with a license number:
   - Find matching player by name in Matches page data (which has IDs)
   - Update `players.license_number` in DB
2. For each match from Matches page:
   - Find corresponding bracket position in Draws data by matching player names
   - Enrich with `round_name`

### Step 4: Store

1. Insert missing players
2. Upsert matches (dedup as described above)
3. Insert `match_players` records
4. Update `tournament.matches_synced_at`

## Source Tag

```
source = "schedule:tournament:{tournamentId}"
```

Distinguishes from existing `"scrape:tournament:{id}"` (news feed source).

## Re-scraping & Result Updates

When re-running the scraper on the same tournament:

1. Previously upcoming match now has result on Matches page:
   - Parse scores from result string (e.g. `"6-4  6-3"` → `[{set_a:6,set_b:4},{set_a:6,set_b:3}]`)
   - Determine winner side
   - Update existing record: `sets_json`, `winner_side`, `date_time`
2. Ratings pipeline (`calculate-ratings.ts`) already filters `WHERE winner_side IS NOT NULL`
   - Newly completed matches automatically included on next rating calculation

## CLI Integration

Add to `packages/scraper/src/cli.ts`:

```
bun src/cli.ts schedule <tournament-id>    # scrape schedule for a tournament
bun src/cli.ts schedule <tournament-url>   # scrape by URL
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/scraper/src/scrape-upcoming-matches.ts` | Rewrite (prototype exists) |
| `packages/scraper/src/scrape-draws.ts` | Create — Draws page scraper |
| `packages/scraper/src/db.ts` | Add new columns + indexes in migrate() |
| `packages/scraper/src/cli.ts` | Add `schedule` command |
| `packages/db/src/queries/matches.ts` | Add query for upcoming matches |
| `packages/db/src/queries/tournaments.ts` | Add upcoming matches to tournament page |
| `packages/web/src/app/tournaments/[id]/page.tsx` | Display upcoming matches section |

## Out of Scope

- Automatic periodic re-scraping (cron) — manual CLI for now
- Notifications for upcoming matches
- Live score updates
- Draws page visual bracket display in web UI
