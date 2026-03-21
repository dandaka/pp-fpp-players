import { getDb } from "./db";
import { rating, rate, ordinal } from "openskill";

interface MatchRow {
  guid: string;
  side_a_ids: string;
  side_b_ids: string;
  winner_side: string | null;
  date_time: string;
  is_singles: number;
}

export function calculateRatings() {
  const db = getDb();

  const matches = db.query(`
    SELECT m.guid, m.side_a_ids, m.side_b_ids, m.winner_side, m.date_time, m.is_singles
    FROM matches m
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE m.winner_side IS NOT NULL
      AND m.is_singles = 0
      AND (t.sport IS NULL OR t.sport = 'Padel')
    ORDER BY m.date_time ASC
  `).all() as MatchRow[];

  console.log(`Processing ${matches.length} matches with results...`);

  const playerRatings = new Map<number, ReturnType<typeof rating>>();
  const playerMatchCounts = new Map<number, number>();

  // Collect match rating snapshots: { matchGuid, playerId, ordinalBefore, ordinalDelta }
  const matchRatingRows: Array<{ matchGuid: string; playerId: number; ordinalBefore: number; ordinalDelta: number }> = [];

  function getRating(playerId: number) {
    if (!playerRatings.has(playerId)) {
      playerRatings.set(playerId, rating());
    }
    return playerRatings.get(playerId)!;
  }

  for (const m of matches) {
    const sideAIds: number[] = JSON.parse(m.side_a_ids);
    const sideBIds: number[] = JSON.parse(m.side_b_ids);
    const allIds = [...sideAIds, ...sideBIds];

    // Snapshot ordinals before the match
    const ordinalsBefore = new Map<number, number>();
    for (const id of allIds) {
      ordinalsBefore.set(id, ordinal(getRating(id)));
    }

    const teamA = sideAIds.map((id) => getRating(id));
    const teamB = sideBIds.map((id) => getRating(id));

    const ranks = m.winner_side === "a" ? [1, 2] : [2, 1];

    try {
      const result = rate([teamA, teamB], { rank: ranks });
      const newA = result[0]!;
      const newB = result[1]!;

      for (let i = 0; i < sideAIds.length; i++) {
        playerRatings.set(sideAIds[i]!, newA[i]!);
        playerMatchCounts.set(sideAIds[i]!, (playerMatchCounts.get(sideAIds[i]!) ?? 0) + 1);
      }
      for (let i = 0; i < sideBIds.length; i++) {
        playerRatings.set(sideBIds[i]!, newB[i]!);
        playerMatchCounts.set(sideBIds[i]!, (playerMatchCounts.get(sideBIds[i]!) ?? 0) + 1);
      }

      // Record before/delta for each player
      for (const id of allIds) {
        const before = ordinalsBefore.get(id)!;
        const after = ordinal(getRating(id));
        matchRatingRows.push({ matchGuid: m.guid, playerId: id, ordinalBefore: before, ordinalDelta: after - before });
      }
    } catch (err) {
      console.error(`Error rating match ${m.guid}:`, err);
    }
  }

  console.log(`Calculated ratings for ${playerRatings.size} players`);

  const upsert = db.prepare(`
    INSERT INTO ratings (player_id, mu, sigma, ordinal, matches_counted, calculated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(player_id) DO UPDATE SET
      mu = ?, sigma = ?, ordinal = ?, matches_counted = ?, calculated_at = datetime('now')
  `);

  const insertMatchRating = db.prepare(`
    INSERT INTO match_ratings (match_guid, player_id, ordinal_before, ordinal_delta)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(match_guid, player_id) DO UPDATE SET
      ordinal_before = ?, ordinal_delta = ?
  `);

  const tx = db.transaction(() => {
    // Clear old match ratings (full recalc)
    db.run("DELETE FROM match_ratings");

    for (const [playerId, r] of playerRatings) {
      const ord = ordinal(r);
      const cnt = playerMatchCounts.get(playerId) ?? 0;
      upsert.run(playerId, r.mu, r.sigma, ord, cnt, r.mu, r.sigma, ord, cnt);
    }

    for (const row of matchRatingRows) {
      insertMatchRating.run(row.matchGuid, row.playerId, row.ordinalBefore, row.ordinalDelta, row.ordinalBefore, row.ordinalDelta);
    }
  });
  tx();

  console.log(`Ratings saved to database (${matchRatingRows.length} match rating snapshots)`);
}

export function printLeaderboard(limit = 30) {
  const db = getDb();
  const rows = db.query(`
    SELECT r.player_id, p.name, p.section, p.club, r.mu, r.sigma, r.ordinal, r.matches_counted
    FROM ratings r
    JOIN players p ON p.id = r.player_id
    WHERE r.matches_counted >= 3
    ORDER BY r.ordinal DESC
    LIMIT ?
  `).all(limit) as Array<{
    player_id: number; name: string; section: string; club: string;
    mu: number; sigma: number; ordinal: number; matches_counted: number;
  }>;

  console.log("\n=== OpenSkill Leaderboard ===\n");
  console.log("Rank | Player                          | Section     | Ordinal |   μ   |   σ   | Matches");
  console.log("-----|--------------------------------|-------------|---------|-------|-------|--------");

  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)} | ${r.name.padEnd(30)} | ${(r.section ?? "").padEnd(11)} | ${r.ordinal.toFixed(2).padStart(7)} | ${r.mu.toFixed(2).padStart(5)} | ${r.sigma.toFixed(2).padStart(5)} | ${String(r.matches_counted).padStart(7)}`
    );
  });
}

if (import.meta.main) {
  calculateRatings();
  printLeaderboard();
}
