export function normalizeString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function scoreMatch(query: string, name: string): number {
  const normQuery = normalizeString(query);
  const normName = normalizeString(name);

  if (normName === normQuery) return 100;
  if (normName.startsWith(normQuery)) return 90;

  const nameWords = normName.split(/\s+/);
  const queryWords = normQuery.split(/\s+/);

  // Single-word query: check if any name word starts with it
  if (queryWords.length === 1) {
    for (const word of nameWords) {
      if (word.startsWith(normQuery)) return 80;
    }
    const idx = normName.indexOf(normQuery);
    if (idx >= 0) return 70 - idx * 0.1;
    return 0;
  }

  // Multi-word query: each query word must match the start of a name word
  let matchCount = 0;
  for (const qw of queryWords) {
    if (nameWords.some((nw) => nw.startsWith(qw))) matchCount++;
  }
  if (matchCount === queryWords.length) return 85;
  if (matchCount > 0) return 50 + (matchCount / queryWords.length) * 20;

  return 0;
}
