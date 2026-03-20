# Plan Review: FPP Players Frontend

**Plan:** `docs/superpowers/plans/2026-03-20-frontend-plan.md`
**Spec:** `docs/superpowers/specs/2026-03-20-frontend-design.md`
**Reviewed:** 2026-03-20

## Summary

The plan is thorough, well-structured, and provides complete production-ready code (not pseudo-code). It covers 12 tasks with clear dependencies. The plan correctly acknowledges data reality (empty section_name, sparse gender, no tournament_id FK) and adapts accordingly. Several issues need attention before implementation.

---

## Critical Issues (must fix)

### 1. `side_a_ids` is a TEXT column, not JSON array guaranteed

In `matches.ts` (line 665), the code does `JSON.parse(row.side_a_ids)` assuming it contains a JSON array. The schema defines `side_a_ids TEXT NOT NULL`. Verify the actual stored format before assuming JSON. If it stores comma-separated IDs or a different format, the parse will fail for 338k matches.

**Action:** Check actual data format in padel.db: `SELECT side_a_ids FROM matches LIMIT 5`. Add defensive parsing.

### 2. N+1 query problem in match loading will be extremely slow

In `matches.ts`, for every match loaded, `buildPlayerInfo()` calls `getGenderRank()` and `getCategoryRank()` per player. Each of those runs 2 SQL queries. For a doubles match (4 players), that's 8+ SQL queries PER MATCH. Loading 20 matches = ~160+ extra queries per page load.

**Action:** Batch the rank lookups. Pre-fetch all player ratings in a single query, then compute ranks with a single COUNT query per unique gender/section. Or precompute ranks in the ratings table.

### 3. `PRAGMA journal_mode = WAL` on a read-only connection

In `packages/db/src/connection.ts` (line 226), the connection opens as `{ readonly: true }` but then runs `PRAGMA journal_mode = WAL` which is a write operation. This will error on a read-only database.

**Action:** Remove the WAL pragma from the read-only connection. The scraper's `db.ts` already sets WAL mode on writes.

### 4. Search SQL diacritics handling is incomplete and brittle

The `searchPlayers` query (line 376) uses chained REPLACE calls for only 7 Portuguese diacritical characters. This misses: `ê`, `ô`, `à`, `â`, `õ`, `ñ`, and many others common in Portuguese/Spanish names. Meanwhile `normalizeString()` in JS correctly uses NFD normalization for all diacritics.

**Action:** Either:
- Use SQLite's `unicode61` tokenizer with FTS5
- Do all filtering in JS (fetch more rows, filter in application)
- Create a `name_normalized` column and index it

---

## Important Issues (should fix)

### 5. Spec requires category rank on match players, plan always returns null

The spec defines `categoryRank` on `MatchPlayerInfo` as "rank among all players in the same section_name cohort globally." The plan's `getCategoryRank()` correctly implements this, but `getTournamentPlayers()` hard-codes `categoryRank: null` with a comment "section_name is mostly empty." While pragmatic, this means the feature silently never works even for matches that DO have section_name data.

**Action:** Keep the implementation but call `getCategoryRank` when section_name is non-empty instead of always returning null.

### 6. Spec's `PlayerRanks.gender` is non-nullable, plan makes it nullable

The spec defines `gender: { rank; total; label } | null` -- actually wait, looking again, the spec DOES have it as potentially present. But the plan's `types.ts` (line 256) has `gender: ... | null` which matches. However, the spec interface at line 138 says `gender: { rank: number; total: number; label: string }` WITHOUT `| null`.

**Action:** The plan's nullable version is correct given data reality (only 3 players have gender). Update the spec to match, or document the deviation.

### 7. `match-card.tsx` imports types from `@fpp/db` in a client component

Line 1332: `import type { MatchDetail, MatchPlayerInfo } from "@fpp/db"`. Since `@fpp/db` uses `bun:sqlite`, importing it in a client component could cause bundling issues -- even type-only imports may trigger the bundler to resolve the module. Next.js client components get bundled for the browser.

**Action:** Move shared types to a separate entry point like `@fpp/db/types` that doesn't import `bun:sqlite`, or duplicate the type definitions in the web package.

