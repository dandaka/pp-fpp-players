import { chromium, type Page } from "playwright";

const BASE_URL = "https://fpp.tiepadel.com/Tournaments/VOpenSmartpath/Players";

interface Player {
  id: number;
  name: string;
  club: string;
  section: string;
  location: string;
  age: string;
}

function parsePlayersFromPage(page: Page): Promise<Player[]> {
  return page.evaluate(() => {
    const players: {
      id: number;
      name: string;
      club: string;
      section: string;
      location: string;
      age: string;
    }[] = [];

    document.querySelectorAll(".rgRow, .rgAltRow").forEach((row) => {
      const cells = row.querySelectorAll("td");
      const link = row.querySelector('a[href*="Dashboard.aspx?id="]');
      const href = link?.getAttribute("href") || "";
      const idMatch = href.match(/id=(\d+)/);
      const id = idMatch ? parseInt(idMatch[1]) : 0;
      const name = link?.textContent?.trim() || "";
      const club = cells[2]?.textContent?.trim() || "";
      const section = cells[3]?.textContent?.trim() || "";
      const location = cells[6]?.textContent?.trim() || "";
      const age = cells[7]?.textContent?.trim() || "";
      if (name) players.push({ id, name, club, section, location, age });
    });

    return players;
  });
}

async function main() {
  console.log("Scraping ALL players from FPP via Playwright...");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const seenIds = new Set<number>();
  const allPlayers: Player[] = [];

  // Get total page count from grid config
  const pageCount = await page.evaluate(() => {
    const text = document.body.innerHTML;
    const match = text.match(/"PageCount":(\d+)/);
    return match ? parseInt(match[1]) : 36;
  });
  console.log(`Total pages: ${pageCount}`);

  // Parse page 1
  let players = await parsePlayersFromPage(page);
  for (const p of players) {
    if (!seenIds.has(p.id)) { seenIds.add(p.id); allPlayers.push(p); }
  }
  console.log(`Page 1: ${players.length} players (total: ${allPlayers.length})`);

  // Navigate through remaining pages using "Next Page" button
  for (let pg = 2; pg <= pageCount; pg++) {
    // Click Next Page and wait for response
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("Players") && r.request().method() === "POST",
        { timeout: 15000 }
      ),
      page.click('input.rgPageNext'),
    ]);
    await page.waitForTimeout(300);

    players = await parsePlayersFromPage(page);
    const newCount = players.filter((p) => !seenIds.has(p.id)).length;

    if (newCount === 0) {
      console.log(`Page ${pg}: all duplicates, stopping.`);
      break;
    }

    for (const p of players) {
      if (!seenIds.has(p.id)) { seenIds.add(p.id); allPlayers.push(p); }
    }
    console.log(`Page ${pg}: ${players.length} players, ${newCount} new (total: ${allPlayers.length})`);
  }

  await browser.close();

  console.log(`\nTotal: ${allPlayers.length} players scraped`);

  await Bun.write("players.json", JSON.stringify(allPlayers, null, 2));
  console.log("Saved to players.json");

  const csvHeader = "id,name,club,section,location,age";
  const csvRows = allPlayers.map(
    (p) =>
      `${p.id},"${p.name.replace(/"/g, '""')}","${p.club.replace(/"/g, '""')}","${p.section.replace(/"/g, '""')}","${p.location.replace(/"/g, '""')}","${p.age.replace(/"/g, '""')}"`
  );
  await Bun.write("players.csv", [csvHeader, ...csvRows].join("\n"));
  console.log("Saved to players.csv");
}

main().catch(console.error);
