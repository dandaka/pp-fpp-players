// Usage: bun query-player.ts "Vlad Ra"
// Shows detailed info for a player including ranking entries

const search = process.argv[2]?.toLowerCase();
if (!search) {
  console.error("Usage: bun query-player.ts <name>");
  console.error('Example: bun query-player.ts "Vlad Ra"');
  process.exit(1);
}

const players: any[] = await Bun.file("players.json").json();
const detailed: any[] = await Bun.file("players-with-scores.json").json();

const matches = players.filter((p) =>
  p.name.toLowerCase().includes(search)
);

if (matches.length === 0) {
  console.log(`No players found matching "${search}"`);
  process.exit(0);
}

for (const p of matches) {
  const detail = detailed.find((d: any) => d.id === p.id);

  // Find rank within section
  const sectionPlayers = players
    .filter((s) => s.section === p.section)
    .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0));
  const rank = sectionPlayers.findIndex((s) => s.id === p.id) + 1;

  console.log(`Name:    ${p.name}`);
  console.log(`ID:      ${p.id}`);
  console.log(`Section: ${p.section}`);
  console.log(`Club:    ${p.club || "-"}`);
  console.log(`Age:     ${p.age}`);
  console.log(`Location:${p.location}`);
  console.log(`Pontos:  ${p.pontos != null ? p.pontos.toFixed(2) : "-"}`);
  console.log(`Rank:    #${rank} of ${sectionPlayers.length} in ${p.section}`);

  if (detail?.entries?.length > 0) {
    console.log(`\nRanking entries (Nível 5/6):`);
    for (const e of detail.entries) {
      console.log(
        `  #${e.ranking} ${e.name} — ${e.pontos.toFixed(2)} pts (${e.nivel}, ${e.escalao})`
      );
    }
  }
  console.log();
}
