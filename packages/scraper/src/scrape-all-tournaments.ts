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

async function fetchNewsFeed(codtouHeader: number, offset: number, retries = 3): Promise<NewsItem[]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch("https://fpp.tiepadel.com/methods.aspx/get_news_by_codtou_header", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codtou_header: codtouHeader, count_items: offset }),
        signal: AbortSignal.timeout(30000),
      });
      const data = (await res.json()) as { d: NewsItem[] };
      return data.d ?? [];
    } catch (err) {
      if (attempt < retries) {
        console.log(`    Retry ${attempt}/${retries} for tournament ${codtouHeader} offset ${offset}`);
        await Bun.sleep(2000 * attempt);
      } else {
        console.error(`    Failed after ${retries} retries: tournament ${codtouHeader} offset ${offset}`);
        return [];
      }
    }
  }
  return [];
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

export async function scrapeAllTournaments(source = "db") {
  const db = getDb();
  let targets: { id: number; name: string; date: string }[];

  if (source === "db") {
    // Load all tournaments from DB
    targets = db.query("SELECT id, name, date FROM tournaments ORDER BY id").all() as typeof targets;
    console.log(`Loaded ${targets.length} tournaments from DB\n`);
  } else if (source === "api") {
    const tournaments = await getTournaments(0);
    targets = tournaments.map((t) => ({ id: t.id, name: t.title, date: t.date }));
    console.log(`Found ${targets.length} tournaments from API\n`);
  } else {
    // Load from discovered tournaments JSON
    const data: Array<{ id: number; name: string; date: string }> = await Bun.file(source).json();
    targets = data;
    console.log(`Loaded ${targets.length} tournaments from ${source}\n`);
  }

  let grandTotal = 0;
  let processed = 0;

  for (const t of targets) {
    processed++;
    const cursorKey = `scrape_tournament_${t.id}`;
    if (getCursor(cursorKey) === "done") continue;

    console.log(`[${processed}/${targets.length}] ${t.name} (ID: ${t.id})`);
    try {
      saveTournament(db, t.id, t.name, t.date);
      const count = await scrapeTournament(t.id, t.name);
      if (count > 0) console.log(`  → ${count} matches`);
      grandTotal += count;
    } catch (err) {
      console.error(`  Error scraping tournament ${t.id}: ${err}`);
    }
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

if (import.meta.main) {
  const source = process.argv[3] && !process.argv[3].startsWith("-")
    ? process.argv[3]
    : process.argv[2] ?? "api";
  scrapeAllTournaments(source).catch(console.error);
}
