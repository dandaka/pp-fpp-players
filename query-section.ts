// Usage: bun query-section.ts "Masculinos 5"
// Lists all players in a section sorted by pontos

const section = process.argv[2];
if (!section) {
  console.error("Usage: bun query-section.ts <section>");
  console.error('Example: bun query-section.ts "Masculinos 5"');
  process.exit(1);
}

const players: any[] = await Bun.file("players.json").json();
const filtered = players
  .filter((p) => p.section === section)
  .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0));

console.log(`${section}: ${filtered.length} players\n`);
console.log(
  `${"#".padStart(3)} ${"Name".padEnd(30)} ${"Pontos".padStart(10)} ${"Age".padStart(5)}`
);
console.log("-".repeat(55));

for (let i = 0; i < filtered.length; i++) {
  const p = filtered[i];
  const pts = p.pontos != null ? p.pontos.toFixed(2) : "-";
  console.log(
    `${String(i + 1).padStart(3)} ${p.name.padEnd(30)} ${pts.padStart(10)} ${p.age.padStart(5)}`
  );
}
