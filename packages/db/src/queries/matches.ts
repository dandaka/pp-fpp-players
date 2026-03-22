import { getDb } from "../connection";
import type { MatchDetail, PlayerRating, UpcomingMatchDetail } from "../types";

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

function batchGetMatchRatingDeltas(
  db: ReturnType<typeof getDb>,
  matchGuids: string[]
): Map<string, { scoreBefore: number; scoreDelta: number }> {
  if (matchGuids.length === 0) return new Map();
  const bounds = db.query("SELECT MIN(ordinal) as minOrd, MAX(ordinal) as maxOrd FROM ratings").get() as { minOrd: number; maxOrd: number };
  const range = bounds.maxOrd - bounds.minOrd;
  if (range <= 0) return new Map();

  const placeholders = matchGuids.map(() => "?").join(",");
  const rows = db.query(`
    SELECT match_guid, player_id, ordinal_before, ordinal_delta
    FROM match_ratings WHERE match_guid IN (${placeholders})
  `).all(...matchGuids) as Array<{ match_guid: string; player_id: number; ordinal_before: number; ordinal_delta: number }>;

  const map = new Map<string, { scoreBefore: number; scoreDelta: number }>();
  for (const r of rows) {
    const scoreBefore = Math.round(((r.ordinal_before - bounds.minOrd) / range) * 1000) / 10;
    const scoreDelta = Math.round((r.ordinal_delta / range) * 1000) / 10;
    map.set(`${r.match_guid}:${r.player_id}`, { scoreBefore, scoreDelta });
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
           m.sets_json, m.winner_side, m.result_type, m.source,
           m.side_a_ids, m.side_b_ids, m.side_a_names, m.side_b_names
    FROM matches m
    JOIN match_players mp ON mp.match_guid = m.guid
    WHERE mp.player_id = ? AND m.winner_side IS NOT NULL
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
    winner_side: string | null; result_type: string | null; source: string | null;
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

  // Batch-fetch match rating deltas from match_ratings table
  const matchGuids = parsedRows.map((r) => r.guid);
  const matchRatingDeltas = batchGetMatchRatingDeltas(db, matchGuids);

  // Batch-fetch full names and photos from players table
  const namePlaceholders = allPlayerIdList.map(() => "?").join(",");
  const nameRows = allPlayerIdList.length > 0
    ? db.query(`SELECT id, name, photo_url FROM players WHERE id IN (${namePlaceholders})`).all(...allPlayerIdList) as Array<{ id: number; name: string; photo_url: string | null }>
    : [];
  const fullNames = new Map(nameRows.map((r) => [r.id, r.name]));
  const photoUrls = new Map(nameRows.map((r) => [r.id, r.photo_url]));

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
      resultType: (row.result_type as "normal" | "walkover" | "retired") ?? "normal",
      sideA: row.sideAIds.map((id: number, i: number) => {
        const mr = matchRatingDeltas.get(`${row.guid}:${id}`);
        return {
          id,
          name: fullNames.get(id) ?? sideANames[i] ?? "",
          photoUrl: photoUrls.get(id) ?? null,
          genderRank: genderRanks.get(id) ?? null,
          categoryRank: null,
          rating: ratings.get(id) ?? null,
          ratingBefore: mr?.scoreBefore ?? null,
          ratingDelta: mr?.scoreDelta ?? null,
        };
      }),
      sideB: row.sideBIds.map((id: number, i: number) => {
        const mr = matchRatingDeltas.get(`${row.guid}:${id}`);
        return {
          id,
          name: fullNames.get(id) ?? sideBNames[i] ?? "",
          photoUrl: photoUrls.get(id) ?? null,
          genderRank: genderRanks.get(id) ?? null,
          categoryRank: null,
          rating: ratings.get(id) ?? null,
          ratingBefore: mr?.scoreBefore ?? null,
          ratingDelta: mr?.scoreDelta ?? null,
        };
      }),
    };
  });

  const nextCursor = hasMore && matchRows.length > 0
    ? `${matchRows[matchRows.length - 1].date_time}|${matchRows[matchRows.length - 1].guid}`
    : null;

  return { matches, nextCursor };
}

/**
 * Compute win probability for side A using Bradley-Terry model from OpenSkill mu/sigma.
 * For doubles, combine team ratings by summing mu and root-sum-square of sigma.
 */
