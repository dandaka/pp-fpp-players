// Usage: bun query-top.ts "Masculinos 5" [count]
// Shows top N players in a section (default 10)

const section = process.argv[2];
const count = parseInt(process.argv[3] || "10");

if (!section) {
  console.error("Usage: bun query-top.ts <section> [count]");
  console.error('Example: bun query-top.ts "Masculinos 5" 10');
  process.exit(1);
}

const players: any[] = await Bun.file("players.json").json();
const filtered = players
  .filter((p) => p.section === section)
  .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0))
  .slice(0, count);

console.log(`${section} - Top ${count}\n`);
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
