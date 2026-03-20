import { getDb } from "../connection";
import type { Tournament, TournamentDetail, TournamentPlayer } from "../types";

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

  let query = `
    SELECT DISTINCT p.id, p.name, p.gender, r.ordinal,
      CASE WHEN r.ordinal IS NOT NULL AND p.gender IS NOT NULL THEN
        (SELECT COUNT(*) + 1 FROM ratings r2
         JOIN players p2 ON p2.id = r2.player_id
         WHERE r2.ordinal > r.ordinal AND p2.gender = p.gender)
      ELSE NULL END as gender_rank
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
    id: number; name: string; gender: string | null; ordinal: number | null; gender_rank: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    genderRank: row.gender_rank,
    categoryRank: null,
    ordinal: row.ordinal ?? 0,
  }));
}
