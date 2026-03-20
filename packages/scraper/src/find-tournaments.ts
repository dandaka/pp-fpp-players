// Scan all FPP padel tournament IDs and store directly to DB
// Uses concurrent batches for speed, cursor tracking for resumability

import { getDb, getCursor, setCursor } from "./db";

const API_URL = "https://fpp.tiepadel.com/methods.aspx/get_news_by_codtou_header";
const CONCURRENCY = 20;
const DELAY_BETWEEN_BATCHES_MS = 200;
const MAX_ID = 25000;

interface NewsItem {
  NAMTOU: string;
  LOCATION_NAME: string;
  DATEOFNEW_format: string;
  UIDTOU: string;
}

async function checkTournament(id: number): Promise<{ id: number; name: string; location: string; date: string } | null> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ codtou_header: id, count_items: 0 }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { d: NewsItem[] };
    const d = json.d;
    if (d && Array.isArray(d) && d.length > 0) {
      const name = d[0]?.NAMTOU || "Unknown";
      const location = d[0]?.LOCATION_NAME || "";
      const date = d[0]?.DATEOFNEW_format || "";
      return { id, name, location, date };
    }
    return null;
  } catch {
    return null;
  }
}

async function processBatch(ids: number[]): Promise<{ id: number; name: string; location: string; date: string }[]> {
  const results = await Promise.all(ids.map(checkTournament));
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export async function scanTournaments(startId = 1, endId = MAX_ID) {
  const db = getDb();
  const insertTournament = db.prepare(
    "INSERT OR IGNORE INTO tournaments (id, name, club, date) VALUES (?, ?, ?, ?)"
  );

  // Resume from last scanned position
  const cursorKey = "scan_tournaments_last_id";
  const lastScanned = parseInt(getCursor(cursorKey) ?? "0");
  const effectiveStart = Math.max(startId, lastScanned + 1);

  if (effectiveStart > endId) {
    console.log(`Already scanned up to ${lastScanned}. Use --force to rescan.`);
    return;
  }

  const totalIds = endId - effectiveStart + 1;
  console.log(`Scanning tournament IDs ${effectiveStart}–${endId} (${totalIds} IDs, concurrency: ${CONCURRENCY})`);

  let found = 0;
  let checked = 0;

  for (let batchStart = effectiveStart; batchStart <= endId; batchStart += CONCURRENCY) {
    const batchEnd = Math.min(batchStart + CONCURRENCY - 1, endId);
    const ids = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

    const results = await processBatch(ids);

    if (results.length > 0) {
      const tx = db.transaction(() => {
        for (const t of results) {
          insertTournament.run(t.id, t.name, t.location, t.date);
        }
      });
      tx();

      for (const t of results) {
        console.log(`  [${t.id}] ${t.name}`);
      }
      found += results.length;
    }

    checked += ids.length;
    setCursor(cursorKey, String(batchEnd));

    // Progress every 500 IDs
    if (checked % 500 < CONCURRENCY) {
      const pct = ((checked / totalIds) * 100).toFixed(1);
      console.log(`  ... ${pct}% (${checked}/${totalIds} checked, ${found} found)`);
    }

    await Bun.sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  const totalInDb = (db.query("SELECT COUNT(*) as c FROM tournaments").get() as { c: number }).c;
  console.log(`\n=== Scan complete ===`);
  console.log(`Found ${found} new tournaments in this run`);
  console.log(`Total tournaments in DB: ${totalInDb}`);
}

// CLI entry point
if (import.meta.main) {
  const force = process.argv.includes("--force");
  if (force) {
    const db = getDb();
    db.run("DELETE FROM sync_cursors WHERE key = 'scan_tournaments_last_id'");
    console.log("Force mode: resetting scan cursor");
  }

  const startArg = process.argv.find((a) => a.match(/^\d+$/));
  const endArg = process.argv.find((a, i) => i > 2 && a.match(/^\d+$/) && process.argv[i - 1]?.match(/^\d+$/));

  const start = startArg ? parseInt(startArg) : 1;
  const end = endArg ? parseInt(endArg) : MAX_ID;

  await scanTournaments(start, end);
}
