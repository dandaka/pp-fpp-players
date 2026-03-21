import { getDb, getCursor, setCursor } from "./db";
import { getPlayerMatches } from "./api";
import type { ApiMatch } from "./types";

function parseMatchInfo(m: ApiMatch) {
  const sideAIds = m.side_a.map((p) => p.id);
  const sideBIds = m.side_b.map((p) => p.id);
  const sideANames = m.side_a.map((p) => p.name).join(" / ");
  const sideBNames = m.side_b.map((p) => p.name).join(" / ");
  const isSingles = m.side_a.length === 1 && m.side_b.length === 1;
  const winner = m.winner_a ? "a" : m.winner_b ? "b" : null;

  let tournamentName = "";
  let sectionName = "";
  let roundName = "";
  if (m.infos) {
    tournamentName = m.infos.top_left ?? "";
    const topRight = m.infos.top_right ?? "";
    const parts = topRight.split("\r\n");
    if (parts.length >= 2) {
      roundName = parts[0] ?? "";
      sectionName = parts[1] ?? "";
    } else if (parts.length === 1) {
      sectionName = parts[0] ?? "";
    }
  }

  const dateTime = m.infos?.date_time?.str ?? "";

  return {
    guid: m.id,
    tournamentName,
    sectionName,
    roundName,
    dateTime,
    isSingles,
    sideAIds: JSON.stringify(sideAIds),
    sideBIds: JSON.stringify(sideBIds),
    sideANames,
    sideBNames,
    setsJson: JSON.stringify(m.sets),
    winner,
  };
}

export async function syncPlayerMatches(
  years = [2024, 2025, 2026],
  delayMs = 300,
  resumeFromId?: number
) {
  const db = getDb();

  const cursorKey = "sync_matches_last_player_id";
  const lastId = resumeFromId ?? parseInt(getCursor(cursorKey) ?? "0");

  const players = db.query(
    "SELECT id, name FROM players WHERE id > ? ORDER BY id"
  ).all(lastId) as { id: number; name: string }[];

  console.log(`Syncing matches for ${players.length} players (starting after id=${lastId})`);

  const insertMatch = db.prepare(`
    INSERT OR IGNORE INTO matches (guid, tournament_name, section_name, round_name, date_time,
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

  let totalMatches = 0;

  for (const player of players) {
    let playerMatchCount = 0;

    for (const year of years) {
      try {
        const matches = await getPlayerMatches(player.id, year);

        const tx = db.transaction(() => {
          for (const m of matches) {
            const info = parseMatchInfo(m);
            insertMatch.run(
              info.guid, info.tournamentName, info.sectionName, info.roundName,
              info.dateTime, info.isSingles ? 1 : 0,
              info.sideAIds, info.sideBIds, info.sideANames, info.sideBNames,
              info.setsJson, info.winner, `player:${player.id}`
            );

            for (const p of m.side_a) {
              insertNewPlayer.run(p.id, p.name);
              insertMatchPlayer.run(info.guid, p.id, "a");
            }
            for (const p of m.side_b) {
              insertNewPlayer.run(p.id, p.name);
              insertMatchPlayer.run(info.guid, p.id, "b");
            }

            playerMatchCount++;
          }
        });
        tx();

        if (delayMs > 0) await Bun.sleep(delayMs);
      } catch (err) {
        console.error(`  Error fetching matches for ${player.name} (${year}):`, err);
      }
    }

    totalMatches += playerMatchCount;
    if (playerMatchCount > 0) {
      console.log(`  ${player.name}: ${playerMatchCount} matches`);
    }

    setCursor(cursorKey, String(player.id));
  }

  const discoveredPlayers = db.query(
    "SELECT COUNT(*) as cnt FROM players WHERE profile_synced_at IS NULL AND club IS NULL"
  ).get() as { cnt: number };

  console.log(`\nSync complete: ${totalMatches} matches, ${discoveredPlayers.cnt} new players discovered`);
}

if (import.meta.main) {
  const resumeFrom = process.argv[2] ? parseInt(process.argv[2]) : undefined;
  await syncPlayerMatches([2024, 2025, 2026], 300, resumeFrom);
}
