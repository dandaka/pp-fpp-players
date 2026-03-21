import type { Page } from "playwright";

export interface DrawEntry {
  categoryId: number;
  categoryName: string; // e.g. "Masculinos 1"
  subDraw: string;      // "QP" or "Quali"
  roundNumber: number;
  position: number;
  player1Name: string;
  player2Name: string;  // doubles partner
  licenseNumber: string | null;
  seeding: string | null; // "(1)", "WC", etc.
  score: string;        // completed match score or ""
  scheduleInfo: string; // "Court 1 10:00" or ""
}

export interface DrawData {
  entries: DrawEntry[];
  roundLabels: Map<string, Map<number, string>>; // categoryId+subDraw → roundNumber → "R32"|"QF"|etc.
}

const ROUND_LABELS: Record<number, string> = {
  6: "R32", 5: "R16", 4: "QF", 3: "SF", 2: "F",
};

/**
 * Infer round labels based on draw size.
 * The highest round number = first round. Round 2 is always final.
 */
export function inferRoundLabels(roundNumbers: number[]): Map<number, string> {
  const labels = new Map<number, string>();
  for (const rn of roundNumbers) {
    if (ROUND_LABELS[rn]) labels.set(rn, ROUND_LABELS[rn]);
  }
  return labels;
}

/**
 * Scrape all draws from the FPP Draws page.
 * @param page - Playwright page already navigated to the Draws URL
 */
export async function scrapeDrawsPage(page: Page): Promise<DrawData> {
  const entries: DrawEntry[] = [];
  const roundLabels = new Map<string, Map<number, string>>();

  // Get all category options from dropdown
  const categories = await page.evaluate(() => {
    const select = document.querySelector("select[id*='draws']") as HTMLSelectElement | null;
    if (!select) return [];
    return Array.from(select.options).map((opt) => ({
      value: parseInt(opt.value),
      text: opt.textContent?.trim() || "",
    }));
  });

  console.log(`Found ${categories.length} draw categories`);

  for (const cat of categories) {
    console.log(`  Scraping draw: ${cat.text}...`);

    // Select category from dropdown
    await page.selectOption("select[id*='draws']", String(cat.value));
    await page.waitForTimeout(2000);

    // Get sub-draw tabs (QP, Quali)
    const subDrawTabs = await page.evaluate(() => {
      const tabs: { text: string; id: string }[] = [];
      document.querySelectorAll("a[id*='repeater_draw']").forEach((a) => {
        tabs.push({
          text: a.textContent?.trim() || "",
          id: a.id,
        });
      });
      return tabs.length > 0 ? tabs : [{ text: "QP", id: "" }]; // default if no tabs
    });

    for (const subTab of subDrawTabs) {
      if (subTab.id) {
        await page.click(`#${subTab.id}`);
        await page.waitForTimeout(2000);
      }

      const drawEntries = await page.evaluate((catInfo) => {
        const results: any[] = [];
        // Draws are rendered as nested tables with round columns
        const roundCols = document.querySelectorAll("[class*='round'], [id*='round']");

        // Try to extract from bracket structure
        const cells = document.querySelectorAll("td[class*='draw'], div[class*='draw']");
        cells.forEach((cell, idx) => {
          const nameSpan = cell.querySelector("span");
          const name = nameSpan?.textContent?.trim() || "";
          if (!name) return;

          // Extract license number if present (format: "12345 - Player Name" or separate span)
          const licenseMatch = name.match(/^(\d{4,6})\s*[-–]\s*/);
          const license = licenseMatch ? licenseMatch[1] : null;
          const cleanName = licenseMatch ? name.replace(licenseMatch[0], "").trim() : name;

          // Extract seeding
          const seedMatch = cleanName.match(/\((\d+|WC)\)\s*$/);
          const seeding = seedMatch ? seedMatch[1] : null;
          const finalName = seedMatch ? cleanName.replace(seedMatch[0], "").trim() : cleanName;

          results.push({
            name: finalName,
            license,
            seeding,
            position: idx,
          });
        });

        return results;
      }, { value: cat.value, text: cat.text });

      // Parse entries into DrawEntry objects
      for (const raw of drawEntries) {
        entries.push({
          categoryId: cat.value,
          categoryName: cat.text,
          subDraw: subTab.text,
          roundNumber: 0, // Will be inferred
          position: raw.position,
          player1Name: raw.name,
          player2Name: "",
          licenseNumber: raw.license,
          seeding: raw.seeding,
          score: "",
          scheduleInfo: "",
        });
      }
    }
  }

  return { entries, roundLabels };
}
