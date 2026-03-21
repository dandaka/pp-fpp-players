import { chromium } from "playwright";
import { getDb } from "./db";
import { scrapeMatchesPage } from "./scrape-matches-page";
import { scrapeDrawsPage } from "./scrape-draws-page";
import { crossReference, storeSchedule, storeDrawsMatches } from "./store-schedule";

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
  const tournament = db.query("SELECT name, sport FROM tournaments WHERE id = ?").get(tournamentId) as { name: string; sport: string | null } | null;
  const tournamentName = tournament?.name ?? slug;

  // Only scrape Padel tournaments
  if (tournament?.sport && tournament.sport !== "Padel") {
    console.log(`Skipping ${tournamentName} (sport: ${tournament.sport})`);
    return;
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30_000);
    page.setDefaultTimeout(15_000);

    // Step 1: Scrape Matches page
    console.log(`\n=== Scraping Matches: ${matchesUrl} ===`);
    await page.goto(matchesUrl, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);
    const matches = await scrapeMatchesPage(page, tournamentYear);
    console.log(`Total: ${matches.length} matches from Matches page`);

    // Step 2: Scrape Draws page (Encontros tab)
    console.log(`\n=== Scraping Draws: ${drawsUrl} ===`);
    await page.goto(drawsUrl, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);
    const draws = await scrapeDrawsPage(page);
    console.log(`Total: ${draws.length} draw matches`);

    // Step 3: Cross-reference
    console.log("\n=== Cross-referencing ===");
    const crossRef = crossReference(tournamentId, draws);
    console.log(`Round name mappings: ${crossRef.roundNames.size}`);

    // Step 4: Store matches from Matches page
    console.log("\n=== Storing ===");
    storeSchedule(tournamentId, tournamentName, matches, crossRef);

    // Step 5: Store/update matches from Draws page
    console.log("\n=== Storing Draws ===");
    storeDrawsMatches(tournamentId, tournamentName, draws);

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
