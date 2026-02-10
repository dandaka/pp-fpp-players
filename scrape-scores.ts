import { chromium, type Page } from "playwright";

const RANKINGS_URL =
  "https://tour.tiesports.com/fpp/weekly_rankings?rank=absolutos";

interface Player {
  id: number;
  name: string;
  club: string;
  section: string;
  location: string;
  age: string;
}

interface RankingEntry {
  ranking: number;
  name: string;
  pontos: number;
  nivel: string;
  escalao: string;
}

interface PlayerWithScore extends Player {
  averagePontos: number | null;
  entries: RankingEntry[];
}

async function searchPlayer(
  page: Page,
  playerName: string,
  gender: string
): Promise<RankingEntry[]> {
  // Clear and fill the search field
  await page.fill("#txt_filter_rankings_player_name", "");
  await page.fill("#txt_filter_rankings_player_name", playerName);

  // Set gender dropdown
  await page.selectOption("#drop_filter_rankings_gender", gender);

  // Set age group to Absolutos
  await page.selectOption("#drop_filter_rankings_age_group", "6");

  // Click search and wait for network response
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("weekly_rankings") && r.request().method() === "POST",
      { timeout: 10000 }
    ),
    page.click("#btn_filter_rankings"),
  ]);

  // Small extra wait for DOM update
  await page.waitForTimeout(500);

  // Parse the results table (Table 0 is the ranking results)
  const entries = await page.evaluate(() => {
    const results: {
      ranking: number;
      name: string;
      pontos: number;
      nivel: string;
      escalao: string;
    }[] = [];

    const tables = document.querySelectorAll("table");
    if (tables.length === 0) return results;

    // The first table contains the ranking results
    const rows = tables[0].querySelectorAll("tr");

    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 7) continue;

      const rankText = cells[0]?.textContent?.trim() || "";
      const rank = parseInt(rankText);
      if (isNaN(rank)) continue;

      // Columns: Ranking(0), Variação(1), Licença(2), Jogador(3), Pontos(4), Clube(5), Nível(6), Escalão(7), Torneios(8)
      const name = cells[3]?.textContent?.trim() || "";
      const pontosText = cells[4]?.textContent?.trim() || "";
      const nivel = cells[6]?.textContent?.trim() || "";
      const escalao = cells[7]?.textContent?.trim() || "";

      const pontos = parseFloat(
        pontosText.replace(/\./g, "").replace(",", ".")
      );

      if (name && !isNaN(pontos)) {
        results.push({ ranking: rank, name, pontos, nivel, escalao });
      }
    }
    return results;
  });

  return entries;
}

async function main() {
  // Load players
  const playersFile = Bun.file("players.json");
  const players: Player[] = await playersFile.json();
  console.log(`Loaded ${players.length} players`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Loading rankings page...");
  await page.goto(RANKINGS_URL, { waitUntil: "networkidle" });

  // Click "Ver mais" for Masculinos to load the search form
  console.log("Expanding full ranking view...");
  await page.click("#repeater_rankings_top_10_link_load_more_men_0");
  await page.waitForTimeout(2000);

  // Verify search form is available
  const hasSearchForm = await page
    .locator("#txt_filter_rankings_player_name")
    .count();
  if (!hasSearchForm) {
    console.error("Search form not found after expanding. Aborting.");
    await browser.close();
    return;
  }
  console.log("Search form ready.\n");

  const results: PlayerWithScore[] = [];
  let searched = 0;

  for (const player of players) {
    searched++;
    const isFemale = player.section.includes("Feminino");
    const gender = isFemale ? "2" : "1";
    const searchName = player.name;

    process.stdout.write(
      `[${searched}/${players.length}] "${searchName}" (${gender === "1" ? "M" : "F"})... `
    );

    try {
      const entries = await searchPlayer(page, searchName, gender);

      // Filter for Nível 5 and Nível 6 only
      const filtered = entries.filter(
        (e) => e.nivel === "Nível 5" || e.nivel === "Nível 6"
      );

      if (filtered.length > 0) {
        const avgPontos =
          filtered.reduce((sum, e) => sum + e.pontos, 0) / filtered.length;
        results.push({
          ...player,
          averagePontos: Math.round(avgPontos * 100) / 100,
          entries: filtered,
        });
        console.log(
          `${filtered.length} hit(s), avg ${avgPontos.toFixed(2)} pts`
        );
      } else if (entries.length > 0) {
        const levels = [...new Set(entries.map((e) => e.nivel))].join(", ");
        results.push({ ...player, averagePontos: null, entries: [] });
        console.log(`${entries.length} found but levels: ${levels} (skip)`);
      } else {
        results.push({ ...player, averagePontos: null, entries: [] });
        console.log("no results");
      }
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`);
      results.push({ ...player, averagePontos: null, entries: [] });
    }
  }

  await browser.close();

  // Save detailed results
  await Bun.write(
    "players-with-scores.json",
    JSON.stringify(results, null, 2)
  );
  console.log("\nSaved to players-with-scores.json");

  // Summary
  const withScores = results.filter((r) => r.averagePontos !== null);
  console.log(
    `${withScores.length}/${results.length} players have Nível 5/6 scores`
  );

  // Update players.json with scores
  const updatedPlayers = players.map((p) => {
    const match = results.find((r) => r.id === p.id);
    return { ...p, pontos: match?.averagePontos ?? null };
  });
  await Bun.write("players.json", JSON.stringify(updatedPlayers, null, 2));
  console.log("Updated players.json with pontos field");

  // CSV
  const csvHeader = "id,name,club,section,location,age,pontos";
  const csvRows = updatedPlayers.map(
    (p) =>
      `${p.id},"${p.name.replace(/"/g, '""')}","${p.club.replace(/"/g, '""')}","${p.section.replace(/"/g, '""')}","${p.location.replace(/"/g, '""')}","${p.age.replace(/"/g, '""')}",${p.pontos ?? ""}`
  );
  await Bun.write("players.csv", [csvHeader, ...csvRows].join("\n"));
  console.log("Updated players.csv with pontos column");
}

main().catch(console.error);