### 8. `PlayerMatches` component triggers fetch in render body

Lines 1580-1582: The initial load is triggered by `if (initialLoad && !loading) { loadMore(); }` directly in the render function body. This violates React rules -- side effects must be in useEffect. This will cause double-fetching in React Strict Mode.

**Action:** Use `useEffect` for the initial load instead.

### 9. InfiniteScroll has `onLoadMore` in dependency array causing re-observe loop

Line 1443: `useEffect` depends on `[hasMore, loading, onLoadMore]`. Since `onLoadMore` is a new function reference on every render (useCallback deps change when cursor/loading change), the observer will be torn down and re-created frequently.

**Action:** Use a ref for the callback instead of including it in the effect dependencies.

### 10. Tournament-to-matches linkage uses dual matching strategy with no index

Queries in `tournaments.ts` match matches by both `source = 'scrape:tournament:${id}'` and `tournament_name = ?`. The `source` column has no index, and neither does `tournament_name`. For 338k matches, this will be slow.

**Action:** Add indexes:
```sql
CREATE INDEX idx_matches_source ON matches(source);
CREATE INDEX idx_matches_tournament_name ON matches(tournament_name);
```

---

## Suggestions (nice to have)

### 11. Spec mentions schema migration (ALTER TABLE), plan skips it

The spec proposes `ALTER TABLE matches ADD COLUMN tournament_id`. The plan instead derives tournament_id from the `source` column at query time, which is the right pragmatic choice. However, neither the plan nor spec updates this discrepancy. Document the decision.

### 12. `fuzzy-search.ts` uses a loose LIKE pattern that may match too broadly

The pattern `%j%o%a%o%` (splitting query chars with `%`) will match far too many rows for short queries. A 2-character query like "ab" becomes `%a%b%` matching nearly everything.

**Action:** Add a minimum query length (3+ chars) or use a tighter LIKE pattern (e.g., `%${normQuery}%` without char splitting).

### 13. No error boundaries or loading states for server components

The player profile and tournament detail pages have no error handling for the SQLite connection failing. Consider adding `error.tsx` boundaries.

### 14. Date formatting is raw

Match dates display `match.dateTime` raw from the DB. The spec mentions a `lib/format.ts` for date/number formatting helpers, and the plan's file structure lists it, but no task creates it.

### 15. `next.config.ts` has both current and deprecated config for external packages

Line 982-988: `serverExternalPackages` is the current Next.js 15 config, while `experimental.serverComponentsExternalPackages` is deprecated. Only the first is needed.

---

## Spec Coverage Checklist

| Spec Requirement | Plan Coverage | Status |
|---|---|---|
| Monorepo with 3 packages | Task 1 | OK |
| @fpp/db shared types + queries | Tasks 2-5 | OK |
| searchPlayers with diacritics | Task 3 | Partial (see #4) |
| getPlayerRanks (global/gender/club) | Task 3 | OK |
| getPlayerMatches with cursor | Task 4 | OK |
| Tournament queries | Task 5 | OK |
| Next.js + shadcn/ui setup | Task 6 | OK |
| Navigation (bottom tabs) | Task 7 | OK |
| Home redirects to /players | Task 7 | OK |
| Player search page | Task 8 | OK |
| Player profile page | Task 9 | OK |
| Tournament list page | Task 10 | OK |
| Tournament detail + category filter | Task 11 | OK |
| Schema migration (tournament_id FK) | Not implemented | Skipped (good) |
| lib/format.ts date formatting | Not implemented | Missing |
| Error boundaries | Not implemented | Missing |

## Task Dependency Order

The dependency order is correct: monorepo setup (1) -> db package types (2) -> queries (3-5) -> web setup (6) -> layout (7) -> pages (8-11) -> integration (12). No circular dependencies.

---

## Verdict

**Proceed with fixes.** The plan is well-crafted and covers the spec comprehensively. Fix the 4 critical issues before implementation begins. The N+1 query problem (#2) and WAL pragma on read-only (#3) will cause immediate runtime failures. The diacritics issue (#4) will produce poor search results for Portuguese names.
