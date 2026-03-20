import { getDb } from "../connection";
import { normalizeString, scoreMatch } from "../lib/fuzzy-search";
import type { PlayerSearchResult, Player, PlayerRanks } from "../types";

// Cache all player names for fuzzy search (loaded once, ~46k rows, ~3MB)
let _playerCache: Array<{ id: number; name: string; club: string | null; normalized: string }> | null = null;

function getPlayerCache() {
  if (_playerCache) return _playerCache;
  const db = getDb();
  const rows = db.query("SELECT id, name, club FROM players").all() as Array<{ id: number; name: string; club: string | null }>;
  _playerCache = rows.map((r) => ({ ...r, normalized: normalizeString(r.name) }));
  return _playerCache;
}

export function searchPlayers(query: string, limit = 20): PlayerSearchResult[] {
  if (!query || query.trim().length === 0) return [];

  const db = getDb();
  const cache = getPlayerCache();

  const scored = cache
    .map((row) => ({ ...row, score: scoreMatch(query, row.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Batch-fetch ranks for matched players
  if (scored.length === 0) return [];

  const ids = scored.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const rankRows = db.query(`
    SELECT r.player_id as id,
      (SELECT COUNT(*) + 1 FROM ratings r2 WHERE r2.ordinal > r.ordinal) as globalRank
    FROM ratings r WHERE r.player_id IN (${placeholders})
  `).all(...ids) as Array<{ id: number; globalRank: number }>;

  const rankMap = new Map(rankRows.map((r) => [r.id, r.globalRank]));

  return scored.map(({ score, normalized, ...rest }) => ({
    ...rest,
    globalRank: rankMap.get(rest.id) ?? 0,
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
