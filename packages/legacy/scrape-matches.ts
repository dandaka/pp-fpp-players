/**
 * Scrape all match results from V Open Smartpath tournament.
 *
 * Uses two data sources:
 * 1. tiepadel.com news feed (methods.aspx/get_news_by_codtou_header) - 186 match results
 *    with player IDs, names, scores, and timestamps. Paginates 10 items at a time.
 * 2. api.tiesports.com mobile API endpoints (for richer match data on specific matches):
 *    - get_homepage_matches: 10 most recent matches with set scores and player photos
 *    - get_matches_by_tournament: 10 different matches with set scores
 *
 * KEY FINDINGS about the API:
 * - get_homepage_matches (tournaments.asmx): Always returns exactly 10 matches.
 *   flag="" works; "proximos","aovivo","todos","resultados" return 0.
 *   count_items parameter is ignored (same 10 every time).
 * - get_matches_by_tournament (matches.asmx): Always returns exactly 10 matches.
 *   count_items and count_matches parameters are ignored.
 *   Returns DIFFERENT 10 matches than get_homepage_matches.
 * - get_matches_v1 (matches.asmx): Requires token, player_id, count_items, type (int),
 *   sport_id, year, count_matches. Returns only the TOKEN OWNER's matches (ignores player_id).
 * - get_match_v1 (matches.asmx): Requires match_id (int), Set_Match_id (int), type (int).
 *   Not useful since match IDs from other endpoints are GUIDs, not ints.
 * - The only way to get ALL matches is the news feed pagination.
 *
 * Tournament IDs:
 * - API tournament_id: 22959 (V Open Smartpath)
 * - Tournament GUID: e0e378f9-4aeb-4ca7-a80c-e67168cd971a
 * - codtou_header: 22959 (same as API ID, used for news feed)
 * - NOTE: tournament_id 23261 = "III CPC Padel Cup" (different tournament!)
 */

const CODTOU_HEADER = 22959;
const TOURNAMENT_ID = 22959;
const TOKEN = "e7c75ca5-d749-47a2-a1d3-ae947f8eda81";
const UA = "TiePlayer/339 CFNetwork/3860.400.51 Darwin/25.3.0";
const PAGE_SIZE = 10;

interface NewsItem {
  ID: number;
  CODNEW: number;
  UIDNEW: string;
  DATEOFNEW: string;
  DATEOFNEW_format: string;
  TEXT_TITLE: string;
  SCORES: string;
  SIDE_A_1_ID: number;
  SIDE_A_1_TXT: string;
  SIDE_A_2_ID: number;
  SIDE_A_2_TXT: string;
  SIDE_B_1_ID: number;
  SIDE_B_1_TXT: string;
  SIDE_B_2_ID: number;
  SIDE_B_2_TXT: string;
  LOCATION_NAME: string;
  NAMTOU: string;
  UIDTOU: string;
}

interface MatchResult {
  news_id: number;
  news_uid: string;
  date: string;
  scores: string;
  side_a: { id: number; name: string }[];
  side_b: { id: number; name: string }[];
  winner: "a" | "b" | "unknown";
  location: string;
  draw_info: string; // extracted from TEXT_TITLE if available
}

async function fetchNewsFeed(offset: number): Promise<NewsItem[]> {
  const res = await fetch(
    "https://fpp.tiepadel.com/methods.aspx/get_news_by_codtou_header",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codtou_header: CODTOU_HEADER,
        count_items: offset,
      }),
    }
  );
  const data = await res.json();
  return data.d || [];
}

function parseTitle(html: string): { winner: "a" | "b" | "unknown"; drawInfo: string } {
  // Title format: "Player A / Player B defeats Player C / Player D by SCORES"
  const defeatMatch = html.match(/defeats/i);
  if (defeatMatch) {
    // The side mentioned first (before "defeats") is the winner
    return { winner: "a", drawInfo: "" };
  }
  const walkoverMatch = html.match(/Walkover/i);
  if (walkoverMatch) {
    return { winner: "a", drawInfo: "" };
  }
  return { winner: "unknown", drawInfo: "" };
}

