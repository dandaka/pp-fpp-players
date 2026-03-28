import { Database } from "bun:sqlite";
import { getTournament, getTournamentDraws, getSectionPlayers } from "./api";
import { parseCategoryCode } from "./parse-category";
import { parseDate } from "./parse-date";
import type { ApiPlayerEntry } from "./types";

const MAX_CONCURRENT = 5;
const BATCH_DELAY_MS = 200;
const MAX_CONSECUTIVE_MISSES = 50;
const MAX_RETRIES = 3;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [sync] ${msg}`);
}

async function retry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === retries - 1) throw err;
      const delay = Math.pow(2, i) * 1000;
      if (err?.message?.includes("429")) {
        log("Rate limited (429), pausing 60s");
        await Bun.sleep(60_000);
      } else {
        await Bun.sleep(delay);
      }
    }
  }
  throw new Error("Unreachable");
}

interface DiscoverOptions {
  db: Database;
  startId?: number;
  endId?: number;
}

interface DiscoveredTournament {
  id: number;
  name: string;
  sport: string | null;
}

export async function discoverTournaments(opts: DiscoverOptions): Promise<DiscoveredTournament[]> {
  const { db } = opts;
  const discovered: DiscoveredTournament[] = [];

  let startId = opts.startId;
  if (startId == null) {
    const row = db.query("SELECT MAX(id) as maxId FROM tournaments").get() as { maxId: number | null };
    startId = (row.maxId ?? 0) + 1;
  }

  const endId = opts.endId;
  let consecutiveMisses = 0;
  let currentId = startId;

  const insertTournament = db.prepare(`
    INSERT OR IGNORE INTO tournaments (id, name, club, date, link_web, sport, club_id, cover, latitude, longitude, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  while (true) {
    const batch: number[] = [];
    for (let i = 0; i < MAX_CONCURRENT && (endId == null || currentId <= endId); i++) {
      batch.push(currentId++);
    }
    if (batch.length === 0) break;

    const results = await Promise.allSettled(
      batch.map((id) => retry(() => getTournament(id)))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const id = batch[i];

      if (result.status === "rejected") {
        consecutiveMisses++;
        continue;
      }

      const tournament = result.value;
      if (!tournament || !tournament.id) {
        consecutiveMisses++;
        if (endId == null && consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
          log(`Stopping scan: ${MAX_CONSECUTIVE_MISSES} consecutive misses at ID ${id}`);
          return discovered;
        }
        continue;
      }

      consecutiveMisses = 0;

      const sportInfo = tournament.info_texts?.find((t) => t.title === "Sport" || t.title === "Desporto");
      const sport = sportInfo?.text ?? null;

      if (sport && sport !== "Padel") continue;

      const dateInfo = tournament.info_texts?.find((t) => t.title === "Date" || t.title === "Data");
      const date = parseDate(dateInfo?.text, tournament.header_texts);

      insertTournament.run(
        tournament.id,
        tournament.name,
        tournament.club?.name ?? null,
        date,
        tournament.link_web ?? null,
        sport,
        tournament.club?.id ?? null,
        tournament.cover ?? null,
        tournament.location?.latitude ?? null,
        tournament.location?.longitude ?? null,
        tournament.location?.address ?? null
      );

      discovered.push({ id: tournament.id, name: tournament.name, sport });
      log(`Discovered: ${tournament.name} (ID: ${tournament.id})`);
    }

    if (endId == null && consecutiveMisses >= MAX_CONSECUTIVE_MISSES) break;
    if (endId != null && currentId > endId) break;

    await Bun.sleep(BATCH_DELAY_MS);
  }

  return discovered;
}

