import { getDb } from "./db";
import { getPlayerProfile } from "./api";

interface SeedPlayer {
  id: number;
  name: string;
  club: string;
  section: string;
  location: string;
  age: string;
  pontos: number | null;
}

export async function seedPlayersFromJson() {
  const db = getDb();
  const players: SeedPlayer[] = await Bun.file("players.json").json();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO players (id, name, club, section, location, age_group, fpp_pontos)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const p of players) {
      insert.run(p.id, p.name, p.club, p.section, p.location, p.age, p.pontos);
    }
  });
  tx();

  console.log(`Seeded ${players.length} players from players.json`);
}

export async function enrichPlayerProfiles(batchSize = 10, delayMs = 500) {
  const db = getDb();
  const unsynced = db.query(
    "SELECT id, name FROM players WHERE profile_synced_at IS NULL ORDER BY id LIMIT ?"
  ).all(batchSize) as { id: number; name: string }[];

  if (unsynced.length === 0) {
    console.log("All player profiles already synced");
    return;
  }

  const update = db.prepare(`
    UPDATE players SET photo_url = ?, share_url = ?, license_number = ?, gender = ?,
    profile_synced_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const p of unsynced) {
    try {
      const profile = await getPlayerProfile(p.id);
      if (profile.status !== 1) {
        console.log(`  Skip ${p.name}: API status ${profile.status}`);
        continue;
      }

      const gender = profile.list?.find((l) => l.title === "Gender")?.text ?? null;
      const license = profile.list?.find((l) => l.title?.includes("License"))?.text ?? null;

      update.run(profile.player_photo, profile.share_url, license, gender, p.id);
      console.log(`  Enriched: ${p.name}`);

      if (delayMs > 0) await Bun.sleep(delayMs);
    } catch (err) {
      console.error(`  Error enriching ${p.name}:`, err);
    }
  }

  console.log(`Enriched ${unsynced.length} player profiles`);
}

if (import.meta.main) {
  const cmd = process.argv[2] ?? "seed";
  if (cmd === "seed") {
    await seedPlayersFromJson();
  } else if (cmd === "enrich") {
    const batch = parseInt(process.argv[3] ?? "50");
    await enrichPlayerProfiles(batch);
  } else {
    console.log("Usage: bun src/sync-players.ts [seed|enrich] [batchSize]");
  }
}
