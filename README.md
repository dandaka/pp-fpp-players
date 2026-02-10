# FPP Players — Tournament Scraper

Scrapes player data and ranking scores from Federação Portuguesa de Padel (FPP) for the **V Open Smartpath** tournament.

## Setup

```bash
bun install
bunx playwright install chromium
```

## Scripts

### 1. Scrape player list

Scrapes all players from the tournament page using Playwright (handles ASP.NET grid pagination).

```bash
bun scrape.ts
```

- Source: https://fpp.tiepadel.com/Tournaments/VOpenSmartpath/Players
- Output: `players.json`, `players.csv`
- Fields: `id`, `name`, `club`, `section`, `location`, `age`

### 2. Scrape ranking scores

For each player, searches the FPP weekly rankings page by name and gender, filters for **Nível 5** and **Nível 6** entries, and averages the Pontos.

```bash
bun scrape-scores.ts
```

- Source: https://tour.tiesports.com/fpp/weekly_rankings?rank=absolutos
- Output: updates `players.json` and `players.csv` with `pontos` field, creates `players-with-scores.json` (detailed)
- Takes ~10 minutes for 526 players (~1.5s per search)

## How the rankings scraper works

The rankings page is an ASP.NET app with UpdatePanels. Simple HTTP requests fail due to event validation. The scraper uses Playwright to:

1. Load the rankings page
2. Click "Ver mais" (load more) button to reveal the search form
3. For each player, fill in `txt_filter_rankings_player_name`, set `drop_filter_rankings_gender` (1=Men, 2=Women), set `drop_filter_rankings_age_group` (6=Absolutos), and click `btn_filter_rankings`
4. Wait for the POST response, then parse the results table
5. Filter results for Nível 5 or Nível 6 only
6. Average pontos across all matching entries (names aren't unique)

Results table columns: Ranking, Variação, Licença, Jogador, Pontos, Clube, Nível, Escalão, Torneios

## Data files

| File | Description |
|------|-------------|
| `players.json` | All 526 players with pontos (null if no Nível 5/6 match) |
| `players.csv` | Same data in CSV format |
| `players-with-scores.json` | Detailed ranking entries per player |

## Player breakdown by section

```
Femininos 1:   6       Masculinos 1:    10
Femininos 2:  16       Masculinos 1+2:   2
Femininos 3:  16       Masculinos 2:    32
Femininos 4:  28       Masculinos 3:    58
Femininos 5:  72       Masculinos 4:    50
Femininos 6:  50       Masculinos 5:    96
                       Masculinos 6:    90
Total: 526 players, 385 with Nível 5/6 scores
```

## Notes

- Pontos use Portuguese number format on the site: `169.375,00` (dots=thousands, comma=decimal)
- Common names (e.g. "João Pinto", "Bruno Martins") match multiple people — we average all Nível 5/6 entries
- Short names/nicknames (e.g. "Zé", "Toni", "Bijou", "Dani") may match unrelated people
- Players with no Nível 5/6 entries get `pontos: null`
