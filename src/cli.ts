import { seedPlayersFromJson, enrichPlayerProfiles } from "./sync-players";
import { syncPlayerMatches } from "./sync-matches";
import { calculateRatings, printLeaderboard } from "./calculate-ratings";
import { getDb } from "./db";

const cmd = process.argv[2];

switch (cmd) {
  case "seed":
    await seedPlayersFromJson();
    break;

  case "enrich":
    await enrichPlayerProfiles(parseInt(process.argv[3] ?? "50"));
    break;

  case "sync":
    await syncPlayerMatches();
    break;

  case "rate":
    calculateRatings();
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;

  case "leaderboard":
    printLeaderboard(parseInt(process.argv[3] ?? "30"));
    break;

  case "stats": {
    const db = getDb();
    const players = db.query("SELECT COUNT(*) as cnt FROM players").get() as { cnt: number };
    const matches = db.query("SELECT COUNT(*) as cnt FROM matches").get() as { cnt: number };
    const rated = db.query("SELECT COUNT(*) as cnt FROM ratings").get() as { cnt: number };
    const withResults = db.query("SELECT COUNT(*) as cnt FROM matches WHERE winner_side IS NOT NULL").get() as { cnt: number };
    console.log(`Players: ${players.cnt}`);
    console.log(`Matches: ${matches.cnt} (${withResults.cnt} with results)`);
    console.log(`Rated players: ${rated.cnt}`);
    break;
  }

  case "full":
    console.log("=== Full sync pipeline ===");
    await seedPlayersFromJson();
    await syncPlayerMatches();
    calculateRatings();
    printLeaderboard();
    break;

  default:
    console.log(`Usage: bun src/cli.ts <command>

Commands:
  seed          Seed players from players.json
  enrich [n]    Enrich n player profiles from API (default: 50)
  sync          Sync all player matches from API
  rate [n]      Calculate ratings and show top n (default: 30)
  leaderboard [n]  Show top n rated players
  stats         Show database statistics
  full          Run full pipeline: seed → sync → rate`);
}