function computeWinProbability(
  sideARatings: Array<{ mu: number; sigma: number }>,
  sideBRatings: Array<{ mu: number; sigma: number }>
): number | null {
  if (sideARatings.length === 0 || sideBRatings.length === 0) return null;

  const muA = sideARatings.reduce((sum, r) => sum + r.mu, 0);
  const muB = sideBRatings.reduce((sum, r) => sum + r.mu, 0);
  const sigmaA = Math.sqrt(sideARatings.reduce((sum, r) => sum + r.sigma * r.sigma, 0));
  const sigmaB = Math.sqrt(sideBRatings.reduce((sum, r) => sum + r.sigma * r.sigma, 0));

  const deltaMu = muA - muB;
  const denominator = Math.sqrt(2 * (sigmaA * sigmaA + sigmaB * sigmaB));
  if (denominator === 0) return 0.5;

  // Approximation of normal CDF using error function
  const x = deltaMu / denominator;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const erf = 1 - (0.254829592 * t - 0.284496736 * t * t + 1.421413741 * t ** 3
    - 1.453152027 * t ** 4 + 1.061405429 * t ** 5) * Math.exp(-x * x);
  const phi = 0.5 * (1 + (x >= 0 ? erf : -erf));

  return Math.round(phi * 100) / 100;
}

export function getPlayerUpcomingMatches(playerId: number): UpcomingMatchDetail[] {
  const db = getDb();

  const rows = db.query(`
    SELECT m.guid, m.tournament_name, m.section_name, m.round_name, m.date_time, m.court,
           m.category, m.subcategory, m.source,
           m.side_a_ids, m.side_b_ids, m.side_a_names, m.side_b_names
    FROM matches m
    JOIN match_players mp ON mp.match_guid = m.guid
    WHERE mp.player_id = ? AND m.winner_side IS NULL
      AND m.date_time > datetime('now', '-1 day')
    ORDER BY m.date_time ASC
  `).all(playerId) as Array<{
    guid: string; tournament_name: string | null; section_name: string | null;
    round_name: string | null; date_time: string | null; court: string | null;
    category: string | null; subcategory: string | null; source: string | null;
    side_a_ids: string; side_b_ids: string; side_a_names: string | null; side_b_names: string | null;
  }>;

  // Collect all player IDs
  const allPlayerIds = new Set<number>();
  for (const row of rows) {
    for (const id of JSON.parse(row.side_a_ids)) allPlayerIds.add(id);
    for (const id of JSON.parse(row.side_b_ids)) allPlayerIds.add(id);
  }
  const idList = [...allPlayerIds];

  // Batch-fetch names, photos, ratings, and mu/sigma
  const fullNames = new Map<number, string>();
  const photoUrls = new Map<number, string | null>();
  const muSigma = new Map<number, { mu: number; sigma: number }>();
  if (idList.length > 0) {
    const placeholders = idList.map(() => "?").join(",");
    const nameRows = db.query(
      `SELECT id, name, photo_url FROM players WHERE id IN (${placeholders})`
    ).all(...idList) as Array<{ id: number; name: string; photo_url: string | null }>;
    for (const r of nameRows) fullNames.set(r.id, r.name);
    for (const r of nameRows) photoUrls.set(r.id, r.photo_url);

    const ratingRows = db.query(
      `SELECT player_id, mu, sigma FROM ratings WHERE player_id IN (${placeholders})`
    ).all(...idList) as Array<{ player_id: number; mu: number; sigma: number }>;
    for (const r of ratingRows) muSigma.set(r.player_id, { mu: r.mu, sigma: r.sigma });
  }

  const genderRanks = batchGetGenderRanks(idList);
  const ratings = batchGetRatings(idList);

  return rows.map((row) => {
    const sideAIds: number[] = JSON.parse(row.side_a_ids);
    const sideBIds: number[] = JSON.parse(row.side_b_ids);
    const sideANames = (row.side_a_names ?? "").split(" / ");
    const sideBNames = (row.side_b_names ?? "").split(" / ");

    const sideARatingsRaw = sideAIds.map((id) => muSigma.get(id)).filter(Boolean) as Array<{ mu: number; sigma: number }>;
    const sideBRatingsRaw = sideBIds.map((id) => muSigma.get(id)).filter(Boolean) as Array<{ mu: number; sigma: number }>;

    return {
      guid: row.guid,
      tournamentId: parseTournamentIdFromSource(row.source),
      tournamentName: row.tournament_name,
      sectionName: row.section_name,
      roundName: row.round_name,
      dateTime: row.date_time,
      court: row.court,
      category: row.category,
      subcategory: row.subcategory,
      sets: [],
      winnerSide: null,
      resultType: "normal" as const,
      sideA: sideAIds.map((id, i) => ({
        id,
        name: fullNames.get(id) ?? sideANames[i] ?? "",
        photoUrl: photoUrls.get(id) ?? null,
        genderRank: genderRanks.get(id) ?? null,
        categoryRank: null,
        rating: ratings.get(id) ?? null,
        ratingBefore: null,
        ratingDelta: null,
      })),
      sideB: sideBIds.map((id, i) => ({
        id,
        name: fullNames.get(id) ?? sideBNames[i] ?? "",
        photoUrl: photoUrls.get(id) ?? null,
        genderRank: genderRanks.get(id) ?? null,
        categoryRank: null,
        rating: ratings.get(id) ?? null,
        ratingBefore: null,
        ratingDelta: null,
      })),
      sideAWinProbability: computeWinProbability(sideARatingsRaw, sideBRatingsRaw),
    };
  });
}
