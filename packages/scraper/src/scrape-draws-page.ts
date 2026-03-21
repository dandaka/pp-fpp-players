import type { Page } from "playwright";

export interface DrawMatch {
  categoryName: string;   // "Masculinos 6"
  subDraw: string;        // "M6-QP" or "M6-Quali" or "QP" (default)
  roundName: string;      // "16 avos de final", "Oitavos de final", "Quartos de Final"
  dateTime: string;       // "2026-03-21, Não antes de 21:00" or "2026-03-19, 20:15"
  sideA: { id: number | null; name: string }[];
  sideB: { id: number | null; name: string }[];
  result: string;         // "6-1  6-2" or "" if not played
  court: string;          // "CAMPO 1-ANA JORGE - REMAX"
}

/**
 * Normalize Portuguese date-time strings to English.
 * "2026-03-21, Não antes de 21:00" → "2026-03-21, After 21:00"
 * "2026-03-21, Início às 17:00" → "2026-03-21, 17:00"
 */
function normalizeDatetime(dt: string): string {
  return dt
    .replace(/Não antes de\s*/g, "After ")
    .replace(/Início às\s*/g, "");
}

function extractPlayerId(href: string): number | null {
  const match = href.match(/id=(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

/**
 * Scrape match rows from the Encontros table currently displayed on the page.
 */
async function scrapeEncontrosTable(page: Page): Promise<{
  dateTime: string;
  sideA: { id: number | null; name: string }[];
  sideB: { id: number | null; name: string }[];
  result: string;
  court: string;
  roundName: string;
}[]> {
  const rawRows = await page.evaluate(() => {
    const table = document.querySelector("table.rgMasterTable") || document.querySelector("table");
    if (!table) return [];

    const rows = table.querySelectorAll("tr");
    const results: any[] = [];
    let currentRound = "";

    for (const row of rows) {
      if (row.classList.contains("rgGroupHeader")) {
        const cells = row.querySelectorAll("td");
        currentRound = cells[1]?.textContent?.trim() || "";
        continue;
      }

      const cells = row.querySelectorAll("td");
      if (cells.length < 7) continue;

      const dateTime = cells[1]?.textContent?.trim() || "";
      if (!dateTime || dateTime === "Date") continue;

      const sideALinks = Array.from(cells[2]?.querySelectorAll("a[href*='Dashboard']") || []);
      const sideBLinks = Array.from(cells[4]?.querySelectorAll("a[href*='Dashboard']") || []);

      if (sideALinks.length === 0 && sideBLinks.length === 0) continue;

      const sideA = sideALinks.map((a: any) => ({
        href: a.getAttribute("href") || "",
        name: a.textContent?.trim() || "",
      }));
      const sideB = sideBLinks.map((a: any) => ({
        href: a.getAttribute("href") || "",
        name: a.textContent?.trim() || "",
      }));

      const result = cells[5]?.textContent?.trim() || "";
      const court = cells[6]?.textContent?.trim() || "";

      results.push({ dateTime, sideA, sideB, result, court, roundName: currentRound });
    }
    return results;
  });

  return rawRows.map((raw: any) => ({
    ...raw,
    dateTime: normalizeDatetime(raw.dateTime),
    sideA: raw.sideA.map((p: any) => ({ id: extractPlayerId(p.href), name: p.name })),
    sideB: raw.sideB.map((p: any) => ({ id: extractPlayerId(p.href), name: p.name })),
  }));
}

/**
 * Scrape all draws from the FPP Draws page using the Encontros (matches) tab.
 * Returns structured match data with dates, scores, player IDs, courts, and round names.
 */
export async function scrapeDrawsPage(page: Page): Promise<DrawMatch[]> {
  const drawsUrl = page.url();
  const allMatches: DrawMatch[] = [];

  // Step 1: Collect all category options from the dropdown
  const categories = await page.evaluate(() => {
    const select = document.getElementById("drop_tournaments") as HTMLSelectElement | null;
    if (!select) return [];
    return Array.from(select.options)
      .filter((opt) => opt.value && opt.value !== "0")
      .map((opt) => ({
        value: opt.value,
        text: opt.textContent?.trim() || "",
      }));
  });

  console.log(`Found ${categories.length} draw categories`);

  // Step 2: For each category, reload page, select, click Encontros, scrape
  for (const cat of categories) {
    console.log(`  Scraping draw: ${cat.text}...`);

    // Reload draws page to get fresh dropdown
    await page.goto(drawsUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Select category (triggers __doPostBack, page re-renders)
    await page.selectOption("#drop_tournaments", cat.value);
    await page.waitForTimeout(3000);

    // Check for sub-draw tabs (e.g. M6-QP, M6-Quali, Grupo A, Grupo B)
    const subDrawTabs = await page.evaluate(() => {
      const navTabIds = new Set([
        "link_tournament_open_draw", "link_tournament_open_matches",
        "link_tournament_open_teams", "link_tournament_open_info",
      ]);
      const tabs: { text: string; id: string }[] = [];
      const menuLinks = document.querySelectorAll("#menu_inside_tournament a, .menu_inside_tournament a");
      for (const a of menuLinks) {
        const text = a.textContent?.trim() || "";
        if (text && a.id && !navTabIds.has(a.id)) {
          tabs.push({ text, id: a.id });
        }
      }
      // Also check for repeater-based sub-draw tabs
      document.querySelectorAll("a[id*='repeater_draw']").forEach((a) => {
        const text = a.textContent?.trim() || "";
        if (text && !tabs.some(t => t.text === text)) {
          tabs.push({ text, id: a.id });
        }
      });
      return tabs;
    });

    const tabsToProcess = subDrawTabs.length > 0 ? subDrawTabs : [{ text: "QP", id: "" }];

    for (const subTab of tabsToProcess) {
      // Click sub-draw tab if needed
      if (subTab.id) {
        await page.click(`#${subTab.id}`);
        await page.waitForTimeout(2000);
      }

      // Click Encontros inner tab
      const clicked = await page.evaluate(() => {
        const el = document.getElementById("link_tournament_open_matches");
        if (el) { el.click(); return true; }
        return false;
      });

      if (!clicked) {
        console.log(`    Could not find Encontros tab for ${cat.text} ${subTab.text}`);
        continue;
      }

      await page.waitForTimeout(2000);

      // Scrape the matches table
      const matches = await scrapeEncontrosTable(page);
      console.log(`    ${subTab.text}: ${matches.length} matches`);

      for (const m of matches) {
        allMatches.push({
          categoryName: cat.text,
          subDraw: subTab.text,
          roundName: m.roundName,
          dateTime: m.dateTime,
          sideA: m.sideA,
          sideB: m.sideB,
          result: m.result,
          court: m.court,
        });
      }
    }
  }

  return allMatches;
}
