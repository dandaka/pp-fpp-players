export function parseCategoryCode(raw: string): string {
  if (!raw || !raw.trim()) return "UNKNOWN";
  const s = raw.trim();

  // Exact compact codes: M5, F4, MX3, M+45, M-SUB14
  const compact = s.match(/^(M|F|MX)(\d+|\+\d+|-SUB\d+)$/);
  if (compact) return `${compact[1]}${compact[2]}`;

  // Codes with suffix: M5-Quali, M6-QP
  const suffixed = s.match(/^((?:M|F|MX)\d+)-/);
  if (suffixed) return suffixed[1];

  // Embedded codes: "Quadro Principal M5", "Qualificação F4"
  const embedded = s.match(/\b((?:M|F|MX)\d+)\b/);
  if (embedded) return embedded[1];

  // "MX 5" with space between gender and digit
  const spaced = s.match(/^(MX)\s+(\d+)/i);
  if (spaced) return `MX${spaced[2]}`;

  // Detect gender from Portuguese words (including accented variants)
  let gender: string | null = null;
  if (/(?:Mix|Mist[oa]s)/i.test(s)) {
    gender = "MX";
  } else if (/Fem[ií]nin[oa]s?/i.test(s)) {
    gender = "F";
  } else if (/Masculin[oa]s?/i.test(s)) {
    gender = "M";
  }

  if (!gender) return "UNKNOWN";

  const youth = s.match(/Sub-(\d+)/i);
  if (youth) return `${gender}-SUB${youth[1]}`;

  const vet = s.match(/\+(\d+)/);
  if (vet) return `${gender}+${vet[1]}`;

  // "Nível 4", "Nivel 5"
  const nivel = s.match(/N[ií]vel\s+(\d+)/i);
  if (nivel) return `${gender}${nivel[1]}`;

  // Bare digit level only right after gender word: "Masculinos 5", "Femininos 4"
  const genderLevel = s.match(/(?:Masculin[oa]s?|Fem[ií]nin[oa]s?|Mist[oa]s|Mix)\s+(\d)\b/i);
  if (genderLevel) return `${gender}${genderLevel[1]}`;

  // Gender-only (no level found): "Mistos - Grupo B", "Corporate Masculino"
  return gender;
}
