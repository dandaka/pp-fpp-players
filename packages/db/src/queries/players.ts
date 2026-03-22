import { getDb } from "../connection";
import { scoreMatch } from "../lib/fuzzy-search";
import type { PlayerSearchResult, Player, PlayerRanks, PlayerRating } from "../types";

const RELIABILITY_K = 5; // matches/(matches+K) curve; K=20 means 50% at 20 games

function computeRating(ordinal: number, matchesCounted: number, minOrd: number, maxOrd: number): PlayerRating {
  const range = maxOrd - minOrd;
  const score = range > 0 ? Math.round(((ordinal - minOrd) / range) * 1000) / 10 : 0;
  const reliability = Math.round((matchesCounted / (matchesCounted + RELIABILITY_K)) * 100);
  return { score, reliability };
}

export function getPlayerRating(id: number): PlayerRating | null {
  const db = getDb();
  const row = db.query(`
    SELECT r.ordinal, r.matches_counted,
      (SELECT MIN(ordinal) FROM ratings) as minOrd,
      (SELECT MAX(ordinal) FROM ratings) as maxOrd
    FROM ratings r WHERE r.player_id = ?
  `).get(id) as { ordinal: number; matches_counted: number; minOrd: number; maxOrd: number } | null;

  if (!row) return null;
  return computeRating(row.ordinal, row.matches_counted, row.minOrd, row.maxOrd);
}

