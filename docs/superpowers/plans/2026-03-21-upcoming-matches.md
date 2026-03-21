# Upcoming Tournament Matches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape tournament match schedules from fpp.tiepadel.com, store in DB with dedup/enrichment, and display upcoming matches on tournament pages.

**Architecture:** Playwright scrapes Matches page (player IDs + schedules) and Draws page (license numbers + round structure). Cross-reference by player name. Store using deterministic GUIDs for idempotent upserts. Web UI shows upcoming matches grouped by date in a new tab on tournament pages.

**Tech Stack:** Playwright, bun:sqlite, Next.js (App Router), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-21-upcoming-matches-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/scraper/src/db.ts` | Modify | Add `tournament_id`, `court`, `category`, `subcategory` columns + indexes to `matches` |
| `packages/scraper/src/scrape-matches-page.ts` | Create | Playwright scraper for FPP Matches page (date tabs + pagination) |
| `packages/scraper/src/scrape-draws-page.ts` | Create | Playwright scraper for FPP Draws page (brackets, license numbers, rounds) |
| `packages/scraper/src/store-schedule.ts` | Create | Cross-reference, dedup, GUID generation, DB upsert logic |
| `packages/scraper/src/scrape-upcoming-matches.ts` | Rewrite | Orchestrator: calls scrape-matches-page → scrape-draws-page → store-schedule |
| `packages/scraper/src/cli.ts` | Modify | Add `schedule` command |
| `packages/db/src/queries/tournaments.ts` | Modify | Add `getTournamentMatches()` for upcoming + completed matches |
| `packages/db/src/types.ts` | Modify | Add `UpcomingMatch` type |
| `packages/db/src/index.ts` | Modify | Export new query |
| `packages/web/src/app/api/tournaments/[id]/route.ts` | Modify | Include matches in response |
| `packages/web/src/app/tournaments/[id]/page.tsx` | Modify | Add upcoming matches section with date grouping |

---

### Task 1: Schema Migration — Add New Columns

**Files:**
- Modify: `packages/scraper/src/db.ts:14-104`

- [ ] **Step 1: Add ALTER TABLE statements for new match columns**

Add after existing index creation (line ~103) in the `migrate()` function:

```typescript
  // New columns for schedule scraping
  const matchCols = db.query("PRAGMA table_info(matches)").all() as Array<{ name: string }>;
  const colNames = new Set(matchCols.map((c) => c.name));

  if (!colNames.has("tournament_id")) {
    db.run("ALTER TABLE matches ADD COLUMN tournament_id INTEGER REFERENCES tournaments(id)");
  }
  if (!colNames.has("court")) {
    db.run("ALTER TABLE matches ADD COLUMN court TEXT");
  }
  if (!colNames.has("category")) {
    db.run("ALTER TABLE matches ADD COLUMN category TEXT");
  }
  if (!colNames.has("subcategory")) {
    db.run("ALTER TABLE matches ADD COLUMN subcategory TEXT");
  }

  db.run("CREATE INDEX IF NOT EXISTS idx_matches_tournament_id ON matches(tournament_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_matches_category ON matches(category)");
```

- [ ] **Step 2: Verify migration runs without errors**

Run: `cd packages/scraper && bun -e "const { getDb } = await import('./src/db'); const db = getDb(); const cols = db.query('PRAGMA table_info(matches)').all(); console.log(cols.map(c => c.name).join(', '));"`

Expected: column list includes `tournament_id`, `court`, `category`, `subcategory`

- [ ] **Step 3: Commit**

```bash
git add packages/scraper/src/db.ts
git commit -m "feat(db): add tournament_id, court, category, subcategory columns to matches"
```

---

### Task 2: Matches Page Scraper

**Files:**
- Create: `packages/scraper/src/scrape-matches-page.ts`

This extracts logic from the existing prototype `scrape-upcoming-matches.ts` into a focused module.

- [ ] **Step 1: Create the matches page scraper module**

```typescript
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
```

- [ ] **Step 2: Write test for parsePortugueseDate and parseCategory**

Create `packages/scraper/src/scrape-matches-page.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { parsePortugueseDate, parseCategory } from "./scrape-matches-page";

test("parsePortugueseDate parses tab text to ISO date", () => {
  expect(parsePortugueseDate("sáb, 21 mar", 2026)).toBe("2026-03-21");
  expect(parsePortugueseDate("qua, 18 mar", 2026)).toBe("2026-03-18");
  expect(parsePortugueseDate("dom, 1 jan", 2026)).toBe("2026-01-01");
});

