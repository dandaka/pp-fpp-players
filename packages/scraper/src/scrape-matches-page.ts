import type { Page } from "playwright";

export interface ScrapedMatchRow {
  categoryFull: string; // "Masculinos 6 - M6-QP"
  category: string;     // "M6"
  subcategory: string;  // "QP"
  time: string;
  court: string;
  result: string;
  date: string;         // ISO date "2026-03-18"
  sideA: { id: number | null; name: string }[];
  sideB: { id: number | null; name: string }[];
}

interface RawLink {
  side: string;
  href: string;
  text: string;
}

interface RawMatch {
  category: string;
  time: string;
  court: string;
  result: string;
  links: RawLink[];
}

// Portuguese month abbreviations → month number
const PT_MONTHS: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
  jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
};

/**
 * Parse Portuguese date tab text like "sáb, 21 mar" into ISO date.
 * Uses tournamentYear to resolve the year.
 */
export function parsePortugueseDate(tabText: string, tournamentYear: number): string {
  const match = tabText.match(/(\d{1,2})\s+(\w{3})/);
  if (!match) return "";
  const day = match[1].padStart(2, "0");
  const month = PT_MONTHS[match[2].toLowerCase()];
  if (!month) return "";
  return `${tournamentYear}-${month}-${day}`;
}

/**
 * Parse category string like "Masculinos 6 - M6-QP" into parts.
 */
export function parseCategory(raw: string): { category: string; subcategory: string } {
  const m = raw.match(/^(?:Masculinos|Femininos|Mistos)\s+\d+\s*-\s*(\w+)-(.+)$/);
  if (m) return { category: m[1], subcategory: m[2] };
  return { category: raw, subcategory: "" };
}

function extractPlayerId(href: string): number | null {
  const match = href.match(/id=(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

async function scrapeCurrentPage(page: Page): Promise<RawMatch[]> {
  return page.evaluate(() => {
    const results: any[] = [];
    const table = document.querySelector("table");
    if (!table) return results;

    const rows = table.querySelectorAll("tr");
    let currentCourt = "";

    for (const row of rows) {
      if (row.classList.contains("rgGroupHeader")) {
        const span = row.querySelector("span");
        if (span) currentCourt = span.textContent?.trim() || "";
        continue;
      }

      const cells = row.querySelectorAll("td");
      if (cells.length < 7) continue;

      const category = cells[1]?.textContent?.trim() || "";
      if (!category || category === "Torneio") continue;

      const time = cells[2]?.textContent?.trim() || "";
      const result = cells[6]?.textContent?.trim() || "";
      const court = cells[7]?.textContent?.trim() || currentCourt;

      const links: any[] = [];
      cells[3]?.querySelectorAll("a[href*='Dashboard']").forEach((a) => {
        links.push({
          side: "a",
          href: a.getAttribute("href") || "",
          text: a.textContent?.trim() || "",
        });
      });
      cells[5]?.querySelectorAll("a[href*='Dashboard']").forEach((a) => {
        links.push({
          side: "b",
          href: a.getAttribute("href") || "",
          text: a.textContent?.trim() || "",
        });
      });

      results.push({ category, time, result, court, links });
    }
    return results;
  });
}

async function scrapeAllPages(page: Page, date: string, tournamentYear: number): Promise<ScrapedMatchRow[]> {
  const allMatches: ScrapedMatchRow[] = [];
  const isoDate = parsePortugueseDate(date, tournamentYear);

  const firstPage = await scrapeCurrentPage(page);
  allMatches.push(...firstPage.map((raw) => toMatchRow(raw, isoDate)));

  const pageCount = await page.evaluate(() => {
    const links = document.querySelectorAll("a[href*='grid_all_matches']");
    let max = 1;
    links.forEach((a) => {
      const num = parseInt(a.textContent?.trim() || "0");
      if (num > max) max = num;
    });
    return max;
  });

  for (let p = 2; p <= pageCount; p++) {
    const clicked = await page.evaluate((pageNum) => {
      const links = document.querySelectorAll('a[href*="grid_all_matches"]');
      for (const link of links) {
        if (link.textContent?.trim() === String(pageNum)) {
          (link as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, p);

    if (!clicked) break;
    await page.waitForTimeout(2000);

    const pageData = await scrapeCurrentPage(page);
    allMatches.push(...pageData.map((raw) => toMatchRow(raw, isoDate)));
  }

  return allMatches;
}

function toMatchRow(raw: RawMatch, isoDate: string): ScrapedMatchRow {
  const { category, subcategory } = parseCategory(raw.category);
  return {
    categoryFull: raw.category,
    category,
    subcategory,
    time: raw.time,
    court: raw.court,
    result: raw.result,
    date: isoDate,
    sideA: raw.links
      .filter((l) => l.side === "a")
      .map((l) => ({ id: extractPlayerId(l.href), name: l.text })),
    sideB: raw.links
      .filter((l) => l.side === "b")
      .map((l) => ({ id: extractPlayerId(l.href), name: l.text })),
  };
}

/**
 * Scrape all matches from the FPP Matches page.
 * @param page - Playwright page already navigated to the Matches URL
 * @param tournamentYear - Year of the tournament for date resolution
 */
export async function scrapeMatchesPage(
  page: Page,
  tournamentYear: number
): Promise<ScrapedMatchRow[]> {
  const dateTabs = await page.evaluate(() => {
    const tabs: { text: string; id: string }[] = [];
    document.querySelectorAll("a[id*='repeater_days_all_matches']").forEach((a) => {
      tabs.push({
        text: a.textContent?.trim() || "",
        id: a.id,
      });
    });
    return tabs;
  });

  console.log(`Found ${dateTabs.length} date tabs: ${dateTabs.map((t) => t.text).join(", ")}`);

  const allMatches: ScrapedMatchRow[] = [];

  for (const tab of dateTabs) {
    console.log(`Scraping ${tab.text}...`);
    await page.click(`#${tab.id}`);
    await page.waitForTimeout(3000);

    const matches = await scrapeAllPages(page, tab.text, tournamentYear);
    console.log(`  Found ${matches.length} matches`);
    allMatches.push(...matches);
  }

  return allMatches;
}