function newsToMatch(item: NewsItem): MatchResult {
  const { winner } = parseTitle(item.TEXT_TITLE);

  return {
    news_id: item.ID,
    news_uid: item.UIDNEW,
    date: item.DATEOFNEW_format,
    scores: item.SCORES,
    side_a: [
      { id: item.SIDE_A_1_ID, name: item.SIDE_A_1_TXT },
      ...(item.SIDE_A_2_ID ? [{ id: item.SIDE_A_2_ID, name: item.SIDE_A_2_TXT }] : []),
    ],
    side_b: [
      { id: item.SIDE_B_1_ID, name: item.SIDE_B_1_TXT },
      ...(item.SIDE_B_2_ID ? [{ id: item.SIDE_B_2_ID, name: item.SIDE_B_2_TXT }] : []),
    ],
    winner,
    location: item.LOCATION_NAME,
    draw_info: "",
  };
}

async function fetchApiMatches(): Promise<any[]> {
  const results: any[] = [];

  // Endpoint 1: get_homepage_matches
  const res1 = await fetch(
    `https://api.tiesports.com/tournaments.asmx/get_homepage_matches?token=${TOKEN}&tournament_id=${TOURNAMENT_ID}&count_items=0&flag=`,
    { headers: { Accept: "application/json", "User-Agent": UA } }
  );
  const data1 = await res1.json();
  for (const list of data1.lists || []) {
    for (const m of list.matches || []) {
      results.push({ source: "homepage_matches", ...m });
    }
  }

  // Endpoint 2: get_matches_by_tournament
  const res2 = await fetch(
    `https://api.tiesports.com/matches.asmx/get_matches_by_tournament?token=${TOKEN}&tournament_id=${TOURNAMENT_ID}&count_items=0&count_matches=100`,
    { headers: { Accept: "application/json", "User-Agent": UA } }
  );
  const data2 = await res2.json();
  for (const m of data2.list || []) {
    results.push({ source: "matches_by_tournament", ...m });
  }

  return results;
}

async function main() {
  console.log("=== Scraping V Open Smartpath Match Results ===\n");

  // 1. Fetch all news feed items (match results)
  const allNews: NewsItem[] = [];
  let offset = 0;
  while (true) {
    const items = await fetchNewsFeed(offset);
    if (items.length === 0) break;
    allNews.push(...items);
    console.log(`Fetched news offset=${offset}: ${items.length} items (total: ${allNews.length})`);
    offset += PAGE_SIZE;
  }

  console.log(`\nTotal news items: ${allNews.length}`);

  // 2. Convert to match results
  const matches = allNews.map(newsToMatch);

  // 3. Fetch API matches (for richer data on 20 matches)
  console.log("\nFetching API matches...");
  const apiMatches = await fetchApiMatches();
  console.log(`API matches: ${apiMatches.length}`);

  // 4. Collect unique player IDs
  const playerIds = new Set<number>();
  for (const m of matches) {
    for (const p of [...m.side_a, ...m.side_b]) {
      if (p.id) playerIds.add(p.id);
    }
  }
  console.log(`Unique players in matches: ${playerIds.size}`);

  // 5. Save results
  const output = {
    tournament: {
      name: "V Open Smartpath",
      id: TOURNAMENT_ID,
      guid: "e0e378f9-4aeb-4ca7-a80c-e67168cd971a",
      codtou_header: CODTOU_HEADER,
    },
    total_matches: matches.length,
    unique_players: playerIds.size,
    scraped_at: new Date().toISOString(),
    matches,
    api_matches: apiMatches,
  };

  await Bun.write("matches.json", JSON.stringify(output, null, 2));
  console.log(`\nSaved to matches.json`);

  // 6. Print summary
  console.log("\n=== Summary ===");
  console.log(`Total match results from news feed: ${matches.length}`);
  console.log(`API matches (with set scores): ${apiMatches.length}`);
  console.log(`Unique players: ${playerIds.size}`);

  // Date range
  const dates = matches.map((m) => m.date).filter(Boolean).sort();
  console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
}

main().catch(console.error);
