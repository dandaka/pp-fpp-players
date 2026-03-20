# FPP Players Frontend — Design Spec

## Overview

Mobile-first web frontend for browsing padel player rankings, match history, and tournaments. Built with Next.js + shadcn/ui in a Bun monorepo alongside the existing scraper.

## Monorepo Structure

```
pp-fpp-players/
  padel.db                    # stays at root, not moved
  packages/
    db/                       # shared DB access + types + query functions
      package.json
      src/
        index.ts              # re-exports
        connection.ts         # bun:sqlite connection to padel.db
        types.ts              # shared TypeScript types
        queries/
          players.ts          # searchPlayers, getPlayer, getPlayerRank
          matches.ts          # getPlayerMatches
          tournaments.ts      # getTournaments, getTournament
    scraper/                  # current src/ code, imports from @fpp/db
      package.json
      src/                    # existing files (api.ts, cli.ts, sync-*.ts, etc.)
    web/                      # Next.js frontend
      package.json
      src/
        app/                  # Next.js app router
        components/           # shared UI components
        lib/                  # utilities (fuzzy search, formatting)
  package.json                # workspace root
```

Bun workspaces in root `package.json`. Packages reference each other as `@fpp/db`, `@fpp/scraper`, `@fpp/web`.

## Schema Migration Required

The `matches` table currently has `tournament_name` (free text) but no foreign key to `tournaments`. Add:

```sql
ALTER TABLE matches ADD COLUMN tournament_id INTEGER REFERENCES tournaments(id);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_section ON matches(section_name);
```

Backfill `tournament_id` by matching `tournament_name` to `tournaments.name`. Update the scraper to populate `tournament_id` on new inserts.

## Ranking Definitions

