import { getDb } from "../connection";
import type { MatchDetail, PlayerRating } from "../types";

function parseTournamentIdFromSource(source: string | null): number | null {
  if (!source) return null;
  const match = source.match(/(?:scrape|schedule):tournament:(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function parseSets(setsJson: string | null): MatchDetail["sets"] {
  if (!setsJson) return [];
  try {
    const raw = JSON.parse(setsJson);
    return raw.map((s: any) => ({
      setA: s.set_a ?? 0,
      setB: s.set_b ?? 0,
      tieA: s.tie_a ?? -1,
      tieB: s.tie_b ?? -1,
    }));
  } catch {
    return [];
  }
}

function batchGetGenderRanks(playerIds: number[]): Map<number, number | null> {
  if (playerIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = playerIds.map(() => "?").join(",");

  const rows = db.query(`
    SELECT p.id, p.gender, r.ordinal,
      (SELECT COUNT(*) + 1 FROM ratings r2
       JOIN players p2 ON p2.id = r2.player_id
       WHERE r2.ordinal > r.ordinal AND p2.gender = p.gender) as genderRank
    FROM players p
    JOIN ratings r ON r.player_id = p.id
    WHERE p.id IN (${placeholders}) AND p.gender IS NOT NULL AND p.gender != ''
  `).all(...playerIds) as Array<{ id: number; genderRank: number }>;

  const map = new Map<number, number | null>();
  for (const id of playerIds) map.set(id, null);
  for (const row of rows) map.set(row.id, row.genderRank);
  return map;
}

const RELIABILITY_K = 5;

function batchGetRatings(playerIds: number[]): Map<number, PlayerRating> {
  if (playerIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = playerIds.map(() => "?").join(",");

  const bounds = db.query("SELECT MIN(ordinal) as minOrd, MAX(ordinal) as maxOrd FROM ratings").get() as { minOrd: number; maxOrd: number };
  const rows = db.query(`
    SELECT player_id as id, ordinal, matches_counted
    FROM ratings WHERE player_id IN (${placeholders})
  `).all(...playerIds) as Array<{ id: number; ordinal: number; matches_counted: number }>;

  const range = bounds.maxOrd - bounds.minOrd;
  const map = new Map<number, PlayerRating>();
  for (const r of rows) {
    const score = range > 0 ? Math.round(((r.ordinal - bounds.minOrd) / range) * 1000) / 10 : 0;
    const reliability = Math.round((r.matches_counted / (r.matches_counted + RELIABILITY_K)) * 100);
    map.set(r.id, { score, reliability });
  }
  return map;
}

export function getPlayerMatches(
  playerId: number,
  cursor?: string,
  limit = 20
): { matches: MatchDetail[]; nextCursor: string | null } {
  const db = getDb();

  let query = `
    SELECT DISTINCT m.guid, m.tournament_name, m.section_name, m.round_name, m.date_time,
           m.sets_json, m.winner_side, m.source,
           m.side_a_ids, m.side_b_ids, m.side_a_names, m.side_b_names
    FROM matches m
    JOIN match_players mp ON mp.match_guid = m.guid
    WHERE mp.player_id = ?
  `;
  const params: any[] = [playerId];

  if (cursor) {
    const [cursorDate, cursorGuid] = cursor.split("|");
    query += " AND (m.date_time < ? OR (m.date_time = ? AND m.guid < ?))";
    params.push(cursorDate, cursorDate, cursorGuid);
  }

  query += " ORDER BY m.date_time DESC, m.guid DESC LIMIT ?";
  params.push(limit + 1);

  const rows = db.query(query).all(...params) as Array<{
    guid: string; tournament_name: string | null; section_name: string | null;
    round_name: string | null; date_time: string | null; sets_json: string | null;
    winner_side: string | null; source: string | null;
    side_a_ids: string; side_b_ids: string; side_a_names: string | null; side_b_names: string | null;
  }>;

  const hasMore = rows.length > limit;
  const matchRows = hasMore ? rows.slice(0, limit) : rows;

  // Collect all player IDs across all matches for batch rank lookup
  const allPlayerIds = new Set<number>();
  const parsedRows = matchRows.map((row) => {
    const sideAIds: number[] = JSON.parse(row.side_a_ids);
    const sideBIds: number[] = JSON.parse(row.side_b_ids);
    for (const id of [...sideAIds, ...sideBIds]) allPlayerIds.add(id);
    return { ...row, sideAIds, sideBIds };
  });

  const allPlayerIdList = [...allPlayerIds];
  const genderRanks = batchGetGenderRanks(allPlayerIdList);
  const ratings = batchGetRatings(allPlayerIdList);

  // Batch-fetch full names from players table
  const namePlaceholders = allPlayerIdList.map(() => "?").join(",");
  const nameRows = allPlayerIdList.length > 0
    ? db.query(`SELECT id, name FROM players WHERE id IN (${namePlaceholders})`).all(...allPlayerIdList) as Array<{ id: number; name: string }>
    : [];
  const fullNames = new Map(nameRows.map((r) => [r.id, r.name]));

  const matches: MatchDetail[] = parsedRows.map((row) => {
    const sideANames = (row.side_a_names ?? "").split(" / ");
    const sideBNames = (row.side_b_names ?? "").split(" / ");

    return {
      guid: row.guid,
      tournamentId: parseTournamentIdFromSource(row.source),
      tournamentName: row.tournament_name,
      sectionName: row.section_name,
      roundName: row.round_name,
      dateTime: row.date_time,
      sets: parseSets(row.sets_json),
      winnerSide: row.winner_side,
      sideA: row.sideAIds.map((id: number, i: number) => ({
        id,
        name: fullNames.get(id) ?? sideANames[i] ?? "",
        genderRank: genderRanks.get(id) ?? null,
        categoryRank: null,
        rating: ratings.get(id) ?? null,
      })),
      sideB: row.sideBIds.map((id: number, i: number) => ({
        id,
        name: fullNames.get(id) ?? sideBNames[i] ?? "",
        genderRank: genderRanks.get(id) ?? null,
        categoryRank: null,
        rating: ratings.get(id) ?? null,
      })),
    };
  });

  const nextCursor = hasMore && matchRows.length > 0
    ? `${matchRows[matchRows.length - 1].date_time}|${matchRows[matchRows.length - 1].guid}`
    : null;

  return { matches, nextCursor };
}
