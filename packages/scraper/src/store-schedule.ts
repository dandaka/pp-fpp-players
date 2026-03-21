import { getDb } from "./db";
import type { ScrapedMatchRow } from "./scrape-matches-page";
import type { DrawEntry } from "./scrape-draws-page";

interface SetScore {
  set_a: number;
  set_b: number;
  tie_a: number;
  tie_b: number;
}

/**
 * Generate deterministic GUID for a scheduled match.
 * Format: schedule:{tournamentId}:{sortedAllPlayerIds}
 */
export function generateScheduleGuid(
  tournamentId: number,
  sideAIds: number[],
  sideBIds: number[]
): string {
  const allIds = [...sideAIds, ...sideBIds].sort((a, b) => a - b);
  return `schedule:${tournamentId}:${allIds.join("-")}`;
}

/**
 * Parse result string like "6-4  6-3" into set scores.
 */
export function parseResultScores(result: string): SetScore[] {
  if (!result || !result.includes("-")) return [];
  const sets = result.trim().split(/\s{2,}/);
  const parsed: SetScore[] = [];
  for (const s of sets) {
    const parts = s.split("-");
    if (parts.length !== 2) continue;
    const a = parseInt(parts[0]);
    const b = parseInt(parts[1]);
    if (isNaN(a) || isNaN(b)) continue;
    parsed.push({ set_a: a, set_b: b, tie_a: -1, tie_b: -1 });
  }
  return parsed;
}

/**
 * Determine winner side from set scores.
 * Winner is the side that won more sets.
 */
function determineWinner(sets: SetScore[]): "a" | "b" | null {
  if (sets.length === 0) return null;
  let aWins = 0;
  let bWins = 0;
  for (const s of sets) {
    if (s.set_a > s.set_b) aWins++;
    else if (s.set_b > s.set_a) bWins++;
  }
  if (aWins > bWins) return "a";
  if (bWins > aWins) return "b";
  return null;
}

interface CrossRefResult {
  licenseUpdates: Array<{ playerId: number; license: string }>;
  roundNames: Map<string, string>; // matchGuid → roundName
}

/**
 * Cross-reference Matches page data with Draws page data.
 * Match by player name to enrich with license numbers and round names.
 */
export function crossReference(
  matches: ScrapedMatchRow[],
  draws: DrawEntry[]
): CrossRefResult {
  const licenseUpdates: Array<{ playerId: number; license: string }> = [];
  const roundNames = new Map<string, string>();

  // Build name→player mapping from matches (which have IDs)
  const nameToId = new Map<string, number>();
  for (const m of matches) {
    for (const p of [...m.sideA, ...m.sideB]) {
      if (p.id && p.name) {
        nameToId.set(p.name.toLowerCase(), p.id);
      }
    }
  }

  // Enrich license numbers from draws
  for (const d of draws) {
    if (d.licenseNumber) {
      const id = nameToId.get(d.player1Name.toLowerCase());
      if (id) {
        licenseUpdates.push({ playerId: id, license: d.licenseNumber });
      }
    }
  }

  // TODO: Populate roundNames by matching draw bracket positions to matches.
  // Requires Draws page scraper to provide per-match round context.
  // For now, round_name will remain null for schedule-sourced matches.

  return { licenseUpdates, roundNames };
}

/**
 * Store scraped matches into the database.
 * Handles dedup, new player insertion, and result updates.
 */
