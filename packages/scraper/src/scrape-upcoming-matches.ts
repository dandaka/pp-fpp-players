import { chromium } from "playwright";
import { getDb } from "./db";
import { scrapeMatchesPage } from "./scrape-matches-page";
import { scrapeDrawsPage } from "./scrape-draws-page";
import { crossReference, storeSchedule } from "./store-schedule";

function resolveTournamentUrl(input: string): { matchesUrl: string; drawsUrl: string; slug: string } {
  let slug = input;

  // If full URL, extract slug
  if (input.startsWith("http")) {
    const urlMatch = input.match(/Tournaments\/([^/]+)/);
    if (urlMatch) slug = urlMatch[1];
  }

  const base = `https://fpp.tiepadel.com/Tournaments/${slug}`;
  return {
    matchesUrl: `${base}/Matches`,
    drawsUrl: `${base}/Draws`,
    slug,
  };
}

function getTournamentYear(tournamentId: number): number {
  const db = getDb();
  const row = db.query("SELECT date FROM tournaments WHERE id = ?").get(tournamentId) as { date: string | null } | null;
  if (row?.date) {
    const year = parseInt(row.date.substring(0, 4));
    if (!isNaN(year)) return year;
  }
  return new Date().getFullYear();
}

export async function scrapeSchedule(tournamentId: number, urlOrSlug: string) {
  const { matchesUrl, drawsUrl, slug } = resolveTournamentUrl(urlOrSlug);
  const tournamentYear = getTournamentYear(tournamentId);

  const db = getDb();
  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  const tournamentName = tournament?.name ?? slug;

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    // Step 1: Scrape Matches page
    console.log(`\n=== Scraping Matches: ${matchesUrl} ===`);
    await page.goto(matchesUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const matches = await scrapeMatchesPage(page, tournamentYear);
    console.log(`Total: ${matches.length} matches from Matches page`);

    // Step 2: Scrape Draws page
    console.log(`\n=== Scraping Draws: ${drawsUrl} ===`);
    await page.goto(drawsUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const draws = await scrapeDrawsPage(page);
    console.log(`Total: ${draws.entries.length} draw entries`);

    // Step 3: Cross-reference
    console.log("\n=== Cross-referencing ===");
    const crossRef = crossReference(matches, draws.entries);
    console.log(`License updates: ${crossRef.licenseUpdates.length}`);

    // Step 4: Store
    console.log("\n=== Storing ===");
    storeSchedule(tournamentId, tournamentName, matches, crossRef);

    // Update sync timestamp
    db.run(
      "UPDATE tournaments SET matches_synced_at = datetime('now') WHERE id = ?",
      [tournamentId]
    );

    console.log("\nDone!");
  } finally {
    await browser.close();
  }
}

/**
 * Resolve CLI input (tournament ID or URL) to { tournamentId, url }.
 * Exported so CLI can reuse without duplicating logic.
 */
export function resolveScheduleInput(input: string): { tournamentId: number; url: string } {
  const db = getDb();
  const isId = /^\d+$/.test(input);

  if (isId) {
    const row = db.query("SELECT link_web FROM tournaments WHERE id = ?").get(parseInt(input)) as { link_web: string | null } | null;
    if (!row?.link_web) throw new Error(`Tournament ${input} not found or has no link_web`);
    return { tournamentId: parseInt(input), url: row.link_web };
  }

  const slug = input.match(/Tournaments\/([^/]+)/)?.[1] ?? input;
  const row = db.query("SELECT id FROM tournaments WHERE link_web LIKE ?").get(`%${slug}%`) as { id: number } | null;
  if (!row) throw new Error(`Tournament not found for slug: ${slug}`);
  return { tournamentId: row.id, url: input };
}

// Direct execution
if (import.meta.main) {
  const input = process.argv[2];
  if (!input) {
    console.log("Usage: bun src/scrape-upcoming-matches.ts <tournament-id|url>");
    process.exit(1);
  }
  const { tournamentId, url } = resolveScheduleInput(input);
  await scrapeSchedule(tournamentId, url);
}
