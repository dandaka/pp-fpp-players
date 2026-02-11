// Usage: bun query-levels.ts [--section "Masculinos"]
// Shows lowest/highest players for Nível 5 and Nível 6
// Use --section to filter (partial match)

const sectionFilter = process.argv.indexOf("--section") !== -1
  ? process.argv[process.argv.indexOf("--section") + 1]
  : null;

const detailed: any[] = await Bun.file("players-with-scores.json").json();

const n5: any[] = [];
const n6: any[] = [];

for (const p of detailed) {
  if (sectionFilter && !p.section.includes(sectionFilter)) continue;
  for (const e of p.entries || []) {
    const rec = {
      player: p.name,
      section: p.section,
      pontos: e.pontos,
      nivel: e.nivel,
      rankingName: e.name,
    };
    if (e.nivel === "Nível 5") n5.push(rec);
    else if (e.nivel === "Nível 6") n6.push(rec);
  }
}

n5.sort((a, b) => a.pontos - b.pontos);
n6.sort((a, b) => a.pontos - b.pontos);

const label = sectionFilter ? ` (${sectionFilter})` : "";

function printSection(name: string, entries: any[]) {
  console.log(`=== ${name}${label} === (${entries.length} entries)\n`);
  if (entries.length === 0) { console.log("  No entries\n"); return; }

  console.log("Lowest 5:");
  for (const r of entries.slice(0, 5)) {
    console.log(`  ${r.pontos.toFixed(2).padStart(10)}  ${r.rankingName.padEnd(35)} (${r.section})`);
  }
  console.log("\nHighest 5:");
  for (const r of entries.slice(-5).reverse()) {
    console.log(`  ${r.pontos.toFixed(2).padStart(10)}  ${r.rankingName.padEnd(35)} (${r.section})`);
  }
  console.log();
}

printSection("Nível 5", n5);
printSection("Nível 6", n6);
