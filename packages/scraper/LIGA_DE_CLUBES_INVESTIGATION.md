# Liga de Clubes — Scraper Fix (RESOLVED)

## Problem

Tournaments like "Liga de Clubes 2023 - Centro - Absolutos" (ID: 14054) got processed but zero matches were saved.

## Root Causes Found

### 1. News feed API returns team-level data, not player-level
- `SIDE_A_1_ID: 0` — all player IDs are 0
- Side names are team names ("Starpadel M5" vs "ScalSports A")
- Scores are team aggregate ("3-0" = 3 matches won), not set scores
- Scraper skips entries with no player IDs → 0 matches saved

### 2. Matches page uses dropdown instead of tabs for date selection
- Standard tournaments: `<a id="repeater_days_all_matches_...">` tab links
- Liga de Clubes: `<select id="drop_days_all_matches">` dropdown with ISO date values
- `scrapeMatchesPage` only looked for tab links → found 0 dates → scraped nothing

### 3. Draws page sub-draw tabs regex was too narrow
- Regex `^(M|F)\d+-` only matched "M6-QP" style tabs
- Liga de Clubes has no sub-draw tabs (only nav tabs: Quadro, Encontros, Equipas, Informação)
- Draws Encontros tab is empty for Liga de Clubes anyway — all data is on the Matches page

## Fixes Applied

### `scrape-matches-page.ts`
- Added fallback to `#drop_days_all_matches` dropdown when no tab links found
- Dropdown values are ISO dates, used directly (no Portuguese date parsing needed)
- Handles pagination within each date

### `scrape-draws-page.ts`
- Widened sub-draw tab detection: accepts all `menu_inside_tournament` links except known nav tabs
- Filters out nav tab IDs: `link_tournament_open_draw`, `link_tournament_open_matches`, `link_tournament_open_teams`, `link_tournament_open_info`

### `scrape-matches-page.ts` (parseCategory)
- Added pattern for "Masculinos 5 - Grupo E" → `{ category: "Masculinos 5", subcategory: "Grupo E" }`

### `scrape-all-tournaments.ts`
- When news feed returns 0 matches, falls back to Playwright scraping via `scrapeSchedule`

## Test Results

Tournament 14054 (Liga de Clubes 2023 - Centro - Absolutos):
- 54 dates scraped
- **1,371 matches inserted**
- **198 new players** discovered
