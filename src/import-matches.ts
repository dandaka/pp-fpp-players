import { getDb } from "./db";

interface ScrapedMatch {
  news_id: number;
  news_uid: string;
  date: string;
  scores: string;
  side_a: { id: number; name: string }[];
  side_b: { id: number; name: string }[];
  winner: "a" | "b" | null;
  location: string;
  draw_info: string;
}

interface MatchesFile {
  tournament: { name: string; id: number };
  matches: ScrapedMatch[];
}

function parseScores(scores: string) {
  return scores.split(", ").map((set) => {
    const parts = set.split("-");
    return {
      set_a: parseInt(parts[0] ?? "0"),
      set_b: parseInt(parts[1] ?? "0"),
      tie_a: -1,
      tie_b: -1,
    };
  });
}

export async function importMatchesFromJson(filePath = "matches.json") {
  const db = getDb();
  const data: MatchesFile = await Bun.file(filePath).json();

  console.log(`Importing ${data.matches.length} matches from ${data.tournament.name}...`);

  const insertMatch = db.prepare(`
    INSERT OR REPLACE INTO matches (guid, tournament_name, section_name, round_name, date_time,
      is_singles, side_a_ids, side_b_ids, side_a_names, side_b_names, sets_json, winner_side, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMatchPlayer = db.prepare(`
    INSERT OR IGNORE INTO match_players (match_guid, player_id, side)
    VALUES (?, ?, ?)
  `);

  const insertNewPlayer = db.prepare(`
    INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)
  `);

  const tx = db.transaction(() => {
    for (const m of data.matches) {
      const sideAIds = m.side_a.map((p) => p.id);
      const sideBIds = m.side_b.map((p) => p.id);
      const sideANames = m.side_a.map((p) => p.name).join(" / ");
      const sideBNames = m.side_b.map((p) => p.name).join(" / ");
      const isSingles = m.side_a.length === 1 && m.side_b.length === 1;
      const sets = parseScores(m.scores);

      insertMatch.run(
        m.news_uid, data.tournament.name, m.draw_info, "",
        m.date, isSingles ? 1 : 0,
        JSON.stringify(sideAIds), JSON.stringify(sideBIds),
        sideANames, sideBNames,
        JSON.stringify(sets), m.winner, "scrape:matches.json"
      );

      for (const p of m.side_a) {
        insertNewPlayer.run(p.id, p.name);
        insertMatchPlayer.run(m.news_uid, p.id, "a");
      }
      for (const p of m.side_b) {
        insertNewPlayer.run(p.id, p.name);
        insertMatchPlayer.run(m.news_uid, p.id, "b");
      }
    }
  });
  tx();

  const stats = {
    matches: db.query("SELECT COUNT(*) as cnt FROM matches").get() as { cnt: number },
    players: db.query("SELECT COUNT(*) as cnt FROM players").get() as { cnt: number },
    withResults: db.query("SELECT COUNT(*) as cnt FROM matches WHERE winner_side IS NOT NULL").get() as { cnt: number },
  };

  console.log(`Import complete.`);
  console.log(`  Matches: ${stats.matches.cnt} (${stats.withResults.cnt} with results)`);
  console.log(`  Players: ${stats.players.cnt}`);
}

if (import.meta.main) {
  await importMatchesFromJson(process.argv[2]);
}
