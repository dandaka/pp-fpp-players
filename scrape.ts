import * as cheerio from "cheerio";

const BASE_URL = "https://fpp.tiepadel.com/Tournaments/VOpenSmartpath/Players";
const TARGET_PLAYERS = 100;
const PER_PAGE = 15;
const PAGES_NEEDED = Math.ceil(TARGET_PLAYERS / PER_PAGE); // 7 pages

interface Player {
  id: number;
  name: string;
  club: string;
  section: string;
  location: string;
  age: string;
}

function parsePlayers($: cheerio.CheerioAPI): Player[] {
  const players: Player[] = [];

  // Find all player rows in the RadGrid
  $(".rgRow, .rgAltRow").each((_i, row) => {
    const $row = $(row);
    const cells = $row.find("td");

    // Extract player ID from the dashboard link
    const link = $row.find('a[href*="Dashboard.aspx?id="]').attr("href");
    const idMatch = link?.match(/id=(\d+)/);
    const id = idMatch ? parseInt(idMatch[1]) : 0;

    // Extract player name from the link text
    const name = $row.find('a[href*="Dashboard.aspx?id="]').text().trim();

    // Cell indices: 0=entry_info(empty), 1=name, 2=club, 3=section, 4=entry_date(empty), 5=entry_status(empty), 6=location, 7=age
    const club = cells.eq(2).text().trim();
    const section = cells.eq(3).text().trim();
    const location = cells.eq(6).text().trim();
    const age = cells.eq(7).text().trim();

    if (name) {
      players.push({ id, name, club, section, location, age });
    }
  });

  return players;
}

function extractFormFields($: cheerio.CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $("input[type=hidden]").each((_i, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") || "";
    if (name) fields[name] = value;
  });
  return fields;
}

async function fetchPage(
  pageNum: number,
  cookies: string,
  formFields: Record<string, string>
): Promise<{ html: string; cookies: string }> {
  if (pageNum === 1) {
    // First page - simple GET
    const resp = await fetch(BASE_URL);
    const setCookies = resp.headers.getSetCookie();
    const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");
    return { html: await resp.text(), cookies: cookieStr };
  }

  // Use "Next Page" button (ctl28) to go page by page
  const eventTarget = `grid_all_players$ctl00$ctl03$ctl01$ctl28`;

  const body = new URLSearchParams({
    ...formFields,
    __EVENTTARGET: eventTarget,
    __EVENTARGUMENT: "",
  });

  const resp = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: body.toString(),
    redirect: "manual",
  });

  const newCookies = resp.headers.getSetCookie();
  if (newCookies.length > 0) {
    cookies = newCookies.map((c) => c.split(";")[0]).join("; ");
  }

  return { html: await resp.text(), cookies };
}

async function main() {
  console.log(`Scraping first ${TARGET_PLAYERS} players from FPP...`);

  const allPlayers: Player[] = [];

  // Fetch page 1
  console.log("Fetching page 1...");
  let { html, cookies } = await fetchPage(1, "", {});
  let $ = cheerio.load(html);
  let players = parsePlayers($);
  console.log(`  Found ${players.length} players`);
  allPlayers.push(...players);

  let formFields = extractFormFields($);

  // Fetch remaining pages
  for (let page = 2; page <= PAGES_NEEDED && allPlayers.length < TARGET_PLAYERS; page++) {
    console.log(`Fetching page ${page}...`);
    await new Promise((r) => setTimeout(r, 500)); // Be polite

    const result = await fetchPage(page, cookies, formFields);
    html = result.html;
    cookies = result.cookies;

    $ = cheerio.load(html);
    players = parsePlayers($);
    console.log(`  Found ${players.length} players`);

    if (players.length === 0) {
      console.log("  No players found, dumping page snippet for debug...");
      // Check if it's an error or different structure
      const gridHtml = $("#grid_all_players").html()?.substring(0, 500);
      console.log(`  Grid HTML: ${gridHtml || "NOT FOUND"}`);
      break;
    }

    allPlayers.push(...players);
    formFields = extractFormFields($);
  }

  // Trim to target
  const finalPlayers = allPlayers.slice(0, TARGET_PLAYERS);
  console.log(`\nTotal: ${finalPlayers.length} players scraped`);

  // Save as JSON
  await Bun.write(
    "players.json",
    JSON.stringify(finalPlayers, null, 2)
  );
  console.log("Saved to players.json");

  // Also save as CSV
  const csvHeader = "id,name,club,section,location,age";
  const csvRows = finalPlayers.map(
    (p) =>
      `${p.id},"${p.name.replace(/"/g, '""')}","${p.club.replace(/"/g, '""')}","${p.section.replace(/"/g, '""')}","${p.location.replace(/"/g, '""')}","${p.age.replace(/"/g, '""')}"`
  );
  await Bun.write("players.csv", [csvHeader, ...csvRows].join("\n"));
  console.log("Saved to players.csv");
}

main().catch(console.error);
