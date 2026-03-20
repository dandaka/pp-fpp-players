import { getDb, setCursor, getCursor } from "./db";
import { getTournaments } from "./api";

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

async function fetchNewsFeed(codtouHeader: number, offset: number): Promise<NewsItem[]> {
  const res = await fetch("https://fpp.tiepadel.com/methods.aspx/get_news_by_codtou_header", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codtou_header: codtouHeader, count_items: offset }),
  });
  const data = (await res.json()) as { d: NewsItem[] };
  return data.d ?? [];
}

function parseWinner(title: string): "a" | "b" | null {
  if (/defeats/i.test(title) || /walkover/i.test(title)) return "a";
  return null;
}

function parseScores(scores: string) {
  if (!scores) return [];
  return scores.split(", ").map((set) => {
    const parts = set.split("-");
    return {
      set_a: parseInt(parts[0] ?? "0"),
      set_b: parseInt(parts[1] ?? "0"),
      tie_a: -1,
      tie_b: -1,
    };
  });
}

async function scrapeTournament(tournamentId: number, tournamentName: string) {
  const db = getDb();
  const cursorKey = `scrape_tournament_${tournamentId}`;
  const alreadyDone = getCursor(cursorKey);
  if (alreadyDone === "done") {
    console.log(`  Skipping ${tournamentName} (already scraped)`);
    return 0;
  }

  const insertMatch = db.prepare(`
    INSERT OR IGNORE INTO matches (guid, tournament_name, section_name, round_name, date_time,
      is_singles, side_a_ids, side_b_ids, side_a_names, side_b_names, sets_json, winner_side, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMatchPlayer = db.prepare(`
    INSERT OR IGNORE INTO match_players (match_guid, player_id, side) VALUES (?, ?, ?)
  `);

  const insertNewPlayer = db.prepare(`
    INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)
  `);

  let offset = 0;
  let totalMatches = 0;

  while (true) {
    const items = await fetchNewsFeed(tournamentId, offset);
    if (items.length === 0) break;

    const tx = db.transaction(() => {
      for (const item of items) {
        const sideA: { id: number; name: string }[] = [];
        if (item.SIDE_A_1_ID) sideA.push({ id: item.SIDE_A_1_ID, name: item.SIDE_A_1_TXT });
        if (item.SIDE_A_2_ID) sideA.push({ id: item.SIDE_A_2_ID, name: item.SIDE_A_2_TXT });

        const sideB: { id: number; name: string }[] = [];
        if (item.SIDE_B_1_ID) sideB.push({ id: item.SIDE_B_1_ID, name: item.SIDE_B_1_TXT });
        if (item.SIDE_B_2_ID) sideB.push({ id: item.SIDE_B_2_ID, name: item.SIDE_B_2_TXT });

        if (sideA.length === 0 || sideB.length === 0) continue;

        const winner = parseWinner(item.TEXT_TITLE);
        const isSingles = sideA.length === 1 && sideB.length === 1;
        const sets = parseScores(item.SCORES);

        insertMatch.run(
          item.UIDNEW, tournamentName, "", "",
          item.DATEOFNEW_format, isSingles ? 1 : 0,
          JSON.stringify(sideA.map((p) => p.id)),
          JSON.stringify(sideB.map((p) => p.id)),
          sideA.map((p) => p.name).join(" / "),
          sideB.map((p) => p.name).join(" / "),
          JSON.stringify(sets), winner, `scrape:tournament:${tournamentId}`
        );

        for (const p of sideA) {
          insertNewPlayer.run(p.id, p.name);
          insertMatchPlayer.run(item.UIDNEW, p.id, "a");
        }
        for (const p of sideB) {
          insertNewPlayer.run(p.id, p.name);
          insertMatchPlayer.run(item.UIDNEW, p.id, "b");
        }

        totalMatches++;
      }
    });
    tx();

    offset += PAGE_SIZE;
    await Bun.sleep(200);
  }

  setCursor(cursorKey, "done");
  return totalMatches;
}

// Also store tournament in DB
function saveTournament(db: ReturnType<typeof getDb>, id: number, name: string, date: string) {
  db.run(
    "INSERT OR IGNORE INTO tournaments (id, name, date) VALUES (?, ?, ?)",
    [id, name, date]
  );
}

async function main() {
  const db = getDb();

  // Get all tournaments from API
  const tournaments = await getTournaments(0);
  console.log(`Found ${tournaments.length} tournaments\n`);

  // Filter 2026 tournaments (date starts with "2026" or is a weekday name for upcoming)
  const targets = tournaments.filter((t) =>
    t.date.startsWith("2026") || t.date.startsWith("2025") ||
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].includes(t.date)
  );

  let grandTotal = 0;

  for (const t of targets) {
    console.log(`Scraping: ${t.title} (ID: ${t.id}, date: ${t.date})`);
    saveTournament(db, t.id, t.title, t.date);
    const count = await scrapeTournament(t.id, t.title);
    console.log(`  → ${count} matches\n`);
    grandTotal += count;
  }

  const stats = {
    matches: (db.query("SELECT COUNT(*) as c FROM matches").get() as { c: number }).c,
    withResults: (db.query("SELECT COUNT(*) as c FROM matches WHERE winner_side IS NOT NULL").get() as { c: number }).c,
    players: (db.query("SELECT COUNT(*) as c FROM players").get() as { c: number }).c,
  };

  console.log(`\n=== Done ===`);
  console.log(`New matches this run: ${grandTotal}`);
  console.log(`Total matches: ${stats.matches} (${stats.withResults} with results)`);
  console.log(`Total players: ${stats.players}`);
}

main().catch(console.error);
