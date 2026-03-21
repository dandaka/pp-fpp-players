import { getDb } from "../connection";
import type { Tournament, TournamentDetail, TournamentPlayer, TournamentMatch } from "../types";

export function getTournaments(page = 1, pageSize = 20): { tournaments: Tournament[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

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

  // Pre-compute gender ranks in one pass instead of correlated subquery per row
  const genderRanks = new Map<number, number>();
  const rankRows = db.query(`
    SELECT r.player_id, p.gender,
      RANK() OVER (PARTITION BY p.gender ORDER BY r.ordinal DESC) as gender_rank
    FROM ratings r
    JOIN players p ON p.id = r.player_id
    WHERE p.gender IS NOT NULL
  `).all() as Array<{ player_id: number; gender: string; gender_rank: number }>;
  for (const row of rankRows) {
    genderRanks.set(row.player_id, row.gender_rank);
  }

  let query = `
    SELECT DISTINCT p.id, p.name, p.gender, r.ordinal
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
    id: number; name: string; gender: string | null; ordinal: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    genderRank: genderRanks.get(row.id) ?? null,
    categoryRank: null,
    ordinal: row.ordinal ?? 0,
  }));
}

export function getTournamentMatches(
  tournamentId: number,
  category?: string
): { upcoming: TournamentMatch[]; completed: TournamentMatch[] } {
  const db = getDb();

  const tournament = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  if (!tournament) return { upcoming: [], completed: [] };

  let query = `
    SELECT m.guid, m.section_name, m.round_name, m.date_time, m.court,
           m.category, m.subcategory, m.sets_json, m.winner_side,
           m.side_a_ids, m.side_b_ids, m.side_a_names, m.side_b_names
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
    side_a_ids: string; side_b_ids: string; side_a_names: string | null; side_b_names: string | null;
  }>;

  // Batch-fetch player names
  const allPlayerIds = new Set<number>();
  for (const row of rows) {
    for (const id of JSON.parse(row.side_a_ids)) allPlayerIds.add(id);
    for (const id of JSON.parse(row.side_b_ids)) allPlayerIds.add(id);
  }
  const idList = [...allPlayerIds];
  const nameMap = new Map<number, string>();
  if (idList.length > 0) {
    const placeholders = idList.map(() => "?").join(",");
    const nameRows = db.query(
      `SELECT id, name FROM players WHERE id IN (${placeholders})`
    ).all(...idList) as Array<{ id: number; name: string }>;
    for (const r of nameRows) nameMap.set(r.id, r.name);
  }

  function toMatch(row: typeof rows[0]): TournamentMatch {
    const sideAIds: number[] = JSON.parse(row.side_a_ids);
    const sideBIds: number[] = JSON.parse(row.side_b_ids);
    const sideANames = (row.side_a_names ?? "").split(" / ");
    const sideBNames = (row.side_b_names ?? "").split(" / ");

    let sets: TournamentMatch["sets"] = [];
    if (row.sets_json) {
      try {
        sets = JSON.parse(row.sets_json).map((s: any) => ({
          setA: s.set_a ?? 0, setB: s.set_b ?? 0,
          tieA: s.tie_a ?? -1, tieB: s.tie_b ?? -1,
        }));
      } catch {}
    }

    return {
      guid: row.guid,
      category: row.category,
      subcategory: row.subcategory,
      roundName: row.round_name,
      dateTime: row.date_time,
      court: row.court,
      sets,
      winnerSide: row.winner_side,
      sideA: sideAIds.map((id, i) => ({ id, name: nameMap.get(id) ?? sideANames[i] ?? "" })),
      sideB: sideBIds.map((id, i) => ({ id, name: nameMap.get(id) ?? sideBNames[i] ?? "" })),
    };
  }

  const upcoming: TournamentMatch[] = [];
  const completed: TournamentMatch[] = [];

  for (const row of rows) {
    const match = toMatch(row);
    if (row.winner_side) {
      completed.push(match);
    } else {
      upcoming.push(match);
    }
  }

  return { upcoming, completed };
}
