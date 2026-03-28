import { getDb } from "../connection";
import { batchGetMatchRatingDeltas } from "./matches";
import type { Tournament, TournamentDetail, TournamentPlayer, MatchDetail, UpcomingMatchDetail, PlayerRating } from "../types";

// Tournament date is the start date; tournament runs until Sunday of that week.
// "This week" = tournament whose week (start..Sunday) overlaps the current week.
// Since date is the start and end is always Sunday of that week:
//   - A tournament is "this week" if date <= currentSunday AND tournamentEndSunday >= currentMonday
//   - Simplification: date's week Sunday = date + (7 - dayOfWeek(date)) for non-Sunday, or date itself
//   - We use: date <= currentWeekEnd AND date >= currentWeekStart - 6 (covers any day in current week)
//   Actually simpler: tournament is active this week if its start date falls in current Mon-Sun range,
//   OR if its start date is earlier but its end (Sunday of start week) >= current Monday.
//   Since end = start + (7 - dow(start)) % 7, the simplest SQL: the tournament's week overlaps current week
//   iff date <= currentSunday (tournament starts before current week ends)
//   AND sundayOfDateWeek >= currentMonday (tournament ends after current week starts).
//   In SQLite: sundayOfDateWeek = date(date, 'weekday 0') but weekday 0 = Sunday NEXT occurrence.
//   So we use: date(date, 'weekday 0') gives the Sunday on or after that date.

function getCurrentWeekBounds(): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

const TOURNAMENT_END = `date(date, 'weekday 0')`; // Sunday of tournament's week

function buildDateFilter(filter?: string): { where: string; params: any[] } {
  if (!filter) return { where: "", params: [] };
  const { weekStart, weekEnd } = getCurrentWeekBounds();
  switch (filter) {
    case "this_week":
      // Tournament active this week: starts <= Sunday AND its end (Sunday of its week) >= Monday
      return {
        where: `AND date <= ? AND ${TOURNAMENT_END} >= ?`,
        params: [weekEnd, weekStart],
      };
    case "upcoming":
      // Starts after current Sunday
      return { where: `AND date > ?`, params: [weekEnd] };
    case "past":
      // Tournament's end (Sunday of its week) is before current Monday
      return { where: `AND ${TOURNAMENT_END} < ?`, params: [weekStart] };
    default:
      return { where: "", params: [] };
  }
}

