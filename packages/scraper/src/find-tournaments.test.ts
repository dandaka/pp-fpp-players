import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";

// Tournament 23404: "XII Open PSC by Águas do Caramulo"
// This tournament exists in the TieSports API but has 0 news feed items
// (started 2026-03-25, no match results posted yet).
// The scanner currently only discovers tournaments via the news feed,
// so it silently skips tournaments with no results.

const TOURNAMENT_ID = 23404;
const TOURNAMENT_NAME = "XII Open PSC by Águas do Caramulo";

const NEWS_FEED_URL = "https://fpp.tiepadel.com/methods.aspx/get_news_by_codtou_header";

describe("tournament discovery: XII Open PSC (ID 23404)", () => {
  test("news feed returns 0 items for tournament 23404", async () => {
    // This confirms the root cause: the news feed has no data for this tournament
    const res = await fetch(NEWS_FEED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codtou_header: TOURNAMENT_ID, count_items: 0 }),
    });
    const json = (await res.json()) as { d: unknown[] };
    // The news feed returns empty for new tournaments with no match results
    expect(json.d).toHaveLength(0);
  });

  test("TieSports API confirms tournament 23404 exists", async () => {
    const { getTournament } = await import("./api");
    const detail = await getTournament(TOURNAMENT_ID);
    expect(detail.name).toBe(TOURNAMENT_NAME);
    expect(detail.link_web).toContain("XIIOpenPSCbyAguasdoCaramulo");
  });

  test("getTournaments API list includes tournament 23404", async () => {
    const { getTournaments } = await import("./api");
    const tournaments = await getTournaments(0);
    const found = tournaments.find((t) => t.id === TOURNAMENT_ID);
    expect(found).toBeDefined();
    expect(found!.title).toBe(TOURNAMENT_NAME);
  });

  test("scanTournaments discovers tournament 23404", async () => {
    // This test FAILS: scanTournaments uses the news feed which returns empty
    // for tournaments with no match results yet, so it never finds 23404.
    //
    // The fix should make the scanner also use getTournaments() or getTournament()
    // as a fallback discovery mechanism.

    // Use in-memory DB to avoid touching the real one
    const origEnv = process.env.DB_PATH;
    const tmpDb = `/tmp/test-scan-${Date.now()}.db`;
    process.env.DB_PATH = tmpDb;

    // Force fresh db module
    // We need to scan just the single ID to keep the test fast
    try {
      const { scanTournaments } = await import("./find-tournaments");

      await scanTournaments(TOURNAMENT_ID, TOURNAMENT_ID);

      const db = new Database(tmpDb);
      const row = db.query("SELECT id, name FROM tournaments WHERE id = ?").get(TOURNAMENT_ID) as {
        id: number;
        name: string;
      } | null;
      db.close();

      // THIS ASSERTION CURRENTLY FAILS:
      // Tournament 23404 is not found because the news feed returns 0 items
      expect(row).not.toBeNull();
      expect(row!.id).toBe(TOURNAMENT_ID);
      expect(row!.name).toBe(TOURNAMENT_NAME);
    } finally {
      process.env.DB_PATH = origEnv;
      try { require("fs").unlinkSync(tmpDb); } catch {}
    }
  });
});

describe("getTournaments pagination", () => {
  test("getTournaments should paginate to find all tournaments", async () => {
    // Currently getTournaments(0) returns only ~7 recent tournaments (one page).
    // scrapeAllTournaments("api") calls it once without pagination.
    // This test verifies that pagination is needed and currently broken.
    const { getTournaments } = await import("./api");

    const page0 = await getTournaments(0);
    expect(page0.length).toBeGreaterThan(0);

    // If there are more tournaments, fetching with offset should return different ones
    if (page0.length >= 7) {
      const page1 = await getTournaments(page0.length);
      // There should be more tournaments beyond the first page
      // This test documents that pagination exists but is unused
      expect(page1.length).toBeGreaterThan(0);

      // Pages should not overlap
      const page0Ids = new Set(page0.map((t) => t.id));
      const overlap = page1.filter((t) => page0Ids.has(t.id));
      expect(overlap).toHaveLength(0);
    }
  });
});
