import { enrichPlayerProfiles } from "./sync-players";
import { calculateRatings, printLeaderboard } from "./calculate-ratings";
import { getDb } from "./db";
import { runMigrations } from "./migrations";

const db = getDb();
runMigrations(db);

const cmd = process.argv[2];

switch (cmd) {
  case "discover": {
    const { discoverTournaments, rescanGaps } = await import("./sync-tournaments");
    const db = getDb();
    const subCmd = process.argv[3];
    if (subCmd === "gaps") {
      const gaps = await rescanGaps({ db });
      console.log(`Discovered ${gaps.length} tournaments from gaps`);
    } else {
      const startId = parseInt(process.argv[3] ?? "0") || undefined;
      const endId = parseInt(process.argv[4] ?? "0") || undefined;
      const discovered = await discoverTournaments({ db, startId, endId });
      console.log(`Discovered ${discovered.length} new tournament(s)`);
    }
    break;
  }

  case "sync": {
    const { syncTournamentMatches, syncTournamentPlayers } = await import("./sync-tournaments");
    const tid = parseInt(process.argv[3]);
    if (!tid) { console.log("Usage: bun src/cli.ts sync <tournament-id>"); break; }
    const db = getDb();
    const matchResult = await syncTournamentMatches({ db, tournamentId: tid });
    console.log(`Matches: ${matchResult.inserted} inserted, ${matchResult.updated} updated`);
    const playerResult = await syncTournamentPlayers({ db, tournamentId: tid });
    console.log(`Players: ${playerResult.upserted} upserted`);
    break;
  }

  case "enrich": {
    const allFlag = process.argv.includes("--all");
    const batch = parseInt(process.argv[3] ?? "100");
    await enrichPlayerProfiles(batch, 200, allFlag);
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
    const tPlayers = db.query("SELECT COUNT(*) as cnt FROM tournament_players").get() as { cnt: number };
    console.log(`Players: ${players.cnt}`);
    console.log(`Matches: ${matches.cnt} (${withResults.cnt} with results)`);
    console.log(`Tournaments: ${tournaments.cnt}`);
    console.log(`Tournament players: ${tPlayers.cnt}`);
    console.log(`Rated players: ${rated.cnt}`);
    break;
  }

  case "sync-all": {
    const { syncTournamentMatches, syncTournamentPlayers } = await import("./sync-tournaments");
    const { shouldSkipTournament, clearScrapeFailure, recordScrapeFailure } = await import("./db");
    const db = getDb();
    const tournaments = db.query(`
      SELECT id, name FROM tournaments
      WHERE (sport IS NULL OR sport = 'Padel') AND matches_synced_at IS NULL
      ORDER BY id ASC
    `).all() as { id: number; name: string }[];

    console.log(`Syncing all ${tournaments.length} unsynced Padel tournaments...`);
    let done = 0, errors = 0;

    for (const t of tournaments) {
      const check = shouldSkipTournament(t.id);
      if (check.skip) { done++; continue; }

      try {
        const mr = await syncTournamentMatches({ db, tournamentId: t.id });
        await syncTournamentPlayers({ db, tournamentId: t.id });
        clearScrapeFailure(t.id);
        done++;
        if (done % 50 === 0 || mr.updated > 0) {
          console.log(`[${done}/${tournaments.length}] ${t.name} (${t.id}): ${mr.inserted} new, ${mr.updated} enriched`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        recordScrapeFailure(t.id, msg);
        errors++;
        console.error(`[${done}/${tournaments.length}] FAIL ${t.name} (${t.id}): ${msg}`);
      }
    }

    console.log(`\nDone: ${done} synced, ${errors} errors`);
    const { calculateRatings } = await import("./calculate-ratings");
    console.log("Recalculating ratings...");
    calculateRatings();
    console.log("Complete.");
    break;
  }

  case "daemon": {
    await import("./daemon");
    break;
  }

  case "failures": {
    const { listScrapeFailures, clearScrapeFailure } = await import("./db");
    const subCmd = process.argv[3];
    if (subCmd === "clear") {
      const tid = parseInt(process.argv[4]);
      if (tid) {
        clearScrapeFailure(tid);
        console.log(`Cleared failure record for tournament ${tid}`);
      } else {
        const all = listScrapeFailures();
        for (const f of all) clearScrapeFailure(f.tournamentId);
        console.log(`Cleared ${all.length} failure record(s)`);
      }
    } else {
      const db = getDb();
      const failures = listScrapeFailures();
      if (failures.length === 0) { console.log("No scrape failures recorded"); break; }
      for (const f of failures) {
        const t = db.query("SELECT name FROM tournaments WHERE id = ?").get(f.tournamentId) as { name: string } | null;
        const name = t?.name ?? "Unknown";
        console.log(`[${f.tournamentId}] ${name} — ${f.failure.count} failures, skip until ${f.failure.skipUntil}`);
        console.log(`  Last error: ${f.failure.lastError}`);
      }
    }
    break;
  }

  default:
    console.log(`Usage: bun src/cli.ts <command>

Commands:
  discover [start] [end]  Discover new tournaments via API
  discover gaps            Rescan gaps in known ID range
  sync <tournament-id>     Sync matches + players for a tournament
  sync-all                 Sync ALL unsynced Padel tournaments (runs for hours)
  enrich [n]               Enrich n player profiles from API (default: 100)
  daemon                   Start sync daemon
  rate [n]                 Calculate ratings and show top n (default: 30)
  recalculate [n]          Clear and recalculate all ratings
  leaderboard [n]          Show top n rated players
  player <name>            Search player by name
  stats                    Show database statistics
  failures                 List tournaments with scrape failures
  failures clear [id]      Clear failure records`);
}