export function getTournaments(page = 1, pageSize = 20, search?: string, filter?: string): { tournaments: Tournament[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;
  const dateFilter = buildDateFilter(filter);

  if (search && search.trim()) {
    const pattern = `%${search.trim()}%`;
    const total = db.query(`SELECT COUNT(*) as total FROM tournaments WHERE name LIKE ? ${dateFilter.where}`).get(pattern, ...dateFilter.params) as { total: number };
    const rows = db.query(`
      SELECT id, name, club, date FROM tournaments
      WHERE name LIKE ? ${dateFilter.where}
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `).all(pattern, ...dateFilter.params, pageSize, offset) as Tournament[];
    return { tournaments: rows, total: total.total };
  }

  const total = db.query(`SELECT COUNT(*) as total FROM tournaments WHERE 1=1 ${dateFilter.where}`).get(...dateFilter.params) as { total: number };

  const rows = db.query(`
    SELECT id, name, club, date FROM tournaments
    WHERE 1=1 ${dateFilter.where}
    ORDER BY date DESC
    LIMIT ? OFFSET ?
  `).all(...dateFilter.params, pageSize, offset) as Tournament[];

  return { tournaments: rows, total: total.total };
}

export function getTournamentCounts(): { thisWeek: number; upcoming: number; past: number } {
  const db = getDb();
  const { weekStart, weekEnd } = getCurrentWeekBounds();

  const row = db.query(`
    SELECT
      SUM(CASE WHEN date <= ? AND ${TOURNAMENT_END} >= ? THEN 1 ELSE 0 END) as thisWeek,
      SUM(CASE WHEN date > ? THEN 1 ELSE 0 END) as upcoming,
      SUM(CASE WHEN ${TOURNAMENT_END} < ? THEN 1 ELSE 0 END) as past
    FROM tournaments
    WHERE date IS NOT NULL
  `).get(weekEnd, weekStart, weekEnd, weekStart) as { thisWeek: number; upcoming: number; past: number };

  return { thisWeek: row.thisWeek ?? 0, upcoming: row.upcoming ?? 0, past: row.past ?? 0 };
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

export interface CategoryInfo {
  code: string;
  name: string;
  matchCount: number;
  playerCount: number;
}

export function getTournamentCategories(tournamentId: number): CategoryInfo[] {
  const db = getDb();

  const rows = db.query(`
    SELECT
      COALESCE(m.category_code, m.section_name) as code,
      COALESCE(m.category, m.section_name) as name,
      COUNT(DISTINCT m.guid) as matchCount,
      COUNT(DISTINCT mp.player_id) as playerCount
    FROM matches m
    LEFT JOIN match_players mp ON mp.match_guid = m.guid
    WHERE (m.tournament_id = ? OR m.source IN (?, ?, ?))
    AND COALESCE(m.category_code, m.section_name) IS NOT NULL
    AND length(COALESCE(m.category_code, m.section_name)) > 0
    GROUP BY code
    ORDER BY code
  `).all(tournamentId, `scrape:tournament:${tournamentId}`, `schedule:tournament:${tournamentId}`, `api:tournament:${tournamentId}`) as CategoryInfo[];

  // Merge with tournament_players data (table may not exist if migration hasn't run)
  try {
    const tpRows = db.query(`
      SELECT category_code as code, COUNT(DISTINCT player_id) as cnt
      FROM tournament_players
      WHERE tournament_id = ?
      GROUP BY category_code
    `).all(tournamentId) as Array<{ code: string; cnt: number }>;

    const tpMap = new Map(tpRows.map((r) => [r.code, r.cnt]));

    for (const row of rows) {
      const tpCount = tpMap.get(row.code);
      if (tpCount != null) row.playerCount = tpCount;
    }

    const existingCodes = new Set(rows.map((r) => r.code));
    for (const [code, cnt] of tpMap) {
      if (!existingCodes.has(code)) {
        rows.push({ code, name: code, matchCount: 0, playerCount: cnt });
      }
    }
  } catch {
    // tournament_players table doesn't exist yet
  }

  return rows;
}

export function getTournamentPlayers(
  tournamentId: number,
  category?: string,
  page = 1,
  pageSize = 50
): { players: TournamentPlayer[]; total: number } {
  const db = getDb();

  // Try tournament_players first (table may not exist if migration hasn't run)
  try {
    const tpCount = db.query(
      "SELECT COUNT(*) as c FROM tournament_players WHERE tournament_id = ?"
    ).get(tournamentId) as { c: number };

    if (tpCount.c > 0) {
      return getTournamentPlayersFromTp(db, tournamentId, category, page, pageSize);
    }
  } catch {
    // tournament_players table doesn't exist yet
  }

  return getTournamentPlayersFromMatches(db, tournamentId, category, page, pageSize);
}

function getTournamentPlayersFromTp(
  db: ReturnType<typeof getDb>,
  tournamentId: number,
  category: string | undefined,
  page: number,
  pageSize: number
): { players: TournamentPlayer[]; total: number } {
  let countQuery = "SELECT COUNT(DISTINCT tp.player_id) as c FROM tournament_players tp WHERE tp.tournament_id = ?";
  let idQuery = `
    SELECT DISTINCT tp.player_id, COALESCE(r.ordinal, -999999) as ord
    FROM tournament_players tp
    LEFT JOIN ratings r ON r.player_id = tp.player_id
    WHERE tp.tournament_id = ?
  `;
  const params: any[] = [tournamentId];

  if (category) {
    countQuery += " AND tp.category_code = ?";
    idQuery += " AND tp.category_code = ?";
    params.push(category);
  }

  idQuery += " ORDER BY ord DESC";

  const total = (db.query(countQuery).get(...params) as { c: number }).c;
  if (total === 0) return { players: [], total: 0 };

  const allIds = db.query(idQuery).all(...params) as Array<{ player_id: number; ord: number }>;
  const offset = (page - 1) * pageSize;
  const pagePlayerIds = allIds.slice(offset, offset + pageSize).map((r) => r.player_id);
  if (pagePlayerIds.length === 0) return { players: [], total };

  const placeholders = pagePlayerIds.map(() => "?").join(",");

  const rows = db.query(`
    SELECT p.id, p.name, p.gender, p.club, p.photo_url, p.license_number,
      r.ordinal, r.matches_counted
    FROM players p
    LEFT JOIN ratings r ON r.player_id = p.id
    WHERE p.id IN (${placeholders})
    ORDER BY r.ordinal DESC NULLS LAST
  `).all(...pagePlayerIds) as Array<{
    id: number; name: string; gender: string | null; club: string | null;
    photo_url: string | null; license_number: string | null;
    ordinal: number | null; matches_counted: number | null;
  }>;

  const globalRanks = new Map<number, number>();
  const genderRanks = new Map<number, number>();
  const rankRows = db.query(`
    SELECT player_id, global_rank, gender_rank FROM (
      SELECT r.player_id,
        RANK() OVER (ORDER BY r.ordinal DESC) as global_rank,
        RANK() OVER (PARTITION BY p.gender ORDER BY r.ordinal DESC) as gender_rank
      FROM ratings r
      JOIN players p ON p.id = r.player_id
    ) WHERE player_id IN (${placeholders})
  `).all(...pagePlayerIds) as Array<{ player_id: number; global_rank: number; gender_rank: number }>;
  for (const row of rankRows) {
    globalRanks.set(row.player_id, row.global_rank);
    genderRanks.set(row.player_id, row.gender_rank);
  }

  const bounds = db.query("SELECT MIN(ordinal) as minOrd, MAX(ordinal) as maxOrd FROM ratings").get() as { minOrd: number; maxOrd: number };
  const range = bounds.maxOrd - bounds.minOrd;

  const players = rows.map((row) => {
    let rating: PlayerRating | null = null;
    if (row.ordinal != null && row.matches_counted != null) {
      const score = range > 0 ? Math.round(((row.ordinal - bounds.minOrd) / range) * 1000) / 10 : 0;
      const reliability = Math.round((row.matches_counted / (row.matches_counted + RELIABILITY_K)) * 100);
      rating = { score, reliability };
    }
    return {
      id: row.id, name: row.name, club: row.club ?? null,
      photoUrl: row.photo_url ?? null, licenseNumber: row.license_number ?? null,
      globalRank: globalRanks.get(row.id) ?? null,
      genderRank: genderRanks.get(row.id) ?? null,
      categoryRank: null, ordinal: row.ordinal ?? 0, rating,
      lastMatch: null,
    };
  });

  return { players, total };
}

function getTournamentPlayersFromMatches(
  db: ReturnType<typeof getDb>,
  tournamentId: number,
  category: string | undefined,
  page: number,
  pageSize: number
): { players: TournamentPlayer[]; total: number } {
  // Step 1: Get all tournament player IDs sorted by ordinal (fast, uses indexes)
  let playerIdQuery = `
    SELECT DISTINCT mp.player_id, COALESCE(r.ordinal, -999999) as ord
    FROM match_players mp
    JOIN matches m ON m.guid = mp.match_guid
    LEFT JOIN ratings r ON r.player_id = mp.player_id
    WHERE m.source IN (?, ?, ?)
  `;
  const playerIdParams: any[] = [`scrape:tournament:${tournamentId}`, `schedule:tournament:${tournamentId}`, `api:tournament:${tournamentId}`];

  if (category) {
    playerIdQuery += " AND m.section_name = ?";
    playerIdParams.push(category);
  }

  playerIdQuery += " ORDER BY ord DESC";

  const allPlayerIdRows = db.query(playerIdQuery).all(...playerIdParams) as Array<{ player_id: number; ord: number }>;
  const total = allPlayerIdRows.length;

  if (total === 0) return { players: [], total: 0 };

  // Step 2: Paginate the player IDs
  const offset = (page - 1) * pageSize;
  const pagePlayerIds = allPlayerIdRows.slice(offset, offset + pageSize).map((r) => r.player_id);

  if (pagePlayerIds.length === 0) return { players: [], total };

  const placeholders = pagePlayerIds.map(() => "?").join(",");

  // Step 3: Get player details + ratings for this page only
  const rows = db.query(`
    SELECT p.id, p.name, p.gender, p.club, p.photo_url, p.license_number,
      r.ordinal, r.matches_counted
    FROM players p
    LEFT JOIN ratings r ON r.player_id = p.id
    WHERE p.id IN (${placeholders})
    ORDER BY r.ordinal DESC NULLS LAST
  `).all(...pagePlayerIds) as Array<{
    id: number; name: string; gender: string | null; club: string | null;
    photo_url: string | null; license_number: string | null;
    ordinal: number | null; matches_counted: number | null;
  }>;

  // Step 4: Get ranks using window functions (single pass, filter to page players)
  const globalRanks = new Map<number, number>();
  const genderRanks = new Map<number, number>();
  const rankRows = db.query(`
    SELECT player_id, global_rank, gender_rank FROM (
      SELECT r.player_id,
        RANK() OVER (ORDER BY r.ordinal DESC) as global_rank,
        RANK() OVER (PARTITION BY p.gender ORDER BY r.ordinal DESC) as gender_rank
      FROM ratings r
      JOIN players p ON p.id = r.player_id
    ) WHERE player_id IN (${placeholders})
  `).all(...pagePlayerIds) as Array<{ player_id: number; global_rank: number; gender_rank: number }>;
  for (const row of rankRows) {
    globalRanks.set(row.player_id, row.global_rank);
    genderRanks.set(row.player_id, row.gender_rank);
  }

  // Step 5: Get last match dates for page players only
  const lastMatchMap = new Map<number, string>();
  const lastMatchRows = db.query(`
    SELECT mp.player_id, MAX(m.date_time) as last_match
    FROM match_players mp
    JOIN matches m ON m.guid = mp.match_guid
    WHERE mp.player_id IN (${placeholders})
    GROUP BY mp.player_id
  `).all(...pagePlayerIds) as Array<{ player_id: number; last_match: string | null }>;
  for (const r of lastMatchRows) {
    if (r.last_match) lastMatchMap.set(r.player_id, r.last_match);
  }

  const bounds = db.query("SELECT MIN(ordinal) as minOrd, MAX(ordinal) as maxOrd FROM ratings").get() as { minOrd: number; maxOrd: number };
  const range = bounds.maxOrd - bounds.minOrd;

  const players = rows.map((row) => {
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
      lastMatch: lastMatchMap.get(row.id) ?? null,
    };
  });

  return { players, total };
}

const RELIABILITY_K = 5;

function parseTournamentIdFromSource(source: string | null): number | null {
  if (!source) return null;
  const match = source.match(/(?:scrape|schedule|api):tournament:(\d+)/);
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

  let query = `
    SELECT m.guid, m.section_name, m.round_name, m.date_time, m.court,
           m.category, m.subcategory, m.sets_json, m.winner_side, m.result_type, m.source,
           m.side_a_ids, m.side_b_ids, m.side_a_names, m.side_b_names,
           m.tournament_name
    FROM matches m
    WHERE m.source IN (?, ?, ?)
  `;
  const params: any[] = [
    `scrape:tournament:${tournamentId}`,
    `schedule:tournament:${tournamentId}`,
    `api:tournament:${tournamentId}`,
  ];

  if (category) {
    query += " AND (m.category_code = ? OR m.category = ? OR m.section_name = ?)";
    params.push(category, category, category);
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

  // Batch-fetch match rating deltas
  const matchGuids = rows.map((r) => r.guid);
  const matchRatingDeltas = batchGetMatchRatingDeltas(db, matchGuids);

  function buildPlayerInfo(id: number, fallbackName: string, matchGuid: string) {
    const mr = matchRatingDeltas.get(`${matchGuid}:${id}`);
    return {
      id,
      name: fullNames.get(id) ?? fallbackName,
      photoUrl: photoUrls.get(id) ?? null,
      genderRank: genderRanks.get(id) ?? null,
      categoryRank: null,
      rating: ratingsMap.get(id) ?? null,
      ratingBefore: mr?.scoreBefore ?? null,
      ratingDelta: mr?.scoreDelta ?? null,
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
      sideA: sideAIds.map((id, i) => buildPlayerInfo(id, sideANames[i] ?? "", row.guid)),
      sideB: sideBIds.map((id, i) => buildPlayerInfo(id, sideBNames[i] ?? "", row.guid)),
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
