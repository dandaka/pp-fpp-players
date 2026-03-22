import { chromium } from "playwright";
import { getDb, shouldSkipTournament, recordScrapeFailure, clearScrapeFailure } from "./db";
import { scrapeAllTournaments } from "./scrape-all-tournaments";
import { scrapeSchedule } from "./scrape-upcoming-matches";
import { calculateRatings } from "./calculate-ratings";
import { scanTournaments } from "./find-tournaments";
import { SKIP_PLAYWRIGHT_PATTERNS } from "./skip-list";

// Intervals in minutes
const NEWS_FEED_INTERVAL = 60;
const DRAWS_INTERVAL = 60;
const SCRAPE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per tournament
const BROWSER_RECYCLE_EVERY = 5; // Restart browser every N tournaments to cap memory

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg: string, err: unknown) {
  console.error(`[${new Date().toISOString()}] ${msg}`, err);
}

/**
 * Find tournaments with matches in the last 7 days or future,
 * that have a link_web (needed for draws scraping).
 */
function getActiveTournaments(): { id: number; name: string; url: string }[] {
  const db = getDb();
  const rows = db.query(`
    SELECT DISTINCT t.id, t.name, t.link_web
    FROM tournaments t
    JOIN matches m ON m.tournament_id = t.id OR m.tournament_name = t.name
    WHERE m.date_time >= date('now', '-7 days')
      AND t.link_web IS NOT NULL
      AND (t.sport IS NULL OR t.sport = 'Padel')
    ORDER BY t.id DESC
  `).all() as { id: number; name: string; link_web: string }[];

  return rows
    .filter((r) => !SKIP_PLAYWRIGHT_PATTERNS.some((p) => p.test(r.name)))
    .map((r) => ({ id: r.id, name: r.name, url: r.link_web }));
}

/**
 * Loop 1: Scan for new tournaments, scrape news feed, recalculate ratings.
 */
async function newsFeedLoop() {
  log("=== News Feed Sync starting ===");

  try {
    // Discover new tournaments
    log("Scanning for new tournaments...");
    await scanTournaments(1, 25000);
  } catch (err) {
    logError("Tournament scan failed:", err);
  }

  try {
    // Scrape match results from news feed API
    log("Scraping match results from news feed...");
    await scrapeAllTournaments("db");
  } catch (err) {
    logError("News feed scrape failed:", err);
  }

  try {
    log("Recalculating ratings...");
    calculateRatings();
  } catch (err) {
    logError("Rating calculation failed:", err);
  }

  log("=== News Feed Sync complete ===\n");
}

/**
 * Loop 2: Scrape draws for active tournaments.
 */
async function drawsLoop() {
  log("=== Draws Sync starting ===");

  const active = getActiveTournaments();
  if (active.length === 0) {
    log("No active tournaments found");
    log("=== Draws Sync complete ===\n");
    return;
  }

  log(`Found ${active.length} active tournament(s): ${active.map((t) => t.name).join(", ")}`);

  // Share one browser, recycle every N tournaments to cap memory
  let browser = await chromium.launch({ headless: true });
  let usedCount = 0;

  try {
    for (const t of active) {
      const check = shouldSkipTournament(t.id);
      if (check.skip) {
        log(`Skipping ${t.name} (ID: ${t.id}): ${check.reason}`);
        continue;
      }

      // Recycle browser to free accumulated memory
      if (usedCount >= BROWSER_RECYCLE_EVERY) {
        log(`Recycling browser after ${usedCount} tournaments`);
        await browser.close().catch(() => {});
        browser = await chromium.launch({ headless: true });
        usedCount = 0;
      }

      try {
        log(`Scraping draws for: ${t.name} (ID: ${t.id})`);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), SCRAPE_TIMEOUT_MS);
        try {
          await scrapeSchedule(t.id, t.url, { signal: ac.signal, browser });
        } finally {
          clearTimeout(timer);
        }
        usedCount++;
        clearScrapeFailure(t.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        recordScrapeFailure(t.id, msg);
        logError(`Draws scrape failed for ${t.name} (${t.id}):`, err);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  try {
    log("Recalculating ratings...");
    calculateRatings();
  } catch (err) {
    logError("Rating calculation failed:", err);
  }

  log("=== Draws Sync complete ===\n");
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
  // Stagger start: draws loop starts 5 min after news feed
  return run;
}

async function main() {
  log("Daemon starting");
  log(`News feed interval: ${NEWS_FEED_INTERVAL}min`);
  log(`Draws interval: ${DRAWS_INTERVAL}min`);
  log("");

  // Run both loops immediately on startup
  // News feed first (fast, API only), then draws (slow, browser)
  const newsLoop = scheduleLoop("news-feed", newsFeedLoop, NEWS_FEED_INTERVAL);
  const drawLoop = scheduleLoop("draws", drawsLoop, DRAWS_INTERVAL);

  // Start news feed immediately
  await newsLoop();

  // Start draws loop (staggered by 5 min to avoid overlap on startup)
  setTimeout(drawLoop, 5 * 60 * 1000);
  log("Draws loop will start in 5 minutes\n");

  // Keep process alive
  process.on("SIGINT", () => {
    log("Received SIGINT, shutting down...");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    log("Received SIGTERM, shutting down...");
    process.exit(0);
  });
}

main().catch((err) => {
  logError("Daemon fatal error:", err);
  process.exit(1);
});
