# TieSports / TiePadel API Reference

Undocumented API endpoints discovered through research of the TiePlayer iOS app and the FPP (Federacao Portuguesa de Padel) web frontend.

---

## Base URLs

| Purpose    | Base URL                        | Notes                              |
|------------|---------------------------------|------------------------------------|
| Mobile API | `https://api.tiesports.com`     | Used by TiePlayer iOS app          |
| Web API    | `https://fpp.tiepadel.com`      | ASP.NET web frontend               |

## Authentication

### Mobile API

Requests require a `token` query parameter:

```
token=e7c75ca5-d749-47a2-a1d3-ae947f8eda81
```

User-Agent observed in the wild:

```
TiePlayer/339 CFNetwork/3860.400.51 Darwin/25.3.0
```

### Web API

Requests use `POST` with `Content-Type: application/json` and a JSON body. No token required for public endpoints.

---

## Mobile API Endpoints (api.tiesports.com)

### Player Endpoints

#### Get Player Profile

```
GET /player.asmx/get_profile?token={t}&player_id={id}
```

Returns player profile including name, photo URL, location, license number, gender, match count, and share URL. Works for any player ID (not restricted to token owner).

#### Search Players by Name

```
GET /player.asmx/get_players?token={t}&filter_by_name={name}&count_items={offset}
```

Search for players by name. `count_items` acts as an offset for pagination.

---

### Match Endpoints

#### Get Single Match

```
GET /matches.asmx/get_match_v1?token={t}&match_id={guid}&Set_Match_id=0
```

Returns full match detail: players with IDs, scores, sets, tiebreaks, TARS graphs, and tournament info. `match_id` is an uppercase UUID (GUID).

#### Get Player Matches (BROKEN)

```
GET /matches.asmx/get_matches_v1?token={t}&player_id={id}&type=0&sport_id=2&year={y}&count_matches={offset}
```

**Known bug:** Ignores `player_id` and always returns the token owner's matches regardless of the ID passed.

Parameters:

- `sport_id=2` -- Padel
- `type=0` -- Completed matches
- `year` -- Filter by year
- `count_matches` -- Offset for pagination

#### Get Matches by Tournament

```
GET /matches.asmx/get_matches_by_tournament?token={t}&tournament_id={id}&count_items=0
```

Returns up to 10 matches for a given tournament. `count_items` is accepted but ignored -- no real pagination. Returns a different subset of matches than `get_homepage_matches`.

---

### Tournament Endpoints

#### List Tournaments

```
GET /tournaments.asmx/get_tournaments_v2?token={t}&find_by_name={search}&count_tournaments={offset}
```

List tournaments with optional name filter. Offset-based pagination via `count_tournaments`. Pass empty `find_by_name` to return all.

#### Get Tournament Detail

```
GET /tournaments.asmx/get_tournament?token={t}&tournament_id={id}
```

Returns tournament name, club, location, header texts, news feed with match GUIDs, and web link.

#### Get Tournament Homepage Matches

```
GET /tournaments.asmx/get_homepage_matches?token={t}&tournament_id={id}&count_items={offset}&flag={flag}
```

Returns up to 10 tournament matches. `count_items` appears to be ignored.

`flag` values tested:

- `""` (empty) -- Returns matches
- `"proximos"`, `"aovivo"`, `"todos"`, `"resultados"` -- All return 0 results

---

### News Endpoints

#### Get Player Activity Feed

```
GET /news.asmx/get_player_profile_feed?token={t}&player_id={id}&count_items={offset}
```

Returns player activity feed. 10 items per page, offset-based pagination.

---

### Dead Endpoints (return 500 errors)

The following endpoints were tested and do not exist on the server:

- `get_tournament_matches`
- `get_all_matches`
- `get_draw_matches`
- `get_section_matches`
- `get_tournament_draws`
- `get_tournament_sections`
- `get_sections`
- `get_draws`

---

