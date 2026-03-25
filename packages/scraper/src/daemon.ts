import { getDb, getCursor, setCursor, shouldSkipTournament, recordScrapeFailure, clearScrapeFailure } from "./db";
import { discoverTournaments, rescanGaps, syncTournamentMatches, syncTournamentPlayers } from "./sync-tournaments";
import { calculateRatings } from "./calculate-ratings";
import { enrichPlayerProfiles } from "./sync-players";

const DISCOVERY_INTERVAL = 60;
const SYNC_INTERVAL = 60;
const ENRICH_INTERVAL = 30;
const ENRICH_BATCH_SIZE = 50;
const GAP_RESCAN_HOURS = 24;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg: string, err: unknown) {
  console.error(`[${new Date().toISOString()}] ${msg}`, err);
}

function getTournamentsToSync(): { id: number; name: string }[] {
  const db = getDb();
  return db.query(`
    SELECT id, name FROM tournaments
    WHERE sport IS NULL OR sport = 'Padel'
    ORDER BY
      CASE WHEN matches_synced_at IS NULL THEN 0 ELSE 1 END,
      matches_synced_at ASC
    LIMIT 20
  `).all() as { id: number; name: string }[];
}

async function discoveryLoop() {
  log("=== Discovery Sync starting ===");

  try {
    const db = getDb();
    const discovered = await discoverTournaments({ db });
    log(`Discovered ${discovered.length} new tournament(s)`);

    const lastGapRescan = getCursor("last_gap_rescan");
    const hoursSinceRescan = lastGapRescan
      ? (Date.now() - new Date(lastGapRescan).getTime()) / 3600_000
      : Infinity;
    if (hoursSinceRescan >= GAP_RESCAN_HOURS) {
      log("Running 24h gap rescan...");
      const gaps = await rescanGaps({ db });
      log(`Gap rescan: ${gaps.length} new tournament(s)`);
      setCursor("last_gap_rescan", new Date().toISOString());
    }
  } catch (err) {
    logError("Tournament discovery failed:", err);
  }

  try {
    log("Recalculating ratings...");
    calculateRatings();
  } catch (err) {
    logError("Rating calculation failed:", err);
  }

  log("=== Discovery Sync complete ===\n");
}

async function syncLoop() {
  log("=== Match/Player Sync starting ===");

  const tournaments = getTournamentsToSync();
  if (tournaments.length === 0) {
    log("No tournaments to sync");
    log("=== Match/Player Sync complete ===\n");
    return;
  }

  log(`Syncing ${tournaments.length} tournament(s)`);

  const db = getDb();

  for (const t of tournaments) {
    const check = shouldSkipTournament(t.id);
    if (check.skip) {
      log(`Skipping ${t.name} (ID: ${t.id}): ${check.reason}`);
      continue;
    }

    try {
      log(`Syncing matches: ${t.name} (ID: ${t.id})`);
      await syncTournamentMatches({ db, tournamentId: t.id });
      await syncTournamentPlayers({ db, tournamentId: t.id });
      clearScrapeFailure(t.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordScrapeFailure(t.id, msg);
      logError(`Sync failed for ${t.name} (${t.id}):`, err);
    }
  }

  try {
    log("Recalculating ratings...");
    calculateRatings();
  } catch (err) {
    logError("Rating calculation failed:", err);
  }

  log("=== Match/Player Sync complete ===\n");
}

async function enrichLoop() {
  log("=== Player Enrichment starting ===");

  try {
    await enrichPlayerProfiles(ENRICH_BATCH_SIZE, 200, true);
  } catch (err) {
    logError("Player enrichment failed:", err);
  }

  log("=== Player Enrichment complete ===\n");
}

function scheduleLoop(name: string, fn: () => Promise<void>, intervalMin: number) {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      logError(`Unhandled error in ${name}:`, err);
    }
    setTimeout(run, intervalMin * 60 * 1000);
  };
  return run;
}

async function main() {
  log("Daemon starting (API-based)");
  log(`Discovery interval: ${DISCOVERY_INTERVAL}min`);
  log(`Sync interval: ${SYNC_INTERVAL}min`);
  log(`Enrich interval: ${ENRICH_INTERVAL}min (batch: ${ENRICH_BATCH_SIZE})`);
  log("");

  const discovery = scheduleLoop("discovery", discoveryLoop, DISCOVERY_INTERVAL);
  const sync = scheduleLoop("sync", syncLoop, SYNC_INTERVAL);
  const enrich = scheduleLoop("enrich", enrichLoop, ENRICH_INTERVAL);

  await discovery();

  setTimeout(sync, 5 * 60 * 1000);
  log("Sync loop will start in 5 minutes");

  setTimeout(enrich, 2 * 60 * 1000);
  log("Enrich loop will start in 2 minutes\n");

  process.on("SIGINT", () => { log("Received SIGINT, shutting down..."); process.exit(0); });
  process.on("SIGTERM", () => { log("Received SIGTERM, shutting down..."); process.exit(0); });
}

main().catch((err) => {
  logError("Daemon fatal error:", err);
  process.exit(1);
});