export function storeSchedule(
  tournamentId: number,
  tournamentName: string,
  matches: ScrapedMatchRow[],
  crossRef: CrossRefResult
) {
  const db = getDb();

  const insertMatch = db.prepare(`
    INSERT INTO matches (guid, tournament_name, section_name, round_name, date_time,
      is_singles, side_a_ids, side_b_ids, side_a_names, side_b_names,
      sets_json, winner_side, source, tournament_id, court, category, subcategory)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateMatchResult = db.prepare(`
    UPDATE matches SET sets_json = ?, winner_side = ?, date_time = ? WHERE guid = ?
  `);

  const insertMatchPlayer = db.prepare(`
    INSERT OR IGNORE INTO match_players (match_guid, player_id, side) VALUES (?, ?, ?)
  `);

  const insertNewPlayer = db.prepare(`
    INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)
  `);

  const updateLicense = db.prepare(`
    UPDATE players SET license_number = ? WHERE id = ? AND (license_number IS NULL OR license_number = '')
  `);

  const existingMatch = db.prepare(`SELECT guid, winner_side FROM matches WHERE guid = ?`);

  const findByPlayersAndTournament = db.prepare(`
    SELECT guid FROM matches
    WHERE tournament_name = ?
    AND ((side_a_ids = ? AND side_b_ids = ?) OR (side_a_ids = ? AND side_b_ids = ?))
    AND source LIKE 'scrape:tournament:%'
  `);

  const enrichExisting = db.prepare(`
    UPDATE matches SET tournament_id = ?, court = ?, category = ?, subcategory = ?
    WHERE guid = ?
  `);

  const source = `schedule:tournament:${tournamentId}`;

  let inserted = 0;
  let updated = 0;
  let enriched = 0;
  let skipped = 0;
  let newPlayers = 0;

  const tx = db.transaction(() => {
    // Update license numbers from draws cross-reference
    for (const { playerId, license } of crossRef.licenseUpdates) {
      updateLicense.run(license, playerId);
    }

    for (const m of matches) {
      const sideAIds = m.sideA.map((p) => p.id).filter((id): id is number => id !== null);
      const sideBIds = m.sideB.map((p) => p.id).filter((id): id is number => id !== null);

      if (sideAIds.length === 0 || sideBIds.length === 0) {
        skipped++;
        continue;
      }

      // Insert new players
      for (const p of [...m.sideA, ...m.sideB]) {
        if (p.id) {
          const result = insertNewPlayer.run(p.id, p.name);
          if (result.changes > 0) newPlayers++;
        }
      }

      const sideAIdsJson = JSON.stringify(sideAIds);
      const sideBIdsJson = JSON.stringify(sideBIds);
      const sideANames = m.sideA.map((p) => p.name).join(" / ");
      const sideBNames = m.sideB.map((p) => p.name).join(" / ");
      const isSingles = m.sideA.length === 1 && m.sideB.length === 1 ? 1 : 0;

      const guid = generateScheduleGuid(tournamentId, sideAIds, sideBIds);
      const sets = parseResultScores(m.result);
      const winnerSide = determineWinner(sets);
      const dateTime = m.date && m.time ? `${m.date} ${m.time}` : m.date || null;
      const roundName = crossRef.roundNames.get(guid) || null;

      // Dedup check 1: Same GUID exists?
      const existing = existingMatch.get(guid) as { guid: string; winner_side: string | null } | null;
      if (existing) {
        if (!existing.winner_side && winnerSide) {
          // Upcoming → now has result: update
          updateMatchResult.run(JSON.stringify(sets), winnerSide, dateTime, guid);
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      // Dedup check 2: Same players + tournament from news feed? (check both side orderings)
      const feedMatch = findByPlayersAndTournament.get(
        tournamentName, sideAIdsJson, sideBIdsJson, sideBIdsJson, sideAIdsJson
      ) as { guid: string } | null;
      if (feedMatch) {
        enrichExisting.run(tournamentId, m.court, m.category, m.subcategory, feedMatch.guid);
        enriched++;
        continue;
      }

      // Insert new match
      insertMatch.run(
        guid, tournamentName, m.categoryFull, roundName, dateTime,
        isSingles, sideAIdsJson, sideBIdsJson, sideANames, sideBNames,
        sets.length > 0 ? JSON.stringify(sets) : null, winnerSide, source,
        tournamentId, m.court, m.category, m.subcategory
      );

      for (const id of sideAIds) insertMatchPlayer.run(guid, id, "a");
      for (const id of sideBIds) insertMatchPlayer.run(guid, id, "b");

      inserted++;
    }
  });

  tx();

  console.log(`Store complete: ${inserted} inserted, ${updated} updated, ${enriched} enriched, ${skipped} skipped, ${newPlayers} new players`);
}