export function searchPlayers(query: string, limit = 20): PlayerSearchResult[] {
  if (!query || query.trim().length === 0) return [];

  const db = getDb();

  // Build WHERE clause: each query word must appear in the name
  const words = query.trim().split(/\s+/).filter(Boolean);
  const conditions = words.map(() => "name LIKE ?").join(" AND ");
  const params = words.map((w) => `%${w}%`);

  const rows = db.query(`
    SELECT id, name, club FROM players
    WHERE ${conditions}
    ORDER BY name
    LIMIT ?
  `).all(...params, limit * 3) as Array<{ id: number; name: string; club: string | null }>;

  // Re-rank with fuzzy scoring
  const scored = rows
    .map((row) => ({ ...row, score: scoreMatch(query, row.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return [];

  const ids = scored.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const rankRows = db.query(`
    SELECT r.player_id as id,
      (SELECT COUNT(*) + 1 FROM ratings r2 WHERE r2.ordinal > r.ordinal) as globalRank
    FROM ratings r WHERE r.player_id IN (${placeholders})
  `).all(...ids) as Array<{ id: number; globalRank: number }>;

  const rankMap = new Map(rankRows.map((r) => [r.id, r.globalRank]));

  // Batch-fetch ratings for matched players
  const ratingRows = db.query(`
    SELECT r.player_id as id, r.ordinal, r.matches_counted,
      (SELECT MIN(ordinal) FROM ratings) as minOrd,
      (SELECT MAX(ordinal) FROM ratings) as maxOrd
    FROM ratings r WHERE r.player_id IN (${placeholders})
  `).all(...ids) as Array<{ id: number; ordinal: number; matches_counted: number; minOrd: number; maxOrd: number }>;

  const ratingMap = new Map(ratingRows.map((r) => [r.id, computeRating(r.ordinal, r.matches_counted, r.minOrd, r.maxOrd)]));

  // Batch-fetch last match dates
  const lastMatchRows = db.query(`
    SELECT mp.player_id as id, MAX(m.date_time) as lastMatch
    FROM match_players mp
    JOIN matches m ON m.guid = mp.match_guid
    WHERE mp.player_id IN (${placeholders}) AND m.date_time IS NOT NULL
    GROUP BY mp.player_id
  `).all(...ids) as Array<{ id: number; lastMatch: string }>;

  const lastMatchMap = new Map(lastMatchRows.map((r) => [r.id, r.lastMatch]));

  return scored.map(({ score, ...rest }) => ({
    ...rest,
    globalRank: rankMap.get(rest.id) ?? 0,
    rating: ratingMap.get(rest.id) ?? null,
    lastMatch: lastMatchMap.get(rest.id) ?? null,
  }));
}

export function getPlayer(id: number): Player | null {
  const db = getDb();
  const row = db.query(`
    SELECT id, name, club, photo_url, gender, location, age_group, fpp_pontos
    FROM players WHERE id = ?
  `).get(id) as {
    id: number; name: string; club: string | null; photo_url: string | null;
    gender: string | null; location: string | null; age_group: string | null; fpp_pontos: number | null;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    club: row.club,
    photoUrl: row.photo_url,
    gender: row.gender,
    location: row.location,
    ageGroup: row.age_group,
    fppPontos: row.fpp_pontos,
  };
}

export function getPlayerTournamentsCount(id: number): number {
  const db = getDb();
  const row = db.query(`
    SELECT COUNT(DISTINCT m.tournament_name) as count
    FROM matches m
    JOIN match_players mp ON mp.match_guid = m.guid
    WHERE mp.player_id = ? AND m.tournament_name IS NOT NULL
  `).get(id) as { count: number };
  return row.count;
}

export function getPlayerMatchesCount(id: number): number {
  const db = getDb();
  const row = db.query(`
    SELECT COUNT(*) as count FROM match_players WHERE player_id = ?
  `).get(id) as { count: number };
  return row.count;
}

export function getPlayerStartYear(id: number): number | null {
  const db = getDb();
  const row = db.query(`
    SELECT MIN(m.date_time) as firstMatch
    FROM matches m
    JOIN match_players mp ON mp.match_guid = m.guid
    WHERE mp.player_id = ? AND m.date_time IS NOT NULL
  `).get(id) as { firstMatch: string | null } | null;
  if (!row?.firstMatch) return null;
  return new Date(row.firstMatch).getFullYear();
}

export function getPlayerRanks(id: number): PlayerRanks | null {
  const db = getDb();

  const player = db.query(`
    SELECT p.id, p.gender, p.club, r.ordinal
    FROM players p
    LEFT JOIN ratings r ON r.player_id = p.id
    WHERE p.id = ?
  `).get(id) as { id: number; gender: string | null; club: string | null; ordinal: number | null } | null;

  if (!player || player.ordinal === null) return null;

  const globalRank = db.query(
    "SELECT COUNT(*) + 1 as rank FROM ratings WHERE ordinal > ?"
  ).get(player.ordinal) as { rank: number };

  const globalTotal = db.query("SELECT COUNT(*) as total FROM ratings").get() as { total: number };

  const result: PlayerRanks = {
    global: { rank: globalRank.rank, total: globalTotal.total },
    gender: null,
    club: null,
  };

  if (player.gender) {
    const genderRank = db.query(`
      SELECT COUNT(*) + 1 as rank FROM ratings r
      JOIN players p ON p.id = r.player_id
      WHERE r.ordinal > ? AND p.gender = ?
    `).get(player.ordinal, player.gender) as { rank: number };

    const genderTotal = db.query(`
      SELECT COUNT(*) as total FROM ratings r
      JOIN players p ON p.id = r.player_id WHERE p.gender = ?
    `).get(player.gender) as { total: number };

    result.gender = { rank: genderRank.rank, total: genderTotal.total, label: player.gender };
  }

  if (player.club) {
    const clubRank = db.query(`
      SELECT COUNT(*) + 1 as rank FROM ratings r
      JOIN players p ON p.id = r.player_id
      WHERE r.ordinal > ? AND p.club = ?
    `).get(player.ordinal, player.club) as { rank: number };

    const clubTotal = db.query(`
      SELECT COUNT(*) as total FROM ratings r
      JOIN players p ON p.id = r.player_id WHERE p.club = ?
    `).get(player.club) as { total: number };

    result.club = { rank: clubRank.rank, total: clubTotal.total, label: player.club };
  }

  return result;
}
