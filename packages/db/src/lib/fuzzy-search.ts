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

  const words = normName.split(/\s+/);
  for (const word of words) {
    if (word.startsWith(normQuery)) return 80;
  }

  const idx = normName.indexOf(normQuery);
  if (idx >= 0) return 70 - idx * 0.1;

  return 0;
}