All rankings use the global OpenSkill `ordinal` value from the `ratings` table. The ranking is always the same number — only the **cohort** (who you're ranked against) changes:

- **Global rank**: position among all rated players
- **Gender rank**: position among players with same `gender`
- **Club rank**: position among players with same `club`
- **Category rank**: position among all rated players who have at least one match with the same `section_name` value (e.g., "F3", "M2"). This is a global category cohort, not per-tournament.
- **Tournament rank**: position among all players who participated in that tournament
- **Tournament + category rank**: position among players in that category within that tournament

Computed via: `COUNT(*) + 1 WHERE ordinal > player.ordinal` filtered to the cohort.

## Database Access (`packages/db`)

### Connection

- Uses `bun:sqlite` directly
- DB path: `../../padel.db` relative to package, or `DB_PATH` env var
- Read-only for the web app — scraper owns writes

### Query Functions

**`searchPlayers(query: string, limit?: number): PlayerSearchResult[]`**
- Normalize diacritics on both query and stored names (e.g., João → joao)
- Score by: exact prefix > word prefix > substring position > length similarity
- Returns: id, name, club, global rank
- Default limit: 20

**`getPlayer(id: number): Player | null`**
- Player details: name, club, photo_url, gender, location, age_group, fpp_pontos

**`getPlayerRanks(id: number): PlayerRanks`**
- Global rank (position among all rated players by ordinal DESC)
- Gender rank (position among same gender)
- Club rank (position among same club)
- Computed via SQL `COUNT(*) + 1 WHERE ordinal > player.ordinal` with appropriate filters

**`getPlayerMatches(playerId: number, cursor?: string, limit?: number): { matches: MatchDetail[], nextCursor: string | null }`**
- Matches via match_players join, ordered by date_time DESC
- Each match includes:
  - Tournament name, section_name, round_name, date_time
  - Sets (parsed from sets_json)
  - Winner side
  - Both sides: player names, player IDs
  - For each player: category rank, global gender rank
- Cursor-based pagination: cursor format is `"<date_time>|<guid>"`, query uses `WHERE (date_time, guid) < (?, ?)` on the split values

**`getTournaments(page: number, pageSize?: number): { tournaments: Tournament[], total: number }`**
- Ordered by date DESC
- Offset-based pagination
- Returns: id, name, club, date

**`getTournament(id: number): TournamentDetail | null`**
- Tournament header info: name, club, date, link_web

**`getTournamentCategories(tournamentId: number): string[]`**
- Distinct section_name values from matches for this tournament

**`getTournamentPlayers(tournamentId: number, category?: string): TournamentPlayer[]`**
- Players who participated in this tournament (via match_players + matches)
- Filtered by category (section_name) if provided
- Sorted by global ordinal rating DESC
- Each player: id, name, global gender rank, category rank

### Types

```typescript
interface PlayerSearchResult {
  id: number
  name: string
  club: string | null
  globalRank: number
}

interface Player {
  id: number
  name: string
  club: string | null
  photoUrl: string | null
  gender: string | null
  location: string | null
  ageGroup: string | null
  fppPontos: number | null
}

interface PlayerRanks {
  global: { rank: number; total: number }
  gender: { rank: number; total: number; label: string }
  club: { rank: number; total: number; label: string } | null
}

interface MatchDetail {
  guid: string
  tournamentName: string | null
  sectionName: string | null
  roundName: string | null
  dateTime: string | null
  sets: Array<{ setA: number; setB: number; tieA: number; tieB: number }>
  winnerSide: string | null
  sideA: MatchPlayerInfo[]
  sideB: MatchPlayerInfo[]
}

interface MatchPlayerInfo {
  id: number
  name: string
  categoryRank: number | null   // rank among all players in the same section_name cohort globally
  genderRank: number | null     // rank among all players with same gender globally
}

interface Tournament {
  id: number
  name: string
  club: string | null
  date: string | null
}

interface TournamentPlayer {
  id: number
  name: string
  genderRank: number
  categoryRank: number
}
```

## Pages

### `/` — Home

Redirects to `/players`.

### `/players` — Player Search

- Search input at top, debounced (300ms)
- Empty state: prompt to search
- Results list: cards showing name, club, global rank
- Sorted by fuzzy match similarity score
- Tap card → navigate to `/players/[id]`

### `/players/[id]` — Player Profile

**Header section:**
- Photo (if available), name, club, location

**Rankings card:**
- Global rank: "#42 of 1,200"
- Gender rank: "#8 of 600 Men"
- Club rank: "#3 of 45 in Club XYZ" (if club exists)

**Match history (infinite scroll):**
- Each match card:
  - Tournament name (linked to `/tournaments/[id]`)
  - Date
  - Score: set-by-set display
  - Win/loss badge
  - Side A players vs Side B players
  - Each player name shows: category rank badge, gender rank badge
- Load more on scroll, cursor-based

### `/tournaments` — Tournament List

- Paginated list, recent first
- Each row: name, club, date
- Page-based pagination (prev/next)
- Tap → navigate to `/tournaments/[id]`

### `/tournaments/[id]` — Tournament Detail

**Header:** name, club, date

**Category filter:** tabs or dropdown listing all categories (section_name values) in this tournament. Default: show all.

**Player list:**
- Players who participated, filtered by selected category
- Sorted by global ordinal ranking (best first)
- Each player: name (linked to profile), global gender rank, category rank

## Visual Design

- **Style:** Clean minimal, light background
- **Components:** shadcn/ui — Card, Input, Table, Badge, Pagination, Tabs, Skeleton
- **Mobile-first:** single-column layout, touch-friendly (min 44px tap targets)
- **Responsive:** scales to desktop but optimized for phone screens
- **No dark mode in v1**

## Navigation

- Bottom tab bar (mobile) or top nav (desktop): Players | Tournaments
- Back navigation via browser history

## Technical Notes

- Next.js App Router with server components for data fetching
- Client components only for: search input debounce, infinite scroll, category filter
- No caching layer in v1 — SQLite reads are fast enough
- No authentication
- `padel.db` stays at project root, referenced by relative path or env var
- **Runtime:** All Next.js commands must run via `bun --bun` (e.g., `bun --bun next dev`, `bun --bun next build`) to ensure `bun:sqlite` is available. Standard `next dev` uses Node.js which lacks `bun:sqlite`.
- **Type separation:** `packages/db` owns domain types (Player, Match, Tournament). `packages/scraper` keeps API types (ApiMatch, ApiPlayerProfile) locally — no cross-dependency on API types from web.
