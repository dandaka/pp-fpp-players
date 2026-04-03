import { getDb, getCursor, setCursor, shouldSkipTournament, recordScrapeFailure, clearScrapeFailure } from "./db";
import { discoverTournaments, rescanGaps, syncTournamentMatches, syncTournamentPlayers } from "./sync-tournaments";
import { calculateRatings } from "./calculate-ratings";
import { enrichPlayerProfiles } from "./sync-players";
import { runMigrations } from "./migrations";
import { getTournament as getTournamentApi } from "./api";
import { parseDate } from "./parse-date";

const DISCOVERY_INTERVAL = 60;
const SYNC_INTERVAL = 60;
const ENRICH_INTERVAL = 30;
const ENRICH_BATCH_SIZE = 50;
const GAP_RESCAN_HOURS = 24;
const ENRICH_DATES_INTERVAL = 1;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg: string, err: unknown) {
  console.error(`[${new Date().toISOString()}] ${msg}`, err);
}

const RECENT_DAYS = 30;

interface TournamentToSync {
  id: number;
  name: string;
  isRecent: boolean;
  hasPlayers: boolean;
}

function getTournamentsToSync(): TournamentToSync[] {
  const db = getDb();
  const rows = db.query(`
    SELECT
      t.id, t.name,
      CASE WHEN t.date >= datetime('now', '-${RECENT_DAYS} days') THEN 1 ELSE 0 END as isRecent,
      CASE WHEN EXISTS (SELECT 1 FROM tournament_players tp WHERE tp.tournament_id = t.id) THEN 1 ELSE 0 END as hasPlayers
    FROM tournaments t
    WHERE (t.sport IS NULL OR t.sport = 'Padel')
      AND (t.matches_synced_at IS NULL OR t.date >= datetime('now', '-${RECENT_DAYS} days'))
    ORDER BY
      CASE WHEN t.matches_synced_at IS NULL THEN 0 ELSE 1 END,
      t.matches_synced_at ASC
    LIMIT 10000
  `).all() as Array<{ id: number; name: string; isRecent: number; hasPlayers: number }>;
  return rows.map(r => ({ id: r.id, name: r.name, isRecent: r.isRecent === 1, hasPlayers: r.hasPlayers === 1 }));
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
      const skipPlayers = !t.isRecent && t.hasPlayers;
      log(`Syncing matches: ${t.name} (ID: ${t.id})${skipPlayers ? " [skip players: old + already populated]" : ""}`);
      await syncTournamentMatches({ db, tournamentId: t.id });
      if (!skipPlayers) {
        await syncTournamentPlayers({ db, tournamentId: t.id });
      }
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

async function enrichDatesLoop() {
  log("=== Date Enrichment starting ===");

  try {
    const db = getDb();
    const offsetStr = getCursor("enrich_dates_offset") ?? "0";
    let offset = parseInt(offsetStr);

    const rows = db.query(
      "SELECT id FROM tournaments WHERE date IS NULL ORDER BY id"
    ).all() as Array<{ id: number }>;

    if (rows.length === 0) {
      log("No more NULL-date tournaments — date enrichment complete");
      log("=== Date Enrichment complete ===\n");
      return;
    }

    const updateDate = db.prepare("UPDATE tournaments SET date = ? WHERE id = ?");
    let enriched = 0;

    for (const row of rows) {
      try {
        const tournament = await getTournamentApi(row.id);
        if (!tournament || !tournament.id) continue;

        const dateInfo = tournament.info_texts?.find(
          (t: any) => t.title === "Date" || t.title === "Data"
        );
        const date = parseDate(dateInfo?.text, tournament.header_texts);

        if (date) {
          updateDate.run(date, row.id);
          enriched++;
          log(`Enriched date for tournament ${row.id}: ${date}`);
        }

        await Bun.sleep(200);
      } catch (err) {
        logError(`Failed to enrich date for tournament ${row.id}:`, err);
      }
    }

    offset += rows.length;
    setCursor("enrich_dates_offset", String(offset));

    log(`Date enrichment: ${enriched}/${rows.length} tournaments updated (offset: ${offset})`);
  } catch (err) {
    logError("Date enrichment failed:", err);
  }

  log("=== Date Enrichment complete ===\n");
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

  // Run pending migrations before anything else
  const db = getDb();
  const { ranCount, needsResync } = runMigrations(db);
  if (ranCount > 0) {
    log(`Ran ${ranCount} migration(s)${needsResync ? " — full resync triggered" : ""}`);
  }

  log(`Discovery interval: ${DISCOVERY_INTERVAL}min`);
  log(`Sync interval: ${SYNC_INTERVAL}min`);
  log(`Enrich interval: ${ENRICH_INTERVAL}min (batch: ${ENRICH_BATCH_SIZE})`);
  log(`Enrich dates interval: ${ENRICH_DATES_INTERVAL}min`);
  log("");

  const discovery = scheduleLoop("discovery", discoveryLoop, DISCOVERY_INTERVAL);
  const sync = scheduleLoop("sync", syncLoop, SYNC_INTERVAL);
  const enrich = scheduleLoop("enrich", enrichLoop, ENRICH_INTERVAL);
  const enrichDates = scheduleLoop("enrichDates", enrichDatesLoop, ENRICH_DATES_INTERVAL);

  await discovery();

  // If resync was triggered, start sync immediately instead of waiting 5min
  if (needsResync) {
    log("Starting sync loop immediately (resync triggered)");
    sync();
  } else {
    setTimeout(sync, 5 * 60 * 1000);
    log("Sync loop will start in 5 minutes");
  }

  setTimeout(enrich, 2 * 60 * 1000);
  log("Enrich loop will start in 2 minutes");

  setTimeout(enrichDates, 1 * 60 * 1000);
  log("Enrich dates loop will start in 1 minute\n");

  process.on("SIGINT", () => { log("Received SIGINT, shutting down..."); process.exit(0); });
  process.on("SIGTERM", () => { log("Received SIGTERM, shutting down..."); process.exit(0); });
}

main().catch((err) => {
  logError("Daemon fatal error:", err);
  process.exit(1);
});