## Web API Endpoints (fpp.tiepadel.com)

### Get Tournament Match Results

```
POST /methods.aspx/get_news_by_codtou_header
Content-Type: application/json
```

**This is the most useful endpoint for bulk match data.** Unlike the mobile API, it supports proper pagination and returns all matches.

Request body:

```json
{
  "codtou": "VOpenSmartpath",
  "count_items": 0
}
```

- `codtou` -- Tournament code string (not numeric ID)
- `count_items` -- Offset for pagination (increment by 10)

Returns 10 items per page. Each item includes player IDs, names, and scores. Paginate by incrementing `count_items` by 10 until the response returns an empty list.

Example: Tournament "V Open Smartpath" returned 186 matches across 384 unique players.

### ASP.NET Pages (require Playwright)

These pages use ASP.NET UpdatePanels with event validation and cannot be scraped with plain HTTP requests. A headless browser (Playwright) is required.

#### Tournament Player List

```
https://fpp.tiepadel.com/Tournaments/VOpenSmartpath/Players
```

ASP.NET grid with server-side pagination.

#### Weekly Rankings

```
https://tour.tiesports.com/fpp/weekly_rankings?rank=absolutos
```

ASP.NET AJAX page. The search form only appears after clicking the "Ver mais" (load more) button.

Form fields:

| Field                                | Description            |
|--------------------------------------|------------------------|
| `txt_filter_rankings_player_name`    | Player name search     |
| `drop_filter_rankings_gender`        | 1=M, 2=F, 3=Mixed     |
| `drop_filter_rankings_age_group`     | 6=Absolutos            |
| `btn_filter_rankings`               | Submit button          |

Results table columns: Ranking, Variacao, Licenca, Jogador, Pontos, Clube, Nivel, Escalao, Torneios.

Pontos (points) use Portuguese number formatting: dots for thousands separators, comma for decimal (e.g., `169.375,00`).

---

## Key Limitations

1. The mobile API caps match listings at 10 per endpoint with no working pagination.
2. `get_matches_v1` ignores the `player_id` parameter and always returns the token owner's matches.
3. `get_homepage_matches` and `get_matches_by_tournament` return different, non-overlapping subsets of 10 matches each.
4. The only reliable way to retrieve ALL tournament matches is via the web API endpoint `get_news_by_codtou_header`.
5. Match IDs (GUIDs) are uppercase UUIDs.
6. Player IDs are numeric integers.
7. `sport_id=2` refers to Padel.

---

## Known Tournament IDs

| Numeric ID | Code              | Name                | Players | Matches |
|------------|-------------------|---------------------|---------|---------|
| 22959      | VOpenSmartpath    | V Open Smartpath    | 526     | 186     |
| 23261      | --                | III CPC Padel Cup   | --      | --      |

---

## Response Formats

### Match Object (Mobile API)

```json
{
  "id": "GUID",
  "side_a": [
    {
      "id": 123,
      "name": "Player Name",
      "photo": "https://..."
    }
  ],
  "side_b": [
    {
      "id": 456,
      "name": "Player Name",
      "photo": "https://..."
    }
  ],
  "total_a": "2",
  "total_b": "0",
  "sets": [
    {
      "set_a": 6,
      "set_b": 3,
      "tie_a": -1,
      "tie_b": -1
    }
  ],
  "winner_a": true,
  "winner_b": false,
  "infos": {
    "top_left": "Tournament Name",
    "top_right": "Round\r\nSection",
    "date_time": {
      "date": "2026-03-19",
      "time": "19:00",
      "str": "19:00, 2026-03-19"
    }
  }
}
```

Notes on the match object:

- `side_a` and `side_b` are arrays (doubles matches have 2 players per side)
- `tie_a` / `tie_b` are `-1` when no tiebreak was played in that set
- `total_a` / `total_b` are strings representing sets won
- `winner_a` / `winner_b` are booleans indicating the winning side
