import { getDb } from "../connection";
import type { Tournament, TournamentDetail, TournamentPlayer, MatchDetail, UpcomingMatchDetail, PlayerRating } from "../types";

export function getTournaments(page = 1, pageSize = 20, search?: string): { tournaments: Tournament[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  if (search && search.trim()) {
    const pattern = `%${search.trim()}%`;
    const total = db.query("SELECT COUNT(*) as total FROM tournaments WHERE name LIKE ?").get(pattern) as { total: number };
    const rows = db.query(`
      SELECT id, name, club, date FROM tournaments
      WHERE name LIKE ?
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `).all(pattern, pageSize, offset) as Tournament[];
    return { tournaments: rows, total: total.total };
  }

  const total = db.query("SELECT COUNT(*) as total FROM tournaments").get() as { total: number };

  const rows = db.query(`
    SELECT id, name, club, date FROM tournaments
    ORDER BY date DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset) as Tournament[];

  return { tournaments: rows, total: total.total };
}

export function getTournament(id: number): TournamentDetail | null {
  const db = getDb();
  const row = db.query(`
    SELECT id, name, club, date, link_web FROM tournaments WHERE id = ?
  `).get(id) as { id: number; name: string; club: string | null; date: string | null; link_web: string | null } | null;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    club: row.club,
    date: row.date,
    linkWeb: row.link_web,
  };
}

export function getTournamentCategories(tournamentId: number): string[] {
  const db = getDb();

  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  if (!tournament) return [];

  const rows = db.query(`
    SELECT DISTINCT section_name FROM matches
    WHERE (source = ? OR tournament_name = ?)
    AND section_name IS NOT NULL AND length(section_name) > 0
    ORDER BY section_name
  `).all(`scrape:tournament:${tournamentId}`, tournament.name) as Array<{ section_name: string }>;

  return rows.map((r) => r.section_name);
}

export function getTournamentPlayers(
  tournamentId: number,
  category?: string
): TournamentPlayer[] {
  const db = getDb();

  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  if (!tournament) return [];

  // Pre-compute global and gender ranks in one pass
  const globalRanks = new Map<number, number>();
  const genderRanks = new Map<number, number>();
  const rankRows = db.query(`
    SELECT r.player_id, p.gender,
      RANK() OVER (ORDER BY r.ordinal DESC) as global_rank,
      RANK() OVER (PARTITION BY p.gender ORDER BY r.ordinal DESC) as gender_rank
    FROM ratings r
    JOIN players p ON p.id = r.player_id
  `).all() as Array<{ player_id: number; gender: string | null; global_rank: number; gender_rank: number }>;
  for (const row of rankRows) {
    globalRanks.set(row.player_id, row.global_rank);
    if (row.gender !== null) {
      genderRanks.set(row.player_id, row.gender_rank);
    }
  }

  const bounds = db.query("SELECT MIN(ordinal) as minOrd, MAX(ordinal) as maxOrd FROM ratings").get() as { minOrd: number; maxOrd: number };

  let query = `
    SELECT DISTINCT p.id, p.name, p.gender, p.club, p.photo_url, p.license_number,
      r.ordinal, r.matches_counted,
      (SELECT MAX(m2.date_time) FROM matches m2 JOIN match_players mp2 ON mp2.match_guid = m2.guid WHERE mp2.player_id = p.id) as last_match
    FROM players p
    JOIN match_players mp ON mp.player_id = p.id
    JOIN matches m ON m.guid = mp.match_guid
    LEFT JOIN ratings r ON r.player_id = p.id
    WHERE (m.source = ? OR m.tournament_name = ?)
  `;
  const params: any[] = [`scrape:tournament:${tournamentId}`, tournament.name];

  if (category) {
    query += " AND m.section_name = ?";
    params.push(category);
  }

  query += " ORDER BY r.ordinal DESC NULLS LAST";

  const rows = db.query(query).all(...params) as Array<{
    id: number; name: string; gender: string | null; club: string | null;
    photo_url: string | null; license_number: string | null;
    ordinal: number | null; matches_counted: number | null;
    last_match: string | null;
  }>;

  const range = bounds.maxOrd - bounds.minOrd;

  return rows.map((row) => {
    let rating: PlayerRating | null = null;
    if (row.ordinal != null && row.matches_counted != null) {
      const score = range > 0 ? Math.round(((row.ordinal - bounds.minOrd) / range) * 1000) / 10 : 0;
      const reliability = Math.round((row.matches_counted / (row.matches_counted + RELIABILITY_K)) * 100);
      rating = { score, reliability };
    }
    return {
      id: row.id,
      name: row.name,
      club: row.club ?? null,
      photoUrl: row.photo_url ?? null,
      licenseNumber: row.license_number ?? null,
      globalRank: globalRanks.get(row.id) ?? null,
      genderRank: genderRanks.get(row.id) ?? null,
      categoryRank: null,
      ordinal: row.ordinal ?? 0,
      rating,
      lastMatch: row.last_match ?? null,
    };
  });
}

const RELIABILITY_K = 5;

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
      setA: s.set_a ?? 0, setB: s.set_b ?? 0,
      tieA: s.tie_a ?? -1, tieB: s.tie_b ?? -1,
    }));
  } catch { return []; }
}

function computeWinProbability(
  sideA: Array<{ mu: number; sigma: number }>,
  sideB: Array<{ mu: number; sigma: number }>
): number | null {
  if (sideA.length === 0 || sideB.length === 0) return null;
  const muA = sideA.reduce((s, r) => s + r.mu, 0);
  const muB = sideB.reduce((s, r) => s + r.mu, 0);
  const sigmaA = Math.sqrt(sideA.reduce((s, r) => s + r.sigma * r.sigma, 0));
  const sigmaB = Math.sqrt(sideB.reduce((s, r) => s + r.sigma * r.sigma, 0));
  const deltaMu = muA - muB;
  const denom = Math.sqrt(2 * (sigmaA * sigmaA + sigmaB * sigmaB));
  if (denom === 0) return 0.5;
  const x = deltaMu / denom;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const erf = 1 - (0.254829592 * t - 0.284496736 * t * t + 1.421413741 * t ** 3
    - 1.453152027 * t ** 4 + 1.061405429 * t ** 5) * Math.exp(-x * x);
  return Math.round(0.5 * (1 + (x >= 0 ? erf : -erf)) * 100) / 100;
}

export function getTournamentMatches(
  tournamentId: number,
  category?: string
): { upcoming: UpcomingMatchDetail[]; completed: MatchDetail[] } {
  const db = getDb();

  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  if (!tournament) return { upcoming: [], completed: [] };

  let query = `
    SELECT m.guid, m.section_name, m.round_name, m.date_time, m.court,
           m.category, m.subcategory, m.sets_json, m.winner_side, m.result_type, m.source,
           m.side_a_ids, m.side_b_ids, m.side_a_names, m.side_b_names,
           m.tournament_name
    FROM matches m
    WHERE (m.source = ? OR m.source = ? OR m.tournament_name = ?)
  `;
  const params: any[] = [
    `scrape:tournament:${tournamentId}`,
    `schedule:tournament:${tournamentId}`,
    tournament.name,
  ];

  if (category) {
    query += " AND (m.category = ? OR m.section_name = ?)";
    params.push(category, category);
  }

  query += " ORDER BY m.date_time ASC";

  const rows = db.query(query).all(...params) as Array<{
    guid: string; section_name: string | null; round_name: string | null;
    date_time: string | null; court: string | null; category: string | null;
    subcategory: string | null; sets_json: string | null; winner_side: string | null;
    result_type: string | null; source: string | null; tournament_name: string | null;
    side_a_ids: string; side_b_ids: string; side_a_names: string | null; side_b_names: string | null;
  }>;

  // Collect all player IDs
  const allPlayerIds = new Set<number>();
  for (const row of rows) {
    for (const id of JSON.parse(row.side_a_ids)) allPlayerIds.add(id);
    for (const id of JSON.parse(row.side_b_ids)) allPlayerIds.add(id);
  }
  const idList = [...allPlayerIds];

  // Batch-fetch player names, photos, ratings, gender ranks, mu/sigma
  const fullNames = new Map<number, string>();
  const photoUrls = new Map<number, string | null>();
  const muSigma = new Map<number, { mu: number; sigma: number }>();
  const ratingsMap = new Map<number, PlayerRating>();
  const genderRanks = new Map<number, number | null>();

  if (idList.length > 0) {
    const placeholders = idList.map(() => "?").join(",");

    const nameRows = db.query(
      `SELECT id, name, photo_url FROM players WHERE id IN (${placeholders})`
    ).all(...idList) as Array<{ id: number; name: string; photo_url: string | null }>;
    for (const r of nameRows) { fullNames.set(r.id, r.name); photoUrls.set(r.id, r.photo_url); }

    const bounds = db.query("SELECT MIN(ordinal) as minOrd, MAX(ordinal) as maxOrd FROM ratings").get() as { minOrd: number; maxOrd: number };
    const range = bounds.maxOrd - bounds.minOrd;

    const ratingRows = db.query(
      `SELECT player_id, ordinal, matches_counted, mu, sigma FROM ratings WHERE player_id IN (${placeholders})`
    ).all(...idList) as Array<{ player_id: number; ordinal: number; matches_counted: number; mu: number; sigma: number }>;
    for (const r of ratingRows) {
      const score = range > 0 ? Math.round(((r.ordinal - bounds.minOrd) / range) * 1000) / 10 : 0;
      const reliability = Math.round((r.matches_counted / (r.matches_counted + RELIABILITY_K)) * 100);
      ratingsMap.set(r.player_id, { score, reliability });
      muSigma.set(r.player_id, { mu: r.mu, sigma: r.sigma });
    }

    const genderRows = db.query(`
      SELECT p.id,
        (SELECT COUNT(*) + 1 FROM ratings r2
         JOIN players p2 ON p2.id = r2.player_id
         WHERE r2.ordinal > r.ordinal AND p2.gender = p.gender) as genderRank
      FROM players p
      JOIN ratings r ON r.player_id = p.id
      WHERE p.id IN (${placeholders}) AND p.gender IS NOT NULL AND p.gender != ''
    `).all(...idList) as Array<{ id: number; genderRank: number }>;
    for (const id of idList) genderRanks.set(id, null);
    for (const r of genderRows) genderRanks.set(r.id, r.genderRank);
  }

  function buildPlayerInfo(id: number, fallbackName: string) {
    return {
      id,
      name: fullNames.get(id) ?? fallbackName,
      photoUrl: photoUrls.get(id) ?? null,
      genderRank: genderRanks.get(id) ?? null,
      categoryRank: null,
      rating: ratingsMap.get(id) ?? null,
      ratingBefore: null,
      ratingDelta: null,
    };
  }

  const upcoming: UpcomingMatchDetail[] = [];
  const completed: MatchDetail[] = [];

  for (const row of rows) {
    const sideAIds: number[] = JSON.parse(row.side_a_ids);
    const sideBIds: number[] = JSON.parse(row.side_b_ids);
    const sideANames = (row.side_a_names ?? "").split(" / ");
    const sideBNames = (row.side_b_names ?? "").split(" / ");

    const base: MatchDetail = {
      guid: row.guid,
      tournamentId: parseTournamentIdFromSource(row.source),
      tournamentName: row.tournament_name,
      sectionName: row.section_name,
      roundName: row.round_name,
      dateTime: row.date_time,
      sets: parseSets(row.sets_json),
      winnerSide: row.winner_side,
      resultType: (row.result_type as "normal" | "walkover" | "retired") ?? "normal",
      sideA: sideAIds.map((id, i) => buildPlayerInfo(id, sideANames[i] ?? "")),
      sideB: sideBIds.map((id, i) => buildPlayerInfo(id, sideBNames[i] ?? "")),
    };

    if (row.winner_side) {
      completed.push(base);
    } else {
      const sideARatingsRaw = sideAIds.map((id) => muSigma.get(id)).filter(Boolean) as Array<{ mu: number; sigma: number }>;
      const sideBRatingsRaw = sideBIds.map((id) => muSigma.get(id)).filter(Boolean) as Array<{ mu: number; sigma: number }>;
      upcoming.push({
        ...base,
        court: row.court,
        category: row.category,
        subcategory: row.subcategory,
        sideAWinProbability: computeWinProbability(sideARatingsRaw, sideBRatingsRaw),
      });
    }
  }

  return { upcoming, completed };
}