test("parsePortugueseDate returns empty string for unparseable input", () => {
  expect(parsePortugueseDate("", 2026)).toBe("");
  expect(parsePortugueseDate("unknown", 2026)).toBe("");
});

test("parseCategory extracts category and subcategory", () => {
  expect(parseCategory("Masculinos 6 - M6-QP")).toEqual({ category: "M6", subcategory: "QP" });
  expect(parseCategory("Femininos 5 - F5-Quali")).toEqual({ category: "F5", subcategory: "Quali" });
  expect(parseCategory("Mistos 3 - MX3-QP")).toEqual({ category: "MX3", subcategory: "QP" });
});

test("parseCategory falls back for unexpected format", () => {
  expect(parseCategory("Unknown")).toEqual({ category: "Unknown", subcategory: "" });
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/scraper && bun test src/scrape-matches-page.test.ts`
Expected: 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/scraper/src/scrape-matches-page.ts packages/scraper/src/scrape-matches-page.test.ts
git commit -m "feat(scraper): extract matches page scraper with date/category parsing"
```

---

### Task 3: Draws Page Scraper

**Files:**
- Create: `packages/scraper/src/scrape-draws-page.ts`

- [ ] **Step 1: Create the draws page scraper module**

```typescript
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
```

- [ ] **Step 2: Write test for inferRoundLabels**

Create `packages/scraper/src/scrape-draws-page.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { inferRoundLabels } from "./scrape-draws-page";

test("inferRoundLabels maps 32-draw round numbers", () => {
  const labels = inferRoundLabels([6, 5, 4, 3, 2]);
  expect(labels.get(6)).toBe("R32");
  expect(labels.get(5)).toBe("R16");
  expect(labels.get(4)).toBe("QF");
  expect(labels.get(3)).toBe("SF");
  expect(labels.get(2)).toBe("F");
});

test("inferRoundLabels maps 8-draw round numbers", () => {
  const labels = inferRoundLabels([4, 3, 2]);
  expect(labels.get(4)).toBe("QF");
  expect(labels.get(3)).toBe("SF");
  expect(labels.get(2)).toBe("F");
  expect(labels.size).toBe(3);
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/scraper && bun test src/scrape-draws-page.test.ts`
Expected: 2 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/scraper/src/scrape-draws-page.ts packages/scraper/src/scrape-draws-page.test.ts
git commit -m "feat(scraper): add draws page scraper with round label inference"
```

---

### Task 4: Store Schedule — GUID, Dedup, Cross-Reference, DB Upsert

**Files:**
- Create: `packages/scraper/src/store-schedule.ts`

- [ ] **Step 1: Write tests for GUID generation and score parsing**

Create `packages/scraper/src/store-schedule.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { generateScheduleGuid, parseResultScores } from "./store-schedule";

test("generateScheduleGuid sorts all player IDs", () => {
  const guid = generateScheduleGuid(23261, [208692, 98573], [254197, 213445]);
  expect(guid).toBe("schedule:23261:98573-208692-213445-254197");
});

test("generateScheduleGuid is order-independent", () => {
  const a = generateScheduleGuid(1, [3, 1], [4, 2]);
  const b = generateScheduleGuid(1, [4, 2], [1, 3]);
  expect(a).toBe(b);
});

test("parseResultScores parses standard scores", () => {
  expect(parseResultScores("6-4  6-3")).toEqual([
    { set_a: 6, set_b: 4, tie_a: -1, tie_b: -1 },
    { set_a: 6, set_b: 3, tie_a: -1, tie_b: -1 },
  ]);
});

test("parseResultScores parses three-set match", () => {
  expect(parseResultScores("6-4  4-6  7-5")).toEqual([
    { set_a: 6, set_b: 4, tie_a: -1, tie_b: -1 },
    { set_a: 4, set_b: 6, tie_a: -1, tie_b: -1 },
    { set_a: 7, set_b: 5, tie_a: -1, tie_b: -1 },
  ]);
});

test("parseResultScores returns empty for no result", () => {
  expect(parseResultScores("")).toEqual([]);
  expect(parseResultScores("vs")).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/scraper && bun test src/store-schedule.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create store-schedule module**

```typescript
import { getDb } from "./db";
import type { ScrapedMatchRow } from "./scrape-matches-page";
import type { DrawEntry } from "./scrape-draws-page";

interface SetScore {
  set_a: number;
  set_b: number;
  tie_a: number;
  tie_b: number;
}

/**
 * Generate deterministic GUID for a scheduled match.
 * Format: schedule:{tournamentId}:{sortedAllPlayerIds}
 */
export function generateScheduleGuid(
  tournamentId: number,
  sideAIds: number[],
  sideBIds: number[]
): string {
  const allIds = [...sideAIds, ...sideBIds].sort((a, b) => a - b);
  return `schedule:${tournamentId}:${allIds.join("-")}`;
}

/**
 * Parse result string like "6-4  6-3" into set scores.
 */
export function parseResultScores(result: string): SetScore[] {
  if (!result || !result.includes("-")) return [];
  const sets = result.trim().split(/\s{2,}/);
  const parsed: SetScore[] = [];
  for (const s of sets) {
    const parts = s.split("-");
    if (parts.length !== 2) continue;
    const a = parseInt(parts[0]);
    const b = parseInt(parts[1]);
    if (isNaN(a) || isNaN(b)) continue;
    parsed.push({ set_a: a, set_b: b, tie_a: -1, tie_b: -1 });
  }
  return parsed;
}

/**
 * Determine winner side from set scores.
 * Winner is the side that won more sets.
 */
function determineWinner(sets: SetScore[]): "a" | "b" | null {
  if (sets.length === 0) return null;
  let aWins = 0;
  let bWins = 0;
  for (const s of sets) {
    if (s.set_a > s.set_b) aWins++;
    else if (s.set_b > s.set_a) bWins++;
  }
  if (aWins > bWins) return "a";
  if (bWins > aWins) return "b";
  return null;
}

interface CrossRefResult {
  licenseUpdates: Array<{ playerId: number; license: string }>;
  roundNames: Map<string, string>; // matchGuid → roundName
}

/**
 * Cross-reference Matches page data with Draws page data.
 * Match by player name to enrich with license numbers and round names.
 */
export function crossReference(
  matches: ScrapedMatchRow[],
  draws: DrawEntry[]
): CrossRefResult {
  const licenseUpdates: Array<{ playerId: number; license: string }> = [];
  const roundNames = new Map<string, string>();

  // Build name→player mapping from matches (which have IDs)
  const nameToId = new Map<string, number>();
  for (const m of matches) {
    for (const p of [...m.sideA, ...m.sideB]) {
      if (p.id && p.name) {
        nameToId.set(p.name.toLowerCase(), p.id);
      }
    }
  }

  // Enrich license numbers from draws
  for (const d of draws) {
    if (d.licenseNumber) {
      const id = nameToId.get(d.player1Name.toLowerCase());
      if (id) {
        licenseUpdates.push({ playerId: id, license: d.licenseNumber });
      }
    }
  }

  // TODO: Populate roundNames by matching draw bracket positions to matches.
  // Requires Draws page scraper to provide per-match round context.
  // For now, round_name will remain null for schedule-sourced matches.

  return { licenseUpdates, roundNames };
}

/**
 * Store scraped matches into the database.
 * Handles dedup, new player insertion, and result updates.
 */
export function storeSchedule(
  tournamentId: number,
  tournamentName: string,
  matches: ScrapedMatchRow[],
  crossRef: CrossRefResult
) {
  const db = getDb();

  const insertMatch = db.prepare(`
    INSERT INTO matches (guid, tournament_name, section_name, round_name, date_time,
      is_singles, side_a_ids, side_b_ids, side_a_names, side_b_names,
      sets_json, winner_side, source, tournament_id, court, category, subcategory)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateMatchResult = db.prepare(`
    UPDATE matches SET sets_json = ?, winner_side = ?, date_time = ? WHERE guid = ?
  `);

  const insertMatchPlayer = db.prepare(`
    INSERT OR IGNORE INTO match_players (match_guid, player_id, side) VALUES (?, ?, ?)
  `);

  const insertNewPlayer = db.prepare(`
    INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)
  `);

  const updateLicense = db.prepare(`
    UPDATE players SET license_number = ? WHERE id = ? AND (license_number IS NULL OR license_number = '')
  `);

  const existingMatch = db.prepare(`SELECT guid, winner_side FROM matches WHERE guid = ?`);

  const findByPlayersAndTournament = db.prepare(`
    SELECT guid FROM matches
    WHERE tournament_name = ?
    AND ((side_a_ids = ? AND side_b_ids = ?) OR (side_a_ids = ? AND side_b_ids = ?))
    AND source LIKE 'scrape:tournament:%'
  `);

  const enrichExisting = db.prepare(`
    UPDATE matches SET tournament_id = ?, court = ?, category = ?, subcategory = ?
    WHERE guid = ?
  `);

  const source = `schedule:tournament:${tournamentId}`;

  let inserted = 0;
  let updated = 0;
  let enriched = 0;
  let skipped = 0;
  let newPlayers = 0;

  const tx = db.transaction(() => {
    // Update license numbers from draws cross-reference
    for (const { playerId, license } of crossRef.licenseUpdates) {
      updateLicense.run(license, playerId);
    }

    for (const m of matches) {
      const sideAIds = m.sideA.map((p) => p.id).filter((id): id is number => id !== null);
      const sideBIds = m.sideB.map((p) => p.id).filter((id): id is number => id !== null);

      if (sideAIds.length === 0 || sideBIds.length === 0) {
        skipped++;
        continue;
      }

      // Insert new players
      for (const p of [...m.sideA, ...m.sideB]) {
        if (p.id) {
          const result = insertNewPlayer.run(p.id, p.name);
          if (result.changes > 0) newPlayers++;
        }
      }

      const sideAIdsJson = JSON.stringify(sideAIds);
      const sideBIdsJson = JSON.stringify(sideBIds);
      const sideANames = m.sideA.map((p) => p.name).join(" / ");
      const sideBNames = m.sideB.map((p) => p.name).join(" / ");
      const isSingles = m.sideA.length === 1 && m.sideB.length === 1 ? 1 : 0;

      const guid = generateScheduleGuid(tournamentId, sideAIds, sideBIds);
      const sets = parseResultScores(m.result);
      const winnerSide = determineWinner(sets);
      const dateTime = m.date && m.time ? `${m.date} ${m.time}` : m.date || null;
      const roundName = crossRef.roundNames.get(guid) || null;

      // Dedup check 1: Same GUID exists?
      const existing = existingMatch.get(guid) as { guid: string; winner_side: string | null } | null;
      if (existing) {
        if (!existing.winner_side && winnerSide) {
          // Upcoming → now has result: update
          updateMatchResult.run(JSON.stringify(sets), winnerSide, dateTime, guid);
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      // Dedup check 2: Same players + tournament from news feed? (check both side orderings)
      const feedMatch = findByPlayersAndTournament.get(
        tournamentName, sideAIdsJson, sideBIdsJson, sideBIdsJson, sideAIdsJson
      ) as { guid: string } | null;
      if (feedMatch) {
        enrichExisting.run(tournamentId, m.court, m.category, m.subcategory, feedMatch.guid);
        enriched++;
        continue;
      }

      // Insert new match
      insertMatch.run(
        guid, tournamentName, m.categoryFull, roundName, dateTime,
        isSingles, sideAIdsJson, sideBIdsJson, sideANames, sideBNames,
        sets.length > 0 ? JSON.stringify(sets) : null, winnerSide, source,
        tournamentId, m.court, m.category, m.subcategory
      );

      for (const id of sideAIds) insertMatchPlayer.run(guid, id, "a");
      for (const id of sideBIds) insertMatchPlayer.run(guid, id, "b");

      inserted++;
    }
  });

  tx();

  console.log(`Store complete: ${inserted} inserted, ${updated} updated, ${enriched} enriched, ${skipped} skipped, ${newPlayers} new players`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/scraper && bun test src/store-schedule.test.ts`
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/store-schedule.ts packages/scraper/src/store-schedule.test.ts
git commit -m "feat(scraper): add schedule storage with GUID generation, dedup, and cross-reference"
```

---

### Task 5: Orchestrator — Rewrite scrape-upcoming-matches.ts

**Files:**
- Rewrite: `packages/scraper/src/scrape-upcoming-matches.ts`

- [ ] **Step 1: Rewrite the orchestrator**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/scraper/src/scrape-upcoming-matches.ts
git commit -m "feat(scraper): rewrite orchestrator to use modular scrapers + DB storage"
```

---

### Task 6: CLI Integration — Add `schedule` Command

**Files:**
- Modify: `packages/scraper/src/cli.ts:8-106`

- [ ] **Step 1: Add schedule command to CLI switch**

Add before the `default:` case:

```typescript
  case "schedule": {
    const { scrapeSchedule, resolveScheduleInput } = await import("./scrape-upcoming-matches");
    const input = process.argv[3];
    if (!input) {
      console.log("Usage: bun src/cli.ts schedule <tournament-id|url>");
      break;
    }
    const { tournamentId, url } = resolveScheduleInput(input);
    await scrapeSchedule(tournamentId, url);
    break;
  }
```

- [ ] **Step 2: Update help text**

Add to the help string: `  schedule <id|url> Scrape match schedule for a tournament`

- [ ] **Step 3: Commit**

```bash
git add packages/scraper/src/cli.ts
git commit -m "feat(scraper): add schedule command to CLI"
```

---

### Task 7: DB Query — Tournament Matches for Web

**Files:**
- Modify: `packages/db/src/queries/matches.ts:4-8` — fix `parseTournamentIdFromSource` for new source prefix
- Modify: `packages/db/src/types.ts`
- Modify: `packages/db/src/queries/tournaments.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Fix parseTournamentIdFromSource in matches.ts**

In `packages/db/src/queries/matches.ts`, update `parseTournamentIdFromSource` to handle both source prefixes:

```typescript
function parseTournamentIdFromSource(source: string | null): number | null {
  if (!source) return null;
  const match = source.match(/(?:scrape|schedule):tournament:(\d+)/);
  return match ? parseInt(match[1]) : null;
}
```

- [ ] **Step 2: Add TournamentMatch type**

Add to `packages/db/src/types.ts`:

```typescript
export interface TournamentMatch {
  guid: string
  category: string | null
  subcategory: string | null
  roundName: string | null
  dateTime: string | null
  court: string | null
  sets: Array<{ setA: number; setB: number; tieA: number; tieB: number }>
  winnerSide: string | null
  sideA: Array<{ id: number; name: string }>
  sideB: Array<{ id: number; name: string }>
}
```

- [ ] **Step 3: Add getTournamentMatches query**

Add to `packages/db/src/queries/tournaments.ts`:

```typescript
import type { Tournament, TournamentDetail, TournamentPlayer, TournamentMatch } from "../types";

export function getTournamentMatches(
  tournamentId: number,
  category?: string
): { upcoming: TournamentMatch[]; completed: TournamentMatch[] } {
  const db = getDb();

  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  if (!tournament) return { upcoming: [], completed: [] };

  let query = `
    SELECT m.guid, m.section_name, m.round_name, m.date_time, m.court,
           m.category, m.subcategory, m.sets_json, m.winner_side,
           m.side_a_ids, m.side_b_ids, m.side_a_names, m.side_b_names
    FROM matches m
    WHERE (m.source = ? OR m.source = ? OR m.tournament_name = ?)
  `;
  const params: any[] = [
    `scrape:tournament:${tournamentId}`,
    `schedule:tournament:${tournamentId}`,
    tournament.name,
  ];

  if (category) {
    query += " AND (m.category = ? OR m.section_name = ?)";
    params.push(category, category);
  }

  query += " ORDER BY m.date_time ASC";

  const rows = db.query(query).all(...params) as Array<{
    guid: string; section_name: string | null; round_name: string | null;
    date_time: string | null; court: string | null; category: string | null;
    subcategory: string | null; sets_json: string | null; winner_side: string | null;
    side_a_ids: string; side_b_ids: string; side_a_names: string | null; side_b_names: string | null;
  }>;

  // Batch-fetch player names
  const allPlayerIds = new Set<number>();
  for (const row of rows) {
    for (const id of JSON.parse(row.side_a_ids)) allPlayerIds.add(id);
    for (const id of JSON.parse(row.side_b_ids)) allPlayerIds.add(id);
  }
  const idList = [...allPlayerIds];
  const nameMap = new Map<number, string>();
  if (idList.length > 0) {
    const placeholders = idList.map(() => "?").join(",");
    const nameRows = db.query(
      `SELECT id, name FROM players WHERE id IN (${placeholders})`
    ).all(...idList) as Array<{ id: number; name: string }>;
    for (const r of nameRows) nameMap.set(r.id, r.name);
  }

  function toMatch(row: typeof rows[0]): TournamentMatch {
    const sideAIds: number[] = JSON.parse(row.side_a_ids);
    const sideBIds: number[] = JSON.parse(row.side_b_ids);
    const sideANames = (row.side_a_names ?? "").split(" / ");
    const sideBNames = (row.side_b_names ?? "").split(" / ");

    let sets: TournamentMatch["sets"] = [];
    if (row.sets_json) {
      try {
        sets = JSON.parse(row.sets_json).map((s: any) => ({
          setA: s.set_a ?? 0, setB: s.set_b ?? 0,
          tieA: s.tie_a ?? -1, tieB: s.tie_b ?? -1,
        }));
      } catch {}
    }

    return {
      guid: row.guid,
      category: row.category,
      subcategory: row.subcategory,
      roundName: row.round_name,
      dateTime: row.date_time,
      court: row.court,
      sets,
      winnerSide: row.winner_side,
      sideA: sideAIds.map((id, i) => ({ id, name: nameMap.get(id) ?? sideANames[i] ?? "" })),
      sideB: sideBIds.map((id, i) => ({ id, name: nameMap.get(id) ?? sideBNames[i] ?? "" })),
    };
  }

  const upcoming: TournamentMatch[] = [];
  const completed: TournamentMatch[] = [];

  for (const row of rows) {
    const match = toMatch(row);
    if (row.winner_side) {
      completed.push(match);
    } else {
      upcoming.push(match);
    }
  }

  return { upcoming, completed };
}
```

- [ ] **Step 4: Export new function**

Add to `packages/db/src/index.ts`:

```typescript
export { getTournaments, getTournament, getTournamentCategories, getTournamentPlayers, getTournamentMatches } from "./queries/tournaments";
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/matches.ts packages/db/src/types.ts packages/db/src/queries/tournaments.ts packages/db/src/index.ts
git commit -m "feat(db): add getTournamentMatches query, fix source prefix parsing"
```

---

### Task 8: API Route — Include Matches in Tournament Response

**Files:**
- Modify: `packages/web/src/app/api/tournaments/[id]/route.ts`

**Important:** Read `node_modules/next/dist/docs/` before writing Next.js code per AGENTS.md.

- [ ] **Step 1: Update API route to include matches**

```typescript
import { getTournament, getTournamentCategories, getTournamentPlayers, getTournamentMatches } from "@fpp/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const category = request.nextUrl.searchParams.get("category") ?? undefined;

  const tournament = getTournament(parseInt(id));
  if (!tournament) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const categories = getTournamentCategories(tournament.id);
  const players = getTournamentPlayers(tournament.id, category);
  const matches = getTournamentMatches(tournament.id, category);

  return NextResponse.json({ tournament, categories, players, matches });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/api/tournaments/[id]/route.ts
git commit -m "feat(api): include upcoming + completed matches in tournament endpoint"
```

---

### Task 9: Web UI — Display Upcoming Matches on Tournament Page

**Files:**
- Modify: `packages/web/src/app/tournaments/[id]/page.tsx`

**Important:** Read `node_modules/next/dist/docs/` before writing Next.js code per AGENTS.md.

- [ ] **Step 1: Add match types and match card component inline**

Update the tournament page to add match display. Add these types after the existing `TournamentPlayer` interface:

```typescript
interface TournamentMatchData {
  guid: string;
  category: string | null;
  subcategory: string | null;
  roundName: string | null;
  dateTime: string | null;
  court: string | null;
  sets: Array<{ setA: number; setB: number }>;
  winnerSide: string | null;
  sideA: Array<{ id: number; name: string }>;
  sideB: Array<{ id: number; name: string }>;
}

interface MatchesData {
  upcoming: TournamentMatchData[];
  completed: TournamentMatchData[];
}
```

- [ ] **Step 2: Add state and tab switching**

Add to the component state:

```typescript
const [matches, setMatches] = useState<MatchesData>({ upcoming: [], completed: [] });
const [activeTab, setActiveTab] = useState<"players" | "upcoming" | "completed">("players");
```

Update the fetch `.then` to also set matches:

```typescript
setMatches(data.matches ?? { upcoming: [], completed: [] });
```

- [ ] **Step 3: Add tab navigation UI**

Add after the category filter section:

```tsx
{/* Tab navigation */}
<div className="flex gap-1 rounded-lg bg-muted p-1">
  {[
    { key: "players" as const, label: "Players", count: players.length },
    { key: "upcoming" as const, label: "Upcoming", count: matches.upcoming.length },
    { key: "completed" as const, label: "Results", count: matches.completed.length },
  ].filter((t) => t.count > 0 || t.key === "players").map((tab) => (
    <button
      key={tab.key}
      onClick={() => setActiveTab(tab.key)}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        activeTab === tab.key
          ? "bg-background shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {tab.label} {tab.count > 0 && <span className="ml-1 text-xs opacity-60">({tab.count})</span>}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Add match card renderer**

Add a helper function inside the component:

```tsx
function renderMatchCard(match: TournamentMatchData) {
  const isUpcoming = !match.winnerSide;
  return (
    <div key={match.guid} className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex gap-2">
          {match.category && <span>{match.category}{match.subcategory ? `-${match.subcategory}` : ""}</span>}
          {match.roundName && <span>{match.roundName}</span>}
        </div>
        <div className="flex gap-2">
          {match.court && <span>{match.court}</span>}
          {match.dateTime && (
            <span>
              {new Date(match.dateTime).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}
              {" "}
              {match.dateTime.includes(" ") ? match.dateTime.split(" ")[1]?.substring(0, 5) : ""}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1">
        {/* Side A */}
        <div className={`flex items-center justify-between ${match.winnerSide === "a" ? "font-semibold" : ""}`}>
          <div className="flex gap-1">
            {match.sideA.map((p) => (
              <Link key={p.id} href={`/players/${p.id}`} className="hover:underline">{p.name}</Link>
            ))}
          </div>
          {!isUpcoming && (
            <div className="flex gap-2 text-sm tabular-nums">
              {match.sets.map((s, i) => <span key={i}>{s.setA}</span>)}
            </div>
          )}
        </div>

        {/* Side B */}
        <div className={`flex items-center justify-between ${match.winnerSide === "b" ? "font-semibold" : ""}`}>
          <div className="flex gap-1">
            {match.sideB.map((p) => (
              <Link key={p.id} href={`/players/${p.id}`} className="hover:underline">{p.name}</Link>
            ))}
          </div>
          {!isUpcoming && (
            <div className="flex gap-2 text-sm tabular-nums">
              {match.sets.map((s, i) => <span key={i}>{s.setB}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace player list with tab-switched content**

Replace the existing `<div className="space-y-1">` player list block with:

```tsx
<div className="space-y-2">
  {activeTab === "players" && (
    <>
      {players.length > 0 ? (
        players.map((player, idx) => (
          <Link key={player.id} href={`/players/${player.id}`} className="block">
            <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
              <div className="flex items-center gap-3 min-w-0">
                <span className="shrink-0 w-8 text-right text-sm text-muted-foreground">{idx + 1}.</span>
                <span className="truncate font-medium">{player.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <RankBadge rank={player.genderRank} label="gender" />
                <RankBadge rank={player.categoryRank} label="cat" />
              </div>
            </div>
          </Link>
        ))
      ) : (
        <p className="py-8 text-center text-muted-foreground">No players found</p>
      )}
    </>
  )}

  {activeTab === "upcoming" && (
    <>
      {matches.upcoming.length > 0 ? (
        matches.upcoming.map(renderMatchCard)
      ) : (
        <p className="py-8 text-center text-muted-foreground">No upcoming matches</p>
      )}
    </>
  )}

  {activeTab === "completed" && (
    <>
      {matches.completed.length > 0 ? (
        matches.completed.map(renderMatchCard)
      ) : (
        <p className="py-8 text-center text-muted-foreground">No completed matches</p>
      )}
    </>
  )}
</div>
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/tournaments/[id]/page.tsx
git commit -m "feat(web): add upcoming matches and results tabs to tournament page"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Verify scraper tests pass**

Run: `cd packages/scraper && bun test`
Expected: All tests pass

- [ ] **Step 2: Verify schema migration**

Run: `cd packages/scraper && bun -e "const { getDb } = require('./src/db'); const db = getDb(); console.log('OK'); const cols = db.query('PRAGMA table_info(matches)').all(); console.log(cols.map(c => c.name).join(', '));"`
Expected: New columns present

- [ ] **Step 3: Verify web app builds**

Run: `cd packages/web && bun run build`
Expected: Build succeeds

- [ ] **Step 4: Test with a real tournament (manual)**

Run: `cd packages/scraper && bun src/cli.ts schedule <tournament-id>`
Expected: Matches scraped and stored, stats printed

- [ ] **Step 5: Final commit if any fixes needed**
