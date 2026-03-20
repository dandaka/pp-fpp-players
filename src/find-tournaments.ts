// Find all FPP padel tournament IDs from 2025 on tiepadel.com
// Brute-forces tournament IDs by querying the news endpoint

const API_URL = "https://fpp.tiepadel.com/methods.aspx/get_news_by_codtou_header";
const DELAY_MS = 100;
const OUTPUT_FILE = "./data/found-tournaments.json";

interface TournamentInfo {
  id: number;
  name: string;
  raw: any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function checkTournament(id: number): Promise<TournamentInfo | null> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ codtou_header: id, count_items: 0 }),
    });

    if (!res.ok) return null;

    const json = await res.json();
    const d = json.d;

    if (d && Array.isArray(d) && d.length > 0) {
      const name = d[0]?.NAMTOU || d[0]?.namtou || "Unknown";
      return { id, name, raw: d[0] };
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const found: TournamentInfo[] = [];

  // Phase 1: Coarse scan (step 50) to find active ranges
  console.log("=== Phase 1: Coarse scan (step 50) from 18000 to 23000 ===");
  const activeRanges: number[] = [];

  for (let id = 18000; id <= 23000; id += 50) {
    const result = await checkTournament(id);
    if (result) {
      console.log(`  [${id}] ${result.name}`);
      found.push(result);
      activeRanges.push(id);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nPhase 1 found ${activeRanges.length} hits. Determining ranges to fill...`);

  // Phase 2: Fill in around active ranges and between known IDs
  // Determine min/max from hits
  const allHitIds = [...activeRanges, 21052, 21087, 22959];
  const minId = Math.min(...allHitIds) - 100;
  const maxId = Math.max(...allHitIds) + 100;

  console.log(`\n=== Phase 2: Dense scan from ${minId} to ${maxId} ===`);
  const checked = new Set(found.map((f) => f.id));

  for (let id = minId; id <= maxId; id++) {
    if (checked.has(id)) continue;
    checked.add(id);

    const result = await checkTournament(id);
    if (result) {
      console.log(`  [${id}] ${result.name}`);
      found.push(result);
    }
    await sleep(DELAY_MS);
  }

  // Sort by ID
  found.sort((a, b) => a.id - b.id);

  // Save results
  await Bun.write(OUTPUT_FILE, JSON.stringify(found, null, 2));

  console.log(`\n=== Results ===`);
  console.log(`Found ${found.length} tournaments. Saved to ${OUTPUT_FILE}`);
  console.log("\nAll tournaments:");
  for (const t of found) {
    console.log(`  ${t.id}: ${t.name}`);
  }
}

main().catch(console.error);
