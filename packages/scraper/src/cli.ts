import { seedPlayersFromJson, enrichPlayerProfiles } from "./sync-players";
import { importMatchesFromJson } from "./import-matches";
import { calculateRatings, printLeaderboard } from "./calculate-ratings";
import { getDb } from "./db";

const cmd = process.argv[2];

switch (cmd) {
  case "seed":
    await seedPlayersFromJson();
    break;

  case "enrich": {
    const allFlag = process.argv.includes("--all");
    const batch = parseInt(process.argv[3] ?? "100");
    await enrichPlayerProfiles(batch, 200, allFlag);
    break;
  }

  case "import":
    await importMatchesFromJson(process.argv[3]);
    break;

  case "scrape": {
    // Pass source as argv[3] so scrape-all-tournaments picks it up
    if (!process.argv[3]) process.argv[3] = "db";
    await import("./scrape-all-tournaments");
    break;
  }

  case "scan": {
    const { scanTournaments } = await import("./find-tournaments");
    const scanArgs = process.argv.slice(3).filter((a) => !a.startsWith("--"));
    const force = process.argv.includes("--force");
    if (force) {
      const db = getDb();
      db.run("DELETE FROM sync_cursors WHERE key = 'scan_tournaments_last_id'");
      console.log("Force mode: resetting scan cursor");
    }
    const start = parseInt(scanArgs[0] ?? "1");
    const end = parseInt(scanArgs[1] ?? "25000");
    await scanTournaments(start, end);
    break;
  }

  case "rate":
    calculateRatings();
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;

  case "recalculate": {
    const db = getDb();
    db.run("DELETE FROM ratings");
    console.log("Cleared old ratings");
    calculateRatings();
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;
  }

  case "leaderboard":
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;

  case "player": {
    const db = getDb();
    const search = process.argv[3];
    if (!search) { console.log("Usage: bun src/cli.ts player <name>"); break; }
    const players = db.query(
      "SELECT p.*, r.mu, r.sigma, r.ordinal, r.matches_counted FROM players p LEFT JOIN ratings r ON r.player_id = p.id WHERE p.name LIKE ? ORDER BY r.ordinal DESC NULLS LAST LIMIT 10"
    ).all(`%${search}%`) as any[];
    for (const p of players) {
      console.log(`${p.name} (ID: ${p.id}) | ${p.section ?? "?"} | ordinal: ${p.ordinal?.toFixed(2) ?? "N/A"} | μ: ${p.mu?.toFixed(2) ?? "N/A"} | σ: ${p.sigma?.toFixed(2) ?? "N/A"} | matches: ${p.matches_counted ?? 0}`);
    }
    break;
  }

  case "stats": {
    const db = getDb();
    const players = db.query("SELECT COUNT(*) as cnt FROM players").get() as { cnt: number };
    const matches = db.query("SELECT COUNT(*) as cnt FROM matches").get() as { cnt: number };
    const rated = db.query("SELECT COUNT(*) as cnt FROM ratings").get() as { cnt: number };
    const withResults = db.query("SELECT COUNT(*) as cnt FROM matches WHERE winner_side IS NOT NULL").get() as { cnt: number };
    const tournaments = db.query("SELECT COUNT(*) as cnt FROM tournaments").get() as { cnt: number };
    console.log(`Players: ${players.cnt}`);
    console.log(`Matches: ${matches.cnt} (${withResults.cnt} with results)`);
    console.log(`Tournaments: ${tournaments.cnt}`);
    console.log(`Rated players: ${rated.cnt}`);
    break;
  }

  case "schedule": {
    const { scrapeSchedule, resolveScheduleInput } = await import("./scrape-upcoming-matches");
    const input = process.argv[3];
    if (!input) {
      console.log("Usage: bun src/cli.ts schedule <tournament-id|url>");
      break;
    }
    const { tournamentId, url } = resolveScheduleInput(input);
    await scrapeSchedule(tournamentId, url);
    break;
  }

  default:
    console.log(`Usage: bun src/cli.ts <command>

Commands:
  scan [start] [end]  Scan tournament IDs and store to DB (default: 1-25000)
    --force           Rescan from beginning
  seed                Seed players from players.json
  enrich [n]          Enrich n player profiles from API (default: 50)
  import [file]       Import matches from scraped JSON (default: matches.json)
  scrape [file|api]   Scrape matches from tournaments
  schedule <id|url>   Scrape match schedule for a tournament
  rate [n]            Calculate ratings and show top n (default: 30)
  recalculate [n]     Clear and recalculate all ratings
  leaderboard [n]     Show top n rated players
  player <name>       Search player by name
  stats               Show database statistics`);
}
