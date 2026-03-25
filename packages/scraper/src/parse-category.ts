export function parseCategoryCode(raw: string): string {
  if (!raw || !raw.trim()) return "UNKNOWN";
  const s = raw.trim();

  const compact = s.match(/^(M|F|MX)(\d+|\+\d+|-SUB\d+)$/);
  if (compact) return `${compact[1]}${compact[2]}`;

  const suffixed = s.match(/^((?:M|F|MX)\d+)-/);
  if (suffixed) return suffixed[1];

  const embedded = s.match(/\b((?:M|F|MX)\d+)\b/);
  if (embedded) return embedded[1];

  let gender: string;
  if (/^(?:Mix|Mist[oa]s)/i.test(s)) {
    gender = "MX";
  } else if (/^Feminino/i.test(s)) {
    gender = "F";
  } else if (/^Masculino/i.test(s)) {
    gender = "M";
  } else {
    return "UNKNOWN";
  }

  const youth = s.match(/Sub-(\d+)/i);
  if (youth) return `${gender}-SUB${youth[1]}`;

  const vet = s.match(/\+(\d+)/);
  if (vet) return `${gender}+${vet[1]}`;

  const level = s.match(/\b([1-6])\b/);
  if (level) return `${gender}${level[1]}`;

  return "UNKNOWN";
}