export async function rescanGaps(opts: { db: Database }): Promise<DiscoveredTournament[]> {
  const { db } = opts;
  const range = db.query("SELECT MIN(id) as minId, MAX(id) as maxId FROM tournaments").get() as { minId: number | null; maxId: number | null };
  if (!range.minId || !range.maxId) return [];

  const knownRows = db.query("SELECT id FROM tournaments WHERE id BETWEEN ? AND ?").all(range.minId, range.maxId) as { id: number }[];
  const knownIds = new Set(knownRows.map((r) => r.id));

  const gapIds: number[] = [];
  for (let id = range.minId; id <= range.maxId; id++) {
    if (!knownIds.has(id)) gapIds.push(id);
  }

  if (gapIds.length === 0) return [];
  log(`Rescan: found ${gapIds.length} gaps in range [${range.minId}, ${range.maxId}]`);

  const discovered: DiscoveredTournament[] = [];
  const insertTournament = db.prepare(`
    INSERT OR IGNORE INTO tournaments (id, name, club, date, link_web, sport, club_id, cover, latitude, longitude, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < gapIds.length; i += MAX_CONCURRENT) {
    const batch = gapIds.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map((id) => retry(() => getTournament(id)))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "rejected" || !result.value?.id) continue;

      const tournament = result.value;
      const sportInfo = tournament.info_texts?.find((t: any) => t.title === "Sport" || t.title === "Desporto");
      const sport = sportInfo?.text ?? null;
      if (sport && sport !== "Padel") continue;

      const dateInfo = tournament.info_texts?.find((t: any) => t.title === "Date" || t.title === "Data");
      const date = parseDate(dateInfo?.text, tournament.header_texts);
      insertTournament.run(
        tournament.id, tournament.name, tournament.club?.name ?? null,
        date, tournament.link_web ?? null, sport,
        tournament.club?.id ?? null, tournament.cover ?? null,
        tournament.location?.latitude ?? null, tournament.location?.longitude ?? null,
        tournament.location?.address ?? null
      );
      discovered.push({ id: tournament.id, name: tournament.name, sport });
    }

    await Bun.sleep(BATCH_DELAY_MS);
  }

  log(`Gap rescan: discovered ${discovered.length} new tournament(s)`);
  return discovered;
}

interface SyncMatchesOptions {
  db: Database;
  tournamentId: number;
}

interface SyncMatchesResult {
  inserted: number;
  updated: number;
  skipped: number;
  sections: number;
  newPlayers: number;
}

export async function syncTournamentMatches(opts: SyncMatchesOptions): Promise<SyncMatchesResult> {
  const { db, tournamentId } = opts;
  const result: SyncMatchesResult = { inserted: 0, updated: 0, skipped: 0, sections: 0, newPlayers: 0 };

  // First get sections list
  const allDraws = await retry(() => getTournamentDraws(tournamentId));
  result.sections = allDraws.sections.length;

  if (allDraws.sections.length === 0) {
    log(`No sections for tournament ${tournamentId}`);
    db.run("UPDATE tournaments SET matches_synced_at = datetime('now') WHERE id = ?", [tournamentId]);
    return result;
  }

  const insertPlayer = db.prepare("INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)");
  const insertMatch = db.prepare(`
    INSERT INTO matches (guid, tournament_id, tournament_name, section_name, round_name, date_time,
      is_singles, side_a_ids, side_b_ids, side_a_names, side_b_names,
      sets_json, winner_side, source, court, category, category_code, section_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertMatchPlayer = db.prepare("INSERT OR IGNORE INTO match_players (match_guid, player_id, side) VALUES (?, ?, ?)");
  const existingMatch = db.prepare("SELECT guid, winner_side FROM matches WHERE guid = ?");
  const updateMatchResult = db.prepare(
    "UPDATE matches SET sets_json = ?, winner_side = ?, date_time = ?, court = ?, category_code = ? WHERE guid = ?"
  );

  const findByPlayers = db.prepare(`
    SELECT guid, winner_side FROM matches
    WHERE tournament_id = ?
    AND ((side_a_ids = ? AND side_b_ids = ?) OR (side_a_ids = ? AND side_b_ids = ?))
    AND source LIKE 'scrape:tournament:%'
  `);
  const enrichExisting = db.prepare(`
    UPDATE matches SET category_code = ?, section_id = ?, category = ?, court = ?, round_name = ?
    WHERE guid = ?
  `);

  const tournamentRow = db.query("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | null;
  const tournamentName = tournamentRow?.name ?? "";
  const source = `api:tournament:${tournamentId}`;

  // Fetch draws per section so we know which category each match belongs to
  for (const section of allDraws.sections) {
    const sectionName = section.name;
    const categoryCode = parseCategoryCode(sectionName);
    const sectionId = section.id;

    let sectionDraws;
    try {
      sectionDraws = await retry(() => getTournamentDraws(tournamentId, sectionId));
    } catch (err) {
      log(`Failed to get draws for section ${sectionId} (${sectionName}): ${err}`);
      continue;
    }

    const tx = db.transaction(() => {
      for (const round of sectionDraws.rounds) {
        for (const match of round.matches) {
          const sideA = match.side_a ?? [];
          const sideB = match.side_b ?? [];

          const sideAIds = sideA.map((p) => p.id).filter((id) => id > 0);
          const sideBIds = sideB.map((p) => p.id).filter((id) => id > 0);

          if (sideAIds.length === 0 || sideBIds.length === 0) {
            result.skipped++;
            continue;
          }

          const isSingles = sideA.length === 1 && sideB.length === 1 ? 1 : 0;
          if (isSingles) {
            result.skipped++;
            continue;
          }

          for (const p of [...sideA, ...sideB]) {
            if (p.id > 0) {
              const r = insertPlayer.run(p.id, p.name);
              if (r.changes > 0) result.newPlayers++;
            }
          }

          const guid = match.id;
          const dateTime = match.infos?.date_time?.str ?? null;
          const court = match.infos?.top_left ?? null;
          const roundName = match.infos?.title_left ?? round.name ?? null;

          let winnerSide: string | null = null;
          if (match.winner_a) winnerSide = "a";
          else if (match.winner_b) winnerSide = "b";

          const setsJson = match.sets?.length > 0 ? JSON.stringify(match.sets) : null;
          const sideAIdsJson = JSON.stringify(sideAIds);
          const sideBIdsJson = JSON.stringify(sideBIds);
          const sideANames = sideA.map((p) => p.name).join(" / ");
          const sideBNames = sideB.map((p) => p.name).join(" / ");

          const existing = existingMatch.get(guid) as { guid: string; winner_side: string | null } | null;
          if (existing) {
            if (!existing.winner_side && winnerSide) {
              updateMatchResult.run(setsJson, winnerSide, dateTime, court, categoryCode, guid);
              result.updated++;
            } else {
              result.skipped++;
            }
            continue;
          }

          const feedMatch = findByPlayers.get(
            tournamentId, sideAIdsJson, sideBIdsJson, sideBIdsJson, sideAIdsJson
          ) as { guid: string; winner_side: string | null } | null;
          if (feedMatch) {
            enrichExisting.run(categoryCode, sectionId, sectionName, court, roundName, feedMatch.guid);
            result.updated++;
            continue;
          }

          insertMatch.run(
            guid, tournamentId, tournamentName, sectionName, roundName, dateTime,
            isSingles, sideAIdsJson, sideBIdsJson, sideANames, sideBNames,
            setsJson, winnerSide, source, court, sectionName, categoryCode, sectionId
          );

          for (const id of sideAIds) insertMatchPlayer.run(guid, id, "a");
          for (const id of sideBIds) insertMatchPlayer.run(guid, id, "b");

          result.inserted++;
        }
      }
    });
    tx();

    await Bun.sleep(BATCH_DELAY_MS);
  }

  db.run("UPDATE tournaments SET matches_synced_at = datetime('now') WHERE id = ?", [tournamentId]);

  log(`Matches sync for ${tournamentId}: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped`);
  return result;
}

interface SyncPlayersOptions {
  db: Database;
  tournamentId: number;
}

interface SyncPlayersResult {
  upserted: number;
  sections: number;
}

export async function syncTournamentPlayers(opts: SyncPlayersOptions): Promise<SyncPlayersResult> {
  const { db, tournamentId } = opts;
  const result: SyncPlayersResult = { upserted: 0, sections: 0 };

  const draws = await retry(() => getTournamentDraws(tournamentId));

  if (draws.sections.length === 0) {
    log(`No sections for tournament ${tournamentId}`);
    return result;
  }

  const insertPlayer = db.prepare("INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)");
  const upsertTournamentPlayer = db.prepare(`
    INSERT INTO tournament_players (tournament_id, player_id, category_code, partner_id, section_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, player_id, category_code)
    DO UPDATE SET partner_id = excluded.partner_id, section_id = excluded.section_id
  `);
  const updateLicense = db.prepare(
    "UPDATE players SET license_number = ? WHERE id = ? AND (license_number IS NULL OR license_number = '')"
  );

  for (const section of draws.sections) {
    const categoryCode = parseCategoryCode(section.name);
    let entries: ApiPlayerEntry[];

    try {
      entries = await retry(() => getSectionPlayers(section.id));
    } catch (err) {
      log(`Failed to get players for section ${section.id} (${section.name}): ${err}`);
      continue;
    }

    result.sections++;

    const tx = db.transaction(() => {
      // First pass: insert all players
      for (const entry of entries) {
        for (const p of (entry.players ?? [])) {
          if (p.id <= 0) continue;
          insertPlayer.run(p.id, p.name);
          if (p.national_id) {
            updateLicense.run(p.national_id, p.id);
          }
        }
      }
      // Second pass: upsert tournament_players (all FKs now satisfied)
      for (const entry of entries) {
        const players = entry.players ?? [];
        const playerIds = players.map((p) => p.id).filter((id) => id > 0);

        for (const p of players) {
          if (p.id <= 0) continue;
          const partnerId = playerIds.find((id) => id !== p.id) ?? null;
          upsertTournamentPlayer.run(tournamentId, p.id, categoryCode, partnerId, section.id);
          result.upserted++;
        }
      }
    });
    tx();

    await Bun.sleep(BATCH_DELAY_MS);
  }

  log(`Players sync for ${tournamentId}: ${result.upserted} upserted across ${result.sections} sections`);
  return result;
}
